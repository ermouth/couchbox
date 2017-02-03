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

  if (!context) throw new Error('No context');
  if (!params.lambda) throw new Error('No lambda');

  const lambdaSrc = params.lambda;
  const timeout = params.timeout && params.timeout > 0 ? params.timeout : (config.get('process.timeout') || API_DEFAULT_TIMEOUT);
  const validate = params.dubug !== true;

  if (validate) {
    const validationResult = lib.validateGlobals(lambdaSrc, { available: lambdaAvailable });
    if (validationResult && validationResult.length) {
      throw new Error('Bad lambda validation: '+ JSON.stringify(validationResult));
    }
  }

  const _script = new vm.Script('(function(require, log, req) { return new Promise((resolve, reject) => (' + lambdaSrc + ').call(this, req) ); })');

  const handler = (req) => {
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

  return { path, timeout, handler };
}

module.exports = Handler;
