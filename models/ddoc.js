const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../lib');
const Logger = require('../utils/log');
const { lambdaGlobals } = require('../constants/lambdaGlobal');
const Hook = require('./hook');
const config = require('../config');


const {
  LOG_EVENT_DDOC_INIT, LOG_EVENT_DDOC_ERROR,
  LOG_EVENT_FILTER_ERROR
} = require('../constants/logEvents');

// methods
const cache = require('../utils/cache');
const fetch = require('../utils/fetch');
const socket = require('../utils/socket');
const sms = require('../utils/sms');
const Bucket = require('../utils/bucket');

const CONTEXT_DENY = {
  'language': true,
  'filters': true,
  'hooks': true
};

function Filter(name, lambda, props) {
  const logger = new Logger({
    prefix: 'Filter '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  let _lambda;
  let isGood = false;

  try {
    _lambda = lib.makeFunc(lambda);
    isGood = true;
  } catch(error) {
    isGood = false;
    log({
      message: 'Error compile filter lambda: '+ name,
      event: LOG_EVENT_FILTER_ERROR,
      error
    });
  }

  return {
    name,
    filter: (doc) => isGood && !!_lambda(doc),
    isGood
  };
}

function DDoc(db, props = {}) {
  const { name, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  const hooks = new Map();
  const filters = new Map();
  let id;
  let rev = props.rev;
  let seq;

  function init() {
    return new Promise((resolve, reject) => {
      db.get('_design/'+ name, { local_seq: true, rev }, (error, body) => {
        if (error) return reject(error);

        id = body._id;
        rev = body._rev;
        seq = body._local_seq;

        if (body.filters && body.hooks) {
          const filterProps = { logger };
          const hookProps = Object.assign({}, filterProps, initModules(body));

          Object.keys(body.filters).forEach(filterKey => {
            if (!body.hooks[filterKey]) return null;
            const fieldName = name +'/'+ filterKey;
            const filter = new Filter(fieldName, body.filters[filterKey], filterProps);
            if (filter && filter.isGood) {
              const hook = new Hook(fieldName, body.hooks[filterKey], hookProps);
              if (hook && hook.isGood) {
                hooks.set(filterKey, hook);
                filters.set(filterKey, filter);
              }
            }
          });
        }

        log({
          message: 'Started ddoc: '+ name,
          event: LOG_EVENT_DDOC_INIT,
          error
        });
        return resolve({ seq });
      });
    });
  }

  const initModules = (body) => {
    const module_cache = {};
    const ctx = {};
    Object.keys(body).forEach(key => {
      if (!key || key[0] === '_' || CONTEXT_DENY[key]) return null;
      ctx[key] = body[key];
    });
    if (methods && methods.length) {
      methods.split(/\s+/g).compact(true).forEach(method => {
        if (ctx.hasOwnProperty(method)) return null;
        switch (method) {
          case 'fetch':
            ctx['_fetch'] = fetch;
            break;
          case 'socket':
            ctx['_socket'] = socket;
            break;
          case 'bucket':
            ctx['_bucket'] = new Bucket(db);
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

    const timeout = config.get('hooks.timeout');

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

  const getInfo = () => ({ name, rev, methods });
  const getHook = (hookName) => hooks.has(hookName) ? hooks.get(hookName) : null;

  function filter(change) {
    const hooksResult = [];
    for (let filterKey of filters.keys()) {
      let filterResult = false;
      try {
        filterResult = filters.get(filterKey).filter(change.doc);
      } catch(error) {
        filterResult = false;
        log({
          message: 'Error on filter: '+ name +'/'+ filterKey,
          event: LOG_EVENT_DDOC_ERROR,
          error
        });
      }
      if (filterResult === true) {
        const hook = getHook(filterKey);
        if (hook) hooksResult.push(hook);
        else log({
          message: 'Error on filter: '+ name +'/'+ filterKey,
          event: LOG_EVENT_DDOC_ERROR,
          error: new Error('Cannot get hook by filter key')
        });
      }
    }
    return hooksResult;
  }

  return { name, init, filter, getInfo, getHook };
}

module.exports = DDoc;
