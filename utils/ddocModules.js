const vm = require('vm');
const lib = require('../utils/lib');
const { lambdaGlobals } = require('../constants/lambdaGlobal');
const config = require('../config');

// methods
const cache = require('../methods/cache');
const fetch = require('../methods/fetch');
const socket = require('../methods/socket');
const sms = require('../methods/sms');
const Bucket = require('../methods/bucket');


const { LOG_EVENT_DDOC_ERROR } = require('../constants/logEvents');
const { BUCKET_DDOC_CONTEXT_DENY } = require('../constants/bucket');


const makeModules = (body, props = {}) => {
  const { log, bucket, methods } = props;
  const module_cache = {};
  const ctx = {};
  Object.keys(body).forEach(key => {
    if (!key || key[0] === '_' || BUCKET_DDOC_CONTEXT_DENY[key]) return null;
    ctx[key] = body[key];
  });
  if (methods && methods.length) {
    methods.compact(true).unique().forEach(method => {
      if (ctx.hasOwnProperty(method)) return null;
      switch (method) {
        case 'fetch':
          ctx['_fetch'] = fetch;
          break;
        case 'socket':
          ctx['_socket'] = socket;
          break;
        case 'bucket':
          ctx['_bucket'] = new Bucket(bucket);
          break;
        case 'cache':
          ctx['_cache'] = cache;
          break;
        case 'sms':
          ctx['_sms'] = sms.fill(undefined, undefined, log);
          break;
      }
    });
  }

  const context = new vm.createContext(lambdaGlobals);

  const timeout = config.get('process.timeout');

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

  function _require(property, module) {
    module = module || {};
    const newModule = resolveModule(property.split('/'), module.parent, ctx);
    if (!module_cache.hasOwnProperty(newModule.id)) {
      module_cache[newModule.id] = {};
      const script = '(function (module, exports, require, log) { ' + newModule.current + '\n })';
      try {
        vm.runInContext(script, context, { timeout }).call(ctx, newModule, newModule.exports, (property) => _require(property, newModule), log);
      } catch (error) {
        log({
          message: 'Error on require property: '+ property,
          event: LOG_EVENT_DDOC_ERROR,
          error
        });
      }
      module_cache[newModule.id] = newModule.exports;
    }
    return module_cache[newModule.id];
  }

  return { context, ctx, _require };
};

module.exports = {
  makeModules
};
