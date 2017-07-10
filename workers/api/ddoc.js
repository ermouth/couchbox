const Promise = require('bluebird');
const vm = require('vm');
const Logger = require('../../utils/logger');
const { getDDoc } = require('../../utils/couchdb');
const { makeContext, makeHandler } = require('../../utils/modules');
const config = require('../../config');

const {
  API_DEFAULT_TIMEOUT,
  API_REFERRER_PARSER,
  LOG_EVENTS: {
    DDOC_INIT, API_LOG, API_ERROR, API_LAMBDA_ERROR
  }
} = require('./constants');

function DDoc(bucket, bucketName, props = {}) {
  const { name, domain, endpoint, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc',
    scope: bucketName +'/_'+ name,
    logger: props.logger
  });
  const log = logger.getLog();
  const ddoc = this;

  return getDDoc(bucket, name).then(body => {
    const id = body._id;
    const rev = body._rev;
    let timeout = 0;

    const onHandlerError = (handlerKey, error) => {
      log({
        message: 'Error init api lambda: '+ handlerKey,
        event: API_LAMBDA_ERROR,
        error,
        type: 'fatal'
      });
    };
    const onHandlerResult = ({ methods }, handler) => {
      if (handler && Object.isObject(handler)) {
        return Object.assign(handler, { methods });
      }
    };
    const handlerFilter = (handler) => {
      if (handler) {
        if (timeout < handler.timeout) timeout = handler.timeout;
        return true;
      }
    };

    log({
      message: 'Started ddoc: "'+ name + '" with methods: "'+ methods.join(',') +'" and req path: "' + domain +'/'+ endpoint + '"',
      event: DDOC_INIT
    });

    const referrer = ([request]) => API_REFERRER_PARSER(request);
    const context = makeContext(name, body, log);

    const handlerProps = Object.assign(
      { logger, logEvent: API_LOG, errorEvent: API_ERROR, methods, referrer },
      context
    );

    const handlerMaker = (handlerKey) => {
      const handlerBody = body.api[handlerKey];
      return makeHandler(bucketName, bucket, name, handlerKey, handlerBody, handlerProps)
        .then(result => onHandlerResult(handlerBody, result))
        .catch(error => onHandlerError(handlerKey, error));
    };

    const makeDdoc = (handlers) => ({
      name,
      id,
      rev,
      domain,
      endpoint,
      methods,
      api: handlers.filter(handlerFilter),
      timeout: timeout || API_DEFAULT_TIMEOUT
    });

    return Promise.map(Object.keys(body.api || {}), handlerMaker).then(makeDdoc);
  });
}

module.exports = DDoc;
