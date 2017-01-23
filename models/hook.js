require('sugar');
const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../lib');
const Logger = require('../utils/log');
const config = require('../config');


const HOOK_MODES = {
  'parallel': 'parallel',
  'transitive': 'transitive',
  'sequential': 'sequential',
};
const HOOK_DEFAULT_TIMEOUT = 10e3;
const HOOK_DEFAULT_MODE = HOOK_MODES['transitive'];


const contextGlobal = { Error, setTimeout, Promise, isArray: Array.isArray };
const availableGlobals = Object.keys(contextGlobal).concat(['resolve', 'reject']);


function Hook(name, params = {}, props = {}) {
  const { ctx, methods } = props;
  const logger = new Logger({
    prefix: 'Hook '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  const timeout = params.timeout && params.timeout > 0 ? params.timeout : (config.get('hooks.timeout') || HOOK_DEFAULT_TIMEOUT);
  const mode = params.mode && HOOK_MODES[params.mode] ? params.mode : HOOK_DEFAULT_MODE;
  const since = params.since && params.since > 0 ? params.since : 'now';
  const attachments = params.attachments || false;
  const conflicts = params.conflicts || false;

  let _script;
  let _lambda;
  let isGood = false;

  function _require(fieldName) {
    let field;
    try { field = ctx[fieldName]; }
    catch (error) { log({ message: 'Error require field: '+ fieldName, error }); }
    return field;
  }

  function _compileLambda(lambdaSrc) {
    const lambdaGlobal = { log, require: _require };
    const lambdaScope = Object.assign({}, methods);

    const validationResult = lib.validateGlobals(lambdaSrc, { available: availableGlobals.concat(Object.keys(lambdaGlobal)) });
    if (validationResult && validationResult.length) {
      throw new Error('Bad function validation: '+ JSON.stringify(validationResult));
    }

    _script = new vm.Script('new Promise((resolve, reject) => (' + lambdaSrc + ').call(lambdaScope, doc, change) );');

    _lambda = (change) => {
      const boxScope = Object.assign({}, contextGlobal, lambdaGlobal, { lambdaScope, doc: change.doc, change });
      const boxParams = { timeout };

      let result;
      try {
        result = _script.runInNewContext(boxScope, boxParams);
      } catch(error) {
        log({ message: 'Error run hook lambda: '+ name, error });
        result = undefined;
      }

      return result ? result.timeout(timeout) : result;
    };
  }

  try {
    _compileLambda(params.lambda);
    isGood = true;
  } catch (error) {
    isGood = false;
    log({ message: 'Error compile hook lambda: '+ name, error });
  }

  return {
    name,
    run: _lambda,
    isGood: () => isGood === true
  };
}

module.exports = Hook;
