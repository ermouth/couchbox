const Promise = require('bluebird');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const { getDDoc } = require('../../utils/couchdb');
const { makeContext, makeHandler } = require('../../utils/modules');


const { DDOC_INIT, FILTER_ERROR, BUCKET_LAMBDA_ERROR, HOOK_ERROR, HOOK_LOG } = require('./constants').LOG_EVENTS;

function DDoc(bucket, bucketName, props = {}) {
  const { name, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc',
    scope: bucketName +'/'+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  let rev = props.rev;
  let seq = 0;

  function onDdocInit(body) {
    rev = body._rev;
    seq = body._local_seq;

    function refParser([doc]) {
      return bucketName +'/'+ seq +'/'+ doc._id;
    }

    function makeHook(key, filterSrc, hookParams) {
      if (!(Object.isString(filterSrc) && Object.isObject(hookParams))) return Promise.resolve();
      let filter;
      try {
        filter = lib.evalFunc(filterSrc);
      } catch (error) {
        log({
          message: 'Error compile filter: '+ key,
          event: FILTER_ERROR,
          error,
          type: 'fatal'
        });
      }

      if (filter) {
        const hookProps = Object.assign({ logger, logEvent: HOOK_LOG, errorEvent: HOOK_ERROR, methods, refParser }, makeContext(name, body, log));
        return makeHandler(bucketName, bucket, name, key, hookParams, hookProps)
          .then(function onHandler(handler) {
            if (handler && handler.handler) {
              return {
                key,
                filter,
                hook: {
                  name: name +'/'+ key,
                  mode: hookParams.mode,
                  handler: handler.handler
                }
              };
            }
          })
          .catch(function onHandlerError(error) {
            log({
              message: 'Error init hook lambda: '+ key,
              event: BUCKET_LAMBDA_ERROR,
              error,
              type: 'fatal'
            })
          });
      }
    }

    return Promise.map(Object.keys(body.filters || {}), (key) => makeHook(key, body.filters[key], body.hooks[key]))
      .filter(h => h && h.key)
      .call('sortBy', 'key');
  }

  function onHandlers(handlers) {
    log({
      message: 'Started ddoc: '+ name,
      event: DDOC_INIT
    });
    return { seq, rev, handlers };
  }

  return getDDoc(bucket, name, { local_seq: true, rev })
    .then(onDdocInit)
    .then(onHandlers);
}

module.exports = DDoc;
