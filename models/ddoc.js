const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');

const Filter = require('./filter');
const Hook = require('./hook');

const CONTEXT_DENY = {
  'language': true,
  'filters': true,
  'hooks': true
};

function DDoc(db, name, methods = [], props = {}) {
  const { conf } = props;
  const logger = new Logger({
    prefix: 'DDoc '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  const hooks = {};
  const filters = {};
  const filtersIndex = [];
  let seq;

  function init() {
    return new Promise((resolve, reject) => {
      db.get('_design/'+ name, { local_seq: true }, (err, body) => {
        if (err) {
          return reject(err);
        }

        seq = body._local_seq;

        const ctx = {};
        Object.keys(body).forEach(key => {
          if (!key || key[0] === '_' || CONTEXT_DENY[key]) return null;
          ctx[key] = body[key];
        });

        if (body.filters && body.hooks) {
          Object.keys(body.filters).forEach(filterKey => {
            if (!body.hooks[filterKey]) return null;
            const filter = new Filter(filterKey, body.filters[filterKey], { logger, conf });
            if (filter && filter.isGood()) {
              const hook = new Hook(filterKey, body.hooks[filterKey], { ctx, logger, conf });
              if (hook && hook.isGood()) {
                filtersIndex.push(filterKey);
                hooks[filterKey] = hook;
                filters[filterKey] = filter;
              }
            }
          });
        }

        return resolve({ name, seq });
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
        log(error);
      }
      return filterResult;
    });
    return filterHooks.map(hookKey => hooks[hookKey]);
  }

  function getSeq() {
    return seq;
  }

  return { name, init, filter };
}

module.exports = DDoc;
