const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const { makeContext, makeHandler } = require('../../utils/modules');
const config = require('../../config');


const { DDOC_INIT, DDOC_ERROR, FILTER_ERROR, HOOK_ERROR, HOOK_LOG } = require('./constants').LOG_EVENTS;

function DDoc(bucket, bucketName, props = {}) {
  const { name, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc '+ name,
    logger: props.logger
  });
  const log = logger.getLog();
  const ddoc = this;

  const hooks = new Map();
  const filters = [];

  let id;
  let rev = props.rev;
  let seq;

  function init() {
    return new Promise((resolve, reject) => {
      bucket.get('_design/'+ name, { local_seq: true, rev }, (error, body) => {
        if (error) return reject(error);

        id = body._id;
        rev = body._rev;
        seq = body._local_seq;

        const referrer = ([doc]) => bucketName +'/'+ doc._id +'/'+ doc._rev;
        const context = makeContext(body, log);
        const keys = Object.keys(body.filters || {}).sort();

        Promise.all(keys.map(key => {
          const filterSrc = body.filters[key];
          const hookParams = body.hooks[key];
          if (!filterSrc || !hookParams) return Promise.resolve();
          let filter;
          try {
            filter = lib.evalFunc(filterSrc);
          } catch (error) {
            log({
              message: 'Error compile filter: '+ key,
              event: FILTER_ERROR,
              error
            });
          }
          if (filter) {
            const onHandlerError = (error) => {
              log({
                message: 'Error init hook lambda: '+ key,
                event: HOOK_ERROR,
                error
              });
              return null;
            };
            const handlerProps = Object.assign({ logger, logEvent: HOOK_LOG, errorEvent: HOOK_ERROR, methods, referrer }, context);
            return makeHandler(bucket, name, key, hookParams, handlerProps).catch(onHandlerError).then(handler => {
              if (handler && handler.handler) {
                const hook = {
                  name: key,
                  mode: hookParams.mode,
                  handler: handler.handler
                };
                return { key, filter, hook };
              }
            })
          }
          else return Promise.resolve();
        })).then(handlers => {
          handlers.filter(i => i && i.key).map(({ key, filter, hook }) => {
            hooks.set(key, { filter, hook });
            return key;
          }).sort().forEach(k => filters.push(k));

          log({
            message: 'Started ddoc: '+ name,
            event: DDOC_INIT,
            error
          });

          return resolve({ seq });
        });
      });
    });
  }

  const getInfo = () => ({ name, rev, methods });
  const getHook = (key) => hooks.has(key) ? hooks.get(key).hook : null;

  const filter = (change) => {
    const res = [];
    filters.forEach(key => {
      const { filter, hook } = hooks.get(key);
      let filterRes = false;
      try {
        filterRes = filter(change.doc);
      } catch (e) {
        filterRes = false;
        log({
          message: 'Error on filter: '+ name +'/'+ key,
          event: DDOC_ERROR,
          error
        });
      }
      if (filterRes) res.push(hook);
    });
    return res;
  };

  return { name, init, filter, getInfo, getHook };
}

module.exports = DDoc;
