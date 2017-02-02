const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const { makeModules } = require('../utils/ddocModules');
const Hook = require('./hook');
const config = require('../config');

// methods
const cache = require('../methods/cache');
const fetch = require('../methods/fetch');
const socket = require('../methods/socket');
const sms = require('../methods/sms');
const Bucket = require('../methods/bucket');


const { LOG_EVENT_DDOC_INIT, LOG_EVENT_DDOC_ERROR, LOG_EVENT_FILTER_ERROR } = require('../constants/logEvents');
const { BUCKET_DDOC_CONTEXT_DENY } = require('../constants/bucket');


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
          const hookProps = Object.assign({}, filterProps, makeModules(body, { log, bucket: db, methods }));

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
