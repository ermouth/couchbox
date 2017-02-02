require('sugar');
const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const { lambdaAvailable } = require('../constants/lambdaGlobal');
const config = require('../config');

const sms = require('../methods/sms');

const { LOG_EVENT_API_HANDLER_LOG, LOG_EVENT_API_HANDLER_ERROR } = require('../constants/logEvents');
const { API_DEFAULT_TIMEOUT } = require('../constants/api');

function Handler(path, params = {}, props = {}) {
  const { _require, ctx = {}, context } = props;
  const logger = new Logger({
    prefix: 'API handler '+ path,
    logger: props.logger
  });
  const log = logger.getLog();

  if (!context) {
    log({
      message: 'Error no api handler context: '+ path,
      error: new Error('No context'),
      event: LOG_EVENT_API_HANDLER_ERROR
    });
    return { path, isGood: false };
  }

  if (!params.lambda) {
    log({
      message: 'Error run api handler lambda: '+ path,
      error: new Error('No lambda'),
      event: LOG_EVENT_API_HANDLER_ERROR
    });
    return { path, isGood: false };
  }

  const lambdaSrc = params.lambda;
  const timeout = params.timeout && params.timeout > 0 ? params.timeout : (config.get('process.timeout') || API_DEFAULT_TIMEOUT);
  const validate = params.dubug !== true;

  if (validate) {
    const validationResult = lib.validateGlobals(lambdaSrc, { available: lambdaAvailable });
    if (validationResult && validationResult.length) {
      log({
        message: 'Error run api handler lambda: '+ path,
        error: new Error('Bad function validation: '+ JSON.stringify(validationResult)),
        event: LOG_EVENT_API_HANDLER_ERROR,
      });
      return { path, isGood: false };
    }
  }

  const _script = new vm.Script('(function(require, log, req) { return new Promise((resolve, reject) => (' + lambdaSrc + ').call(this, req) ); })');

  const _lambda = (req) => {
    let result;
    // TODO: log ref - full url
    const _log = (message, now) => log(Object.assign({ event: LOG_EVENT_API_HANDLER_LOG }, Object.isObject(message) ? message : { message }), now);
    const methods = {};
    if (ctx._sms) methods._sms = sms.fill(undefined, undefined, _log);
    try {
      result = _script.runInContext(context, { timeout }).call(Object.assign({}, ctx, methods), _require, _log, req);
    } catch(error) {
      log({
        message: 'Error run api handler lambda: '+ path,
        event: LOG_EVENT_API_HANDLER_ERROR,
        error
      });
      result = undefined;
    }
    return result ? result.timeout(timeout) : Promise.reject(new Error('Bad handler'));
  };

  return {
    path, timeout,
    run: _lambda,
    isGood: true
  };
}

module.exports = Handler;
