const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const { getDDoc } = require('../../utils/couchdb');
const { makeContext, makeHandler } = require('../../utils/modules');
const config = require('../../config');


const { DDOC_INIT, BUCKET_FILTER_ERROR, BUCKET_LAMBDA_ERROR, HOOK_ERROR, HOOK_LOG } = require('./constants').LOG_EVENTS;

function DDoc(bucket, bucketName, props = {}) {
  const { name, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc',
    scope: bucketName +'/'+ name,
    logger: props.logger
  });
  const log = logger.getLog();
  const ddoc = this;

  let rev = props.rev;
  let seq = 0;

  return getDDoc(bucket, name, { local_seq: true, rev }).then(body => {
    rev = body._rev;
    seq = body._local_seq;

    const referrer = ([doc]) => bucketName +'/'+ seq +'/'+ doc._id;
    const context = makeContext(name, body, log);

    const makeHook = (key, filterSrc, hookParams) => {
      if (!(Object.isString(filterSrc) && Object.isObject(hookParams))) return Promise.resolve();
      let filter;
      try {
        filter = lib.evalFunc(filterSrc);
      } catch (error) {
        log({
          message: 'Error compile filter: '+ key,
          event: BUCKET_FILTER_ERROR,
          error,
          type: 'fatal'
        });
      }

      if (filter) {
        const hookProps = Object.assign({ logger, logEvent: HOOK_LOG, errorEvent: HOOK_ERROR, methods, referrer }, context);
        return makeHandler(bucketName, bucket, name, key, hookParams, hookProps)
          .then(handler => {
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
          .catch((error) => log({
            message: 'Error init hook lambda: '+ key,
            event: BUCKET_LAMBDA_ERROR,
            error,
            type: 'fatal'
          }));
      }
    };

    return Promise.map(Object.keys(body.filters || {}), (key) => makeHook(key, body.filters[key], body.hooks[key]))
      .filter(h => h && h.key)
      .call('sortBy', 'key');
  }).then(handlers => {

    log({
      message: 'Started ddoc: '+ name,
      event: DDOC_INIT
    });

    return { seq, rev, handlers };
  });
}

module.exports = DDoc;
