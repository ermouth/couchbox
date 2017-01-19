const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');

const Filter = require('./filter');
const Hook = require('./hook');

// methods
const fetch = require('../utils/fetch');
const Bucket = require('../utils/bucket');

const CONTEXT_DENY = {
  'language': true,
  'filters': true,
  'hooks': true
};

function DDoc(db, props = {}) {
  const { conf, name, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  const hooks = {};
  const filters = {};
  const filtersIndex = [];
  let id;
  let rev = props.rev;
  let seq;

  function init() {
    return new Promise((resolve, reject) => {
      db.get('_design/'+ name, { local_seq: true, rev }, (err, body) => {
        if (err) {
          return reject(err);
        }

        id = body._id;
        rev = body._rev;
        seq = body._local_seq;

        const ctx = {};
        Object.keys(body).forEach(key => {
          if (!key || key[0] === '_' || CONTEXT_DENY[key]) return null;
          ctx[key] = body[key];
        });

        if (body.filters && body.hooks) {

          const hookMethods = {};
          if (methods && methods.length) {
            methods.split(/\s+/g).compact(true).forEach(method => {
              if (hookMethods.hasOwnProperty(method)) return null;
              switch (method) {
                case 'fetch':
                  hookMethods['_fetch'] = fetch;
                  break;
                case 'bucket':
                  hookMethods['_bucket'] = new Bucket(db);
                  break;
              }
            });
          }

          Object.keys(body.filters).forEach(filterKey => {
            if (!body.hooks[filterKey]) return null;
            const fieldName = name +'/'+ filterKey;
            const filter = new Filter(fieldName, body.filters[filterKey], { logger, conf });
            if (filter && filter.isGood()) {
              const hook = new Hook(fieldName, body.hooks[filterKey], { ctx, methods: hookMethods, logger, conf, });
              if (hook && hook.isGood()) {
                filtersIndex.push(filterKey);
                hooks[filterKey] = hook;
                filters[filterKey] = filter;
              }
            }
          });
        }

        return resolve(seq);
      });
    });
  }

  function filter(change) {
    const filterHooks = filtersIndex.filter(filterKey => {
      let filterResult = false;
      try {
        filterResult = filters[filterKey].filter(change.doc);
      } catch(error) {
        filterResult = false;
        log({ message:'Error on filter: '+ name +'/'+ filterKey, error });
      }
      return filterResult;
    });
    return filterHooks.map(hookKey => hooks[hookKey]);
  }

  function getHook(hookName) {
    return hooks[hookName];
  }

  function getInfo() {
    return { name, rev, methods };
  }

  return { name, init, filter, getInfo, getHook };
}

module.exports = DDoc;
