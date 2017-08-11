const Promise = require('bluebird');
const Logger = require('../../utils/logger');
const { getDDoc } = require('../../utils/couchdb');
const { makeContext, makeHandler } = require('../../utils/modules');

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
    scope: bucketName +'/'+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  function onDdocInit(body) {
    const id = body._id;
    const rev = body._rev;
    let timeout = 0;

    log({
      message: 'Started ddoc: "'+ name + '" with methods: "'+ methods.join(',') +'" and req path: "' + domain +'/'+ endpoint + '"',
      event: DDOC_INIT
    });

    function refParser([request]) {
      return API_REFERRER_PARSER(request);
    }

    const handlerProps = Object.assign({
        logger,
        logEvent: API_LOG,
        errorEvent: API_ERROR,
        methods,
        refParser
      },
      makeContext(name, body, log)
    );

    function handlerMaker(handlerKey) {
      const handlerBody = body.api[handlerKey];
      return makeHandler(bucketName, bucket, name, handlerKey, handlerBody, handlerProps)
        .then(function onHandlerResult(handler) {
          if (handler && Object.isObject(handler)) {
            return Object.assign(handler, { methods: handlerBody.methods });
          }
        })
        .catch(function onHandlerError(error) {
          log({
            message: 'Error init api lambda: '+ handlerKey,
            event: API_LAMBDA_ERROR,
            error,
            type: 'fatal'
          });
        });
    }

    function handlerFilter(handler) {
      if (handler) {
        if (timeout < handler.timeout) timeout = handler.timeout;
        return true;
      }
    }

    function makeDdoc(handlers) {
      return {
        name,
        id,
        rev,
        domain,
        endpoint,
        methods,
        api: handlers.filter(handlerFilter),
        timeout: timeout || API_DEFAULT_TIMEOUT
      };
    }

    return Promise.map(Object.keys(body.api || {}), handlerMaker).then(makeDdoc);
  }

  return getDDoc(bucket, name).then(onDdocInit);
}

module.exports = DDoc;
