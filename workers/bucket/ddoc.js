const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const { makeModules } = require('../../utils/ddocModules');
const config = require('../../config');
const Hook = require('./hook');

const { LOG_EVENT_DDOC_INIT, LOG_EVENT_DDOC_ERROR, LOG_EVENT_FILTER_ERROR } = require('../../constants/logEvents');


function Filter(ddoc, name, lambda, props) {
  const filterName = ddoc +'/'+ name;
  const logger = new Logger({
    prefix: 'Filter '+ filterName,
    logger: props.logger
  });
  const log = logger.getLog();

  let _lambda;

  try {
    _lambda = lib.makeFunc(lambda);
  } catch(error) {
    _lambda = undefined;
    log({
      message: 'Error compile filter lambda: '+ filterName,
      event: LOG_EVENT_FILTER_ERROR,
      error
    });
  }

  return _lambda
    ? (doc) => _lambda(doc) === true
    : undefined;
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
            const filter = new Filter(name, filterKey, body.filters[filterKey], filterProps);
            if (filter) {
              const hook = new Hook(name, filterKey, body.hooks[filterKey], hookProps);
              if (hook) {
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
        filterResult = filters.get(filterKey)(change.doc);
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
