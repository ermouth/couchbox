require('sugar');
const Promise = require('bluebird');
const atob = require('atob');
const btoa = require('btoa');
const vm = require('vm');
const lib = require('./lib');
const Logger = require('./logger');
const config = require('../config');

const DEBUG = config.get('debug');

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
const customGlobals = { Promise };

if (DEBUG) customGlobals.console = console;

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
const availableInLambda = ['require', 'include', 'log', 'arguments', 'resolve', 'reject'];
const lambdaAvailable = Object.keys(availableGlobals).concat(availableInLambda);


const emptyFunction = () => undefined;

// Modules makers

function resolveModule(path, mod = {}, root) {
  const { current, parent, id } = mod;
  if (path.length === 0) {
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
    try {
      const pluginModule = require('../plugins/'+ method);
      if (pluginModule) {
        return pluginModule(method, config.get('plugins.' + method) || {}, log).catch((error) => {
          log({
            message: 'Error init plugin: '+ method,
            event: PLUGIN_ERROR,
            error
          });
          return null;
        });
      }
    } catch (error) {
      log({
        message: 'Error plugin '+ method +' not exist',
        event: PLUGIN_ERROR,
        error,
        type: 'warn'
      });
    }
    return Promise.resolve();
  }
}

const makePlugins = (ctx, methods = [], log) => {
  const methodsList = methods && methods.length > 0 ? methods.compact(true).unique() : [];
  return Promise.map(methodsList, pluginLoader(ctx, log)).then(pluginsList => {
    const plugins = {};
    for (let i = 0, i_max = pluginsList.length, plugin; i < i_max; i++) if (plugin = pluginsList[i]) plugins[plugin.name] = plugin;
    return plugins;
  });
};

const makeContext = (contextName = 'modulesContext', body = {}, log) => {
  const ctx = {};
  {
    const bodyKeys = Object.keys(body);
    let i = bodyKeys.length, key;
    while (i--) if ((key = bodyKeys[i]) && key[0] !== '_' && !CONTEXT_DENY[key]) ctx[key] = body[key];
  }

  const context = new vm.createContext(lambdaGlobals);
  const contextId = contextName.replace(/[^A-z0-9]+/g, '_');

  const require_module_cache = {};
  const include_module_cache = {};

  function compileIncludeModule(property, module) {
    const module_name = 'include_module__'+ contextId +'__'+ property.replace(/[^A-z0-9]+/g, '_');
    const module_script = '(function '+ module_name +'(module, exports, require, include, log) { ' + module.current + ' })';
    try {
      include_module_cache[module.id] = vm.runInContext(module_script, context);
    } catch (error) {
      log({
        message: 'Error compiling include property: ' + property,
        event: MODULE_ERROR,
        error
      });
    }
  }

  function compileRequireModule(property, module) {
    const module_name = 'require_module__'+ contextId +'__'+ property.replace(/[^A-z0-9]+/g, '_');
    const module_script = '(function '+ module_name +'(module, exports, require, log) { ' + module.current + ' })';
    try {
      vm.runInContext(module_script, context).call(ctx, module, module.exports, (prop) => _require(prop, module), log);
    } catch(error) {
      log({
        message: 'Error during require: ' + property,
        event: MODULE_ERROR,
        error
      });
    }
    require_module_cache[module.id] = module.exports;
  }

  function _include(log, property, module) {
    const modulesCtx = this;
    module = module || {};
    const module_include = resolveModule(property.split('/'), module.parent, modulesCtx);
    if (!include_module_cache.hasOwnProperty(module_include)) compileIncludeModule(property, module_include);

    try {
      include_module_cache[module_include.id].call(modulesCtx, module_include, module_include.exports, _require, (prop) => _include.call(modulesCtx, log, prop, module_include), log);
    } catch (error) {
      log({
        message: 'Error during include: ' + property,
        event: MODULE_ERROR,
        error
      });
    }

    return module_include.exports;
  }

  function _require(property, module) {
    module = module || {};
    const module_require = resolveModule(property.split('/'), module.parent, ctx);
    if (!require_module_cache.hasOwnProperty(module_require.id)) compileRequireModule(property, module_require);
    return require_module_cache[module_require.id];
  }

  return { context, ctx, _include, _require };
};

const makeHandler = (bucketName, bucket, ddocName, handlerKey, body = {}, props = {}) => {

  const { ctx = {}, context, _include, _require, methods, referrer } = props;
  if (!(body && body.lambda)) return Promise.reject(new Error('No lambda'));
  if (!context) return Promise.reject(new Error('No context'));

  const handlerName = ddocName.replace(/[^a-z0-9]+/g, '_') +'/'+ handlerKey.replace(/[^a-z0-9]+/g, '_');
  const lambdaName = ddocName.replace(/[^a-z0-9]+/g, '_') +'__'+ handlerKey.replace(/[^a-z0-9]+/g, '_');
  const logger = new Logger({
    prefix: 'Handler',
    scope: '_'+ bucketName +'/'+ ddocName + '/'+ handlerKey,
    logger: props.logger,
    logEvent: props.logEvent || HANDLER_LOG
  });
  const log = logger.getLog();

  const lambdaSrc = body.lambda.trim().replace(/^function.*?\(/, 'function '+ lambdaName +'(');
  const timeout = body.timeout && body.timeout > 0 ? body.timeout : (PROCESS_TIMEOUT || HANDLER_DEFAULT_TIMEOUT);
  const validate = body.dubug !== true;

  const lambda_globals = lib.getGlobals(lambdaSrc);
  if (validate) {
    const validationResult = lib.validateGlobals(lambda_globals, { available: lambdaAvailable });
    if (validationResult) {
      return Promise.reject(new Error('Lambda validation failed: '+ JSON.stringify(validationResult)));
    }
  }

  const script = (
    '(function runner__'+ lambdaName +'(require, include, log, params){' +
      'return new Promise(' +
        '(resolve, reject) => { (' + lambdaSrc + ').apply(this, params); }' +
      ');' +
    '})'
  );

  let lambda;
  try {
    lambda = vm.runInContext(script, context);
  } catch (error) {
    return Promise.reject(new Error('Failed compiling lambda "'+ error.message + '"'));
  }

  function makeLambda(plugins) {
    function handler() {
      const params = new Array(arguments.length);
      {
        let arg_i = arguments.length;
        while (arg_i--) params[arg_i] = arguments[arg_i];
      }

      return new Promise((resolve, reject0) => {
        const reject = (error) => reject0(new RejectHandlerError(error));
        const { proxy, revoke } = Proxy.revocable(ctx, {
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

        try {
          return lambda.call(proxy, _require, (prop) => _include.call(proxy, log, prop), log, params)
            .timeout(timeout)
            .then(resolve)
            .catch((error) => reject((error instanceof Promise.TimeoutError) ? new TimeoutError(error) : error))
            .finally(revoke);
        } catch(error) {
          log({
            message: 'Error call lambda handler: '+ handlerName,
            event: props.errorEvent || HANDLER_ERROR,
            error
          });
          revoke();
          return reject(new Error('Bad handler'));
        }
      });
    }

    return { handlerKey, timeout, handler };
  }

  return makePlugins(ctx, methods, log).then(makeLambda);
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
