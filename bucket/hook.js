require('sugar');
const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const { lambdaAvailable } = require('../constants/lambdaGlobal');
const config = require('../config');

const sms = require('../methods/sms');

const { LOG_EVENT_HOOK_ERROR, LOG_EVENT_HOOK_LOG } = require('../constants/logEvents');

const HOOK_MODES = {
  'parallel': 'parallel',
  'transitive': 'transitive',
  'sequential': 'sequential',
};
const HOOK_DEFAULT_TIMEOUT = 10e3;
const HOOK_DEFAULT_MODE = HOOK_MODES['transitive'];

function Hook(name, params = {}, props = {}) {
  const { _require, ctx = {}, context } = props;
  const logger = new Logger({
    prefix: 'Hook '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  if (!context) {
    log({
      message: 'Error no hook context: '+ name,
      error: new Error('No context'),
      event: LOG_EVENT_HOOK_ERROR
    });
    return { name, isGood: false };
  }

  if (!params.lambda) {
    log({
      message: 'Error run hook lambda: '+ name,
      error: new Error('No lambda'),
      event: LOG_EVENT_HOOK_ERROR
    });
    return { name, isGood: false };
  }

  const lambdaSrc = params.lambda;
  const timeout = params.timeout && params.timeout > 0 ? params.timeout : (config.get('process.timeout') || HOOK_DEFAULT_TIMEOUT);
  const validate = params.dubug !== true;
  const mode = params.mode && HOOK_MODES[params.mode] ? params.mode : HOOK_DEFAULT_MODE;
  const since = params.since && params.since > 0 ? params.since : 'now';
  const conflicts = params.conflicts || false;

  if (validate) {
    const validationResult = lib.validateGlobals(lambdaSrc, { available: lambdaAvailable });
    if (validationResult && validationResult.length) {
      log({
        message: 'Error run hook lambda: '+ name,
        error: new Error('Bad function validation: '+ JSON.stringify(validationResult)),
        event: LOG_EVENT_HOOK_ERROR,
      });
      return { name, isGood: false };
    }
  }

  const _script = new vm.Script('(function(require, log, doc) { return new Promise((resolve, reject) => (' + lambdaSrc + ').call(this, doc) ); })');

  const _lambda = (change) => {
    let result;
    const _log = (message, now) => log(Object.assign({ ref: change.id, event: LOG_EVENT_HOOK_LOG }, Object.isObject(message) ? message : { message }), now);
    const doc = Object.clone(change.doc, true);
    const methods = {};
    if (ctx._sms) methods._sms = sms.fill(undefined, undefined, _log);
    try {
      result = _script.runInContext(context, { timeout }).call(Object.assign({}, ctx, methods), _require, _log, doc);
    } catch(error) {
      log({
        message: 'Error run hook lambda: '+ name,
        event: LOG_EVENT_HOOK_ERROR,
        error
      });
      result = undefined;
    }
    return result ? result.timeout(timeout) : result;
  };

  return {
    name,
    run: _lambda,
    isGood: true
  };
}

module.exports = Hook;