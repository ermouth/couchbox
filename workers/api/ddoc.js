const Promise = require('bluebird');
const vm = require('vm');
const Logger = require('../../utils/logger');
const { makeContext, makeHandler } = require('../../utils/modules');
const config = require('../../config');

const {
  API_DEFAULT_TIMEOUT,
  LOG_EVENTS: {
    DDOC_INIT, API_LOG, API_ERROR
  }
} = require('./constants');

function DDoc(props = {}) {
  const { bucket, name, domain, endpoint, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc '+ name,
    logger: props.logger
  });
  const log = logger.getLog();
  const ddoc = this;

  return new Promise((resolve, reject) => {
    bucket.get('_design/'+ name, {}, (error, body) => {
      if (error) return reject(error);

      const id = body._id;
      const rev = body._rev;

      let timeout = 0;

      const handlerFilter = (handler) => {
        if (handler) {
          if (timeout < handler.timeout) timeout = handler.timeout;
          return true;
        }
      };
      const onHandlerError = (handlerKey, error) => {
        log({
          message: 'Error init api lambda: '+ handlerKey,
          event: API_ERROR,
          error
        });
        return null;
      };

      log({
        message: 'Started ddoc: "'+ name + '" with methods: "'+ methods.join(',') +'" and req path: "' + domain +'/'+ endpoint + '"',
        event: DDOC_INIT
      });

      const referrer = ([request]) => request.raw_path;
      const context = makeContext(body, log);

      const handlerProps = Object.assign({ logger, logEvent: API_LOG, errorEvent: API_ERROR, methods, referrer }, context);
      const apiHandlers = Object.keys(body.api || {}).map(handlerKey =>
        makeHandler(bucket, name, handlerKey, body.api[handlerKey], handlerProps)
          .catch(error => onHandlerError(handlerKey, error))
      );

      Promise.all(apiHandlers).then(handlers => {
        const api = handlers.filter(handlerFilter);
        return resolve({ name, id, rev, domain, endpoint, methods, api, timeout: timeout || API_DEFAULT_TIMEOUT });
      });
    });
  });
}

module.exports = DDoc;
