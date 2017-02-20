require('sugar');
const Promise = require('bluebird');
const atob = require('atob');
const btoa = require('btoa');
const vm = require('vm');
const lib = require('./lib');
const Logger = require('./logger');
const config = require('../config');


const { RejectHandlerError, TimeoutError } = require('./errors');

const MODULE_ERROR = 'module/error';
const PLUGIN_ERROR = 'plugin/error';
const HANDLER_LOG = 'handler/log';
const HANDLER_ERROR = 'handler/error';
const HANDLER_DEFAULT_TIMEOUT = 10e3;
const CONTEXT_DENY = {
  language: true,
  filters: true,
  hooks: true,
  api: true
};


// Context modules

const nodeGlobals = {
  Buffer,
  setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate
};
const couchGlobals = {
  atob, btoa,
  isArray: Object.isArray,
  toJSON: JSON.stringify,
};
const customGlobals = {
  Promise
};
const lambdaGlobals = Object.assign({}, nodeGlobals, couchGlobals, customGlobals);
const availableGlobals = Object.assign({}, lambdaGlobals, {
  undefined,
  Error, SyntaxError, TypeError, ReferenceError,
  Object, Array, Function, RegExp, String, Boolean, Date,
  Number, NaN, Infinity, isNaN, isFinite,
  Float32Array, Float64Array, Int32Array, Int16Array, Int8Array, Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray,
  Map, Set, Proxy, Symbol, WeakMap, WeakSet,
  Buffer,
  Math, JSON,
  decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, unescape, parseInt, parseFloat
});
const availableInLambda = ['require', 'log', 'arguments', 'resolve', 'reject'];
const lambdaAvailable = Object.keys(availableGlobals).concat(availableInLambda);


// Modules makers

function resolveModule(path, mod = {}, root) {
  const { current, parent, id } = mod;
  if (path.length == 0) {
    if (typeof current !== 'string') {
      throw new Error('Invalid require path: Must require a JavaScript string, not: '+ (typeof current));
    }
    return { current, parent, id, exports : {} };
  }
  // we need to traverse the path
  const pathNode = path.shift();
  if (pathNode === '..') {
    if (!(parent && parent.parent)) {
      throw new Error('Invalid require path: Object has no parent: '+ JSON.stringify(current));
    }
    return resolveModule(path, {
      id : id.slice(0, id.lastIndexOf('/')),
      parent : parent.parent,
      current : parent.current
    });
  } else if (pathNode === '.') {
    if (!parent) {
      throw new Error('Invalid require path: Object has no parent: '+ JSON.stringify(current));
    }
    return resolveModule(path, { parent, current, id });
  } else if (root) {
    mod = { current: root };
  }
  if (mod.current[pathNode] === undefined) {
    throw new Error('Invalid require path: Object has no property "'+ pathNode +'". '+ JSON.stringify(mod.current));
  }
  return resolveModule(path, {
    current : mod.current[pathNode],
    parent : mod,
    id : mod.id ? mod.id + '/' + pathNode : pathNode
  });
}

function pluginLoader(ctx, log) {
  return function loadPlugin(method) {
    if (method in ctx) return Promise.resolve();
    let pluginPromise = Promise.resolve();
    try {
      const pluginModule = require('../plugins/'+ method);
      if (pluginModule) {
        const onPluginInitError = (error) => {
          log({
            message: 'Error init plugin: '+ method,
            event: PLUGIN_ERROR,
            error
          });
          return null;
        };
        return pluginModule(method, config.get('plugins.' + method) || {}, log).catch(onPluginInitError);
      }
    } catch (error) {
      log({
        message: 'Error plugin '+ method +' not exist',
        event: PLUGIN_ERROR,
        error
      });
    }
    return pluginPromise;
  }
}

const makePlugins = (ctx, methods = [], log) => {
  const methodsList = methods && methods.length > 0 ? methods.compact(true).unique() : [];
  return Promise.all(methodsList.map(pluginLoader(ctx, log))).then(pluginsList => {
    const plugins = {};
    pluginsList.forEach(plugin => plugin && (plugins[plugin.name] = plugin));
    return plugins;
  });
};

const makeModules = (body = {}, props = {}) => {
  const { bucket, methods, log } = props;
  const module_cache = {};
  const ctx = {}; Object.keys(body).forEach(key => (key && key[0] !== '_' && !CONTEXT_DENY[key]) && (ctx[key] = body[key]));

  const context = new vm.createContext(lambdaGlobals);
  const timeout = config.get('process.timeout');

  return makePlugins(ctx, methods, log).then(plugins => {
    const modulesCtx = new Proxy(ctx, {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        if (prop in plugins) {
          target[prop] = plugins[prop].make({ bucket, ctx, reject:()=>{} });
        } else {
          target[prop] = undefined;
        }
        return target[prop];
      }
    });

    function requireModule(property, module) {
      module = module || {};
      const newModule = resolveModule(property.split('/'), module.parent, modulesCtx);
      if (!module_cache.hasOwnProperty(newModule.id)) {
        module_cache[newModule.id] = {};
        const script = '(function (module, exports, require, log) { ' + newModule.current + '\n })';
        try {
          vm.runInContext(script, context, { timeout }).call(modulesCtx, newModule, newModule.exports, (property) => requireModule(property, newModule), log);
        } catch (error) {
          log({
            message: 'Error on require property: '+ property,
            event: MODULE_ERROR,
            error
          });
        }
        module_cache[newModule.id] = newModule.exports;
      }
      return module_cache[newModule.id];
    }

    return { context, ctx, requireModule };
  });
};

const makeHandler = (bucket, ddoc, handlerKey, body = {}, props = {}) => {
  const handlerName = ddoc +'/'+ handlerKey;
  const { methods, requireModule, ctx = {}, context, referrer } = props;
  const logger = new Logger({
    prefix: 'Handler '+ handlerName,
    logger: props.logger,
    logEvent: props.logEvent || HANDLER_LOG
  });
  const log = logger.getLog();


  if (!context) return Promise.reject(new Error('No context'));
  if (!body.lambda) return Promise.reject(new Error('No lambda'));


  const lambdaName = ddoc +'__'+ handlerKey.replace(/[^a-z0-9]+/g, '_');
  const lambdaSrc = body.lambda.trim().replace(/^function.*?\(/, 'function '+ lambdaName +'(');
  const timeout = body.timeout && body.timeout > 0 ? body.timeout : (config.get('process.timeout') || HANDLER_DEFAULT_TIMEOUT);
  const validate = body.dubug !== true;

  if (validate) {
    const validationResult = lib.validateGlobals(lambdaSrc, { available: lambdaAvailable });
    if (validationResult) return Promise.reject(new Error('Bad lambda validation: '+ JSON.stringify(validationResult)));
  }

  const _script = new vm.Script(
    '(function runner__'+ lambdaName +'(require, log, params){' +
      'return new Promise(' +
        '(resolve, reject) => { (' + lambdaSrc + ').apply(this, params); }' +
      ');' +
    '})'
  );

  const errorHandler = (error) => {
    if (error instanceof Promise.TimeoutError) {
      throw new TimeoutError(error);
    } else {
      throw error;
    }
  };

  return makePlugins(ctx, methods, log).then(plugins => {

    function handler() {
      return new Promise((resolve0, reject0) => {
        const params = Array.from(arguments);
        const reject = (error) => reject0(new RejectHandlerError(error));
        const proxy = Proxy.revocable(ctx, {
          get: (target, prop) => {
            if (prop in target) return target[prop];
            if (prop in plugins) {
              return plugins[prop].make(referrer
                ? { bucket, ctx, params, reject, ref:referrer(params) }
                : { bucket, ctx, params, reject }
              );
            }
            return target[prop];
          }
        });
        const modulesCtx = proxy.proxy;
        const onDone = () => { proxy.revoke(); };

        try {
          return _script.runInContext(context)
            .call(modulesCtx, requireModule, log, params).timeout(timeout)
            .catch(errorHandler).then(resolve0).catch(reject).finally(onDone)
        } catch(error) {
          log({
            message: 'Error run handler lambda: '+ handlerName,
            event: props.errorEvent || HANDLER_ERROR,
            error
          });
        }
        onDone();
        return reject(new Error('Bad handler'));
      });
    }

    return { handlerKey, timeout, handler };
  });
};


module.exports = {
  makeModules,
  makePlugins,
  makeHandler,
  Constants: {
    HANDLER_DEFAULT_TIMEOUT,
    CONTEXT_DENY
  },
  LOG_EVENTS: {
    HANDLER_LOG,
    HANDLER_ERROR,
    MODULE_ERROR,
    PLUGIN_ERROR,
  }
};
