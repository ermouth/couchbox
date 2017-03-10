require('sugar');
const Promise = require('bluebird');
const atob = require('atob');
const btoa = require('btoa');
const vm = require('vm');
const lib = require('./lib');
const Logger = require('./logger');
const config = require('../config');

const DEBUG = config.get('debug.enabled');

const { RejectHandlerError, TimeoutError } = require('./errors');

const MODULE_ERROR = 'module/error';
const PLUGIN_ERROR = 'plugin/error';
const HANDLER_LOG = 'handler/log';
const HANDLER_ERROR = 'handler/error';
const HANDLER_DEFAULT_TIMEOUT = 10e3;
const PROCESS_TIMEOUT = config.get('process.timeout');
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


const emptyFunction = () => undefined;

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
    for(let i = 0, i_max = pluginsList.length, plugin; i < i_max; i++) if (plugin = pluginsList[i]) plugins[plugin.name] = plugin;
    return plugins;
  });
};

const makeContext = (body = {}, log) => {
  const ctx = {};
  Object.keys(body).forEach(key => (key && key[0] !== '_' && !CONTEXT_DENY[key]) && (ctx[key] = body[key]));

  const context = new vm.createContext(lambdaGlobals);

  const module_cache = {};

  function compileModule(property, module) {
    const script = '(function (module, exports, require, log) { ' + module.current + '\n })';
    try {
      module_cache[module.id] = vm.runInContext(script, context);
    } catch (error) {
      log({
        message: 'Error compiling require property: ' + property,
        event: MODULE_ERROR,
        error
      });
    }
  }

  function makeModule(log, property, module) {
    const modulesCtx = this;
    try {
      module_cache[module.id].call(modulesCtx, module, module.exports, (property) => requireModule.call(modulesCtx, log, property, module), log);
    } catch (error) {
      log({
        message: 'Error during require: ' + property,
        event: MODULE_ERROR,
        error
      });
    }
    return module.exports;
  }

  function requireModule(log, property, module) {
    const modulesCtx = this;
    module = module || {};
    const newModule = resolveModule(property.split('/'), module.parent, modulesCtx);
    if (!(newModule.id in module_cache)) compileModule(property, newModule);
    return makeModule.call(modulesCtx, log, property, newModule, log);
  }

  return { context, ctx, requireModule };
};

const makeHandler = (bucket, ddoc, handlerKey, body = {}, props = {}) => {
  const { ctx = {}, context, requireModule, methods, referrer } = props;
  if (!body.lambda) return Promise.reject(new Error('No lambda'));
  if (!context) return Promise.reject(new Error('No context'));

  const handlerName = ddoc +'/'+ handlerKey;
  const lambdaName = ddoc +'__'+ handlerKey.replace(/[^a-z0-9]+/g, '_');
  const logger = new Logger({
    prefix: 'Handler '+ handlerName,
    logger: props.logger,
    logEvent: props.logEvent || HANDLER_LOG
  });
  const log = logger.getLog();

  const handler_init_chain = ['handler-init', handlerName];
  DEBUG && logger.performance.start(Date.now(), handler_init_chain);

  const lambdaSrc = body.lambda.trim().replace(/^function.*?\(/, 'function '+ lambdaName +'(');
  const timeout = body.timeout && body.timeout > 0 ? body.timeout : (PROCESS_TIMEOUT || HANDLER_DEFAULT_TIMEOUT);
  const validate = body.dubug !== true;


  const lambda_globals = lib.getGlobals(lambdaSrc);
  if (validate) {
    const validationResult = lib.validateGlobals(lambda_globals, { available: lambdaAvailable });
    if (validationResult) {
      DEBUG && logger.performance.end(Date.now(), handler_init_chain);
      return Promise.reject(new Error('Lambda validation failed: '+ JSON.stringify(validationResult)));
    }
  }
  const needRequire = lambda_globals.indexOf('require') >= 0;

  const script = (
    '(function runner__'+ lambdaName +'(require, log, params){' +
      'return new Promise(' +
        '(resolve, reject) => { (' + lambdaSrc + ').apply(this, params); }' +
      ');' +
    '})'
  );
  let lambda;
  try {
    lambda = vm.runInContext(script, context);
  } catch (error) {
    DEBUG && logger.performance.end(Date.now(), handler_init_chain);
    return Promise.reject(new Error('Failed compiling lambda "'+ error.message + '"'));
  }

  const errorHandler = (error) => {
    if (error instanceof Promise.TimeoutError) {
      throw new TimeoutError(error);
    } else {
      throw error;
    }
  };

  const plugins_init_chain = ['plugins-init', methods.join(',')];
  DEBUG && logger.performance.start(Date.now(), plugins_init_chain);
  return makePlugins(ctx, methods, log).then(plugins => {
    DEBUG && logger.performance.end(Date.now(), plugins_init_chain);

    function handler() {
      const params = new Array(arguments.length);
      for (let args_i = 0, args_max = arguments.length; args_i < args_max; args_i++) params[args_i] = arguments[args_i];

      const handler_run_chain = ['handler-run', handlerName, 'ref-' + referrer ? referrer(params) : 'null'];
      DEBUG && logger.performance.start(Date.now(), handler_run_chain);

      return new Promise((resolve0, reject0) => {
        const reject = (error) => reject0(new RejectHandlerError(error));
        const proxy = Proxy.revocable(ctx, {
          get: (target, prop) => {
            if (prop in target) return target[prop];
            if (prop in plugins) {
              return plugins[prop].make(referrer
                ? { bucket, ctx, params, reject, ref: referrer(params) }
                : { bucket, ctx, params, reject }
              );
            }
            return target[prop];
          },
          has: (target, prop) => prop in target || prop in plugins,
          set: emptyFunction,
          defineProperty: emptyFunction,
          deleteProperty: emptyFunction
        });

        const modulesCtx = proxy.proxy;
        const _require = needRequire ? prop => requireModule.call(modulesCtx, log, prop) : null;
        const onDone = () => {
          proxy.revoke();
          DEBUG && logger.performance.end(Date.now(), handler_run_chain);
        };

        try {
          return lambda.call(modulesCtx, _require, log, params).timeout(timeout)
            .catch(errorHandler).then(resolve0).catch(reject).finally(onDone);
        } catch(error) {
          log({
            message: 'Error running lambda handler: '+ handlerName,
            event: props.errorEvent || HANDLER_ERROR,
            error
          });
        }
        onDone();
        return reject(new Error('Bad handler'));
      });
    }

    DEBUG && logger.performance.end(Date.now(), handler_init_chain);
    return { handlerKey, timeout, handler };
  });
};


module.exports = {
  makeContext,
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
