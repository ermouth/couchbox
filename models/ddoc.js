const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');

const Filter = require('./filter');
const Hook = require('./hook');

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

  function init() {
    return new Promise((resolve, reject) => {
      db.get('_design/'+ name, (err, body) => {
        if (err) {
          return reject(err);
        }

        if (body.filters && body.hooks) {
          Object.keys(body.filters).forEach(filterKey => {
            if (!body.hooks[filterKey]) return null;
            const filter = new Filter(filterKey, body.filters[filterKey], { logger, conf });
            if (filter && filter.isGood()) {
              const hook = new Hook(filterKey, body.hooks[filterKey], { logger, conf });
              if (hook && hook.isGood()) {
                filtersIndex.push(filterKey);
                hooks[filterKey] = hook;
                filters[filterKey] = filter;
              }
            }
          });
        }

        return resolve(name);
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

  return {
    init, filter
  };
}

module.exports = DDoc;
