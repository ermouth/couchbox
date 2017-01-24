require('sugar');
const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../lib');
const Logger = require('../utils/log');
const { lambdaGlobals, availableGlobals } = require('./lambdaGlobal');
const config = require('../config');


const HOOK_MODES = {
  'parallel': 'parallel',
  'transitive': 'transitive',
  'sequential': 'sequential',
};
const HOOK_DEFAULT_TIMEOUT = 10e3;
const HOOK_DEFAULT_MODE = HOOK_MODES['transitive'];

function Hook(name, params = {}, props = {}) {
  const { _require, ctx = {} } = props;
  const logger = new Logger({
    prefix: 'Hook '+ name,
    logger: props.logger
  });
  const log = logger.getLog();


  if (!params.lambda) {
    log({
      message: 'Error run hook lambda: '+ name,
      error: new Error('No lambda')
    });
    return { name, isGood: false };
  }

  const lambdaSrc = params.lambda;
  const timeout = params.timeout && params.timeout > 0 ? params.timeout : (config.get('hooks.timeout') || HOOK_DEFAULT_TIMEOUT);
  const mode = params.mode && HOOK_MODES[params.mode] ? params.mode : HOOK_DEFAULT_MODE;
  const since = params.since && params.since > 0 ? params.since : 'now';
  const attachments = params.attachments || false;
  const conflicts = params.conflicts || false;

  const hookGlobals = { log, require: _require };
  const context = new vm.createContext(Object.assign({}, lambdaGlobals, hookGlobals));

  const validationResult = lib.validateGlobals(lambdaSrc, { available: availableGlobals.concat(Object.keys(hookGlobals)) });
  if (validationResult && validationResult.length) {
    log({
      message: 'Error run hook lambda: '+ name,
      error: new Error('Bad function validation: '+ JSON.stringify(validationResult))
    });
    return { name, isGood: false };
  }

  const _script = new vm.Script('(function(doc, change) { return new Promise((resolve, reject) => (' + lambdaSrc + ').call(this, doc, change) ); })');

  const _lambda = (change) => {
    let result;
    try {
      result = _script.runInContext(context, { timeout }).call(ctx, change.doc, change);
    } catch(error) {
      log({ message: 'Error run hook lambda: '+ name, error });
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
