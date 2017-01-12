const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../lib');
const Logger = require('../utils/log');
require('sugar');

const HOOK_MODES = {
  'parallel': 'parallel',
  'transitive': 'transitive',
  'sequential': 'sequential',
};
const HOOK_DEFAULT_TIMEOUT = 10e3;
const HOOK_DEFAULT_MODE = HOOK_MODES['transitive'];


const contextGlobal = {
  Error, setTimeout,
  Promise,
  isArray: Array.isArray
};
const availableGlobals = Object.keys(contextGlobal).concat(['resolve', 'reject']);


function Hook(name, params = {}, props = {}) {
  const { conf, ctx } = props;
  const logger = new Logger({
    prefix: 'Hook '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  const timeout = params.timeout && params.timeout > 0 ? params.timeout : HOOK_DEFAULT_TIMEOUT;
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
    catch (error) { log({ error }); }
    return field;
  }

  function _compileLambda(lambdaSrc) {
    const lambdaGlobal = {
      log,
      require: _require
    };
    const lambdaScope = { };

    const validationResult = lib.validateGlobals(lambdaSrc, { available: availableGlobals.concat(Object.keys(lambdaGlobal)) });
    if (validationResult && validationResult.length) {
      throw new Error('Bad function validation: '+ JSON.stringify(validationResult));
    }

    _script = new vm.Script('new Promise((resolve, reject) => (' + lambdaSrc + ').call(lambdaScope, change) );');

    _lambda = (change) => {
      const boxScope = Object.assign({}, contextGlobal, lambdaGlobal, { lambdaScope, change });
      let result;
      try {
        result = _script.runInNewContext(boxScope);
      } catch(error) {
        log({ error });
        result = undefined;
      }
      return result;
    };
  }

  try {
    _compileLambda(params.lambda);
    isGood = true;
  } catch (error) {
    isGood = false;
    log({ error });
  }

  function run(change) {
    return _lambda(change).timeout(timeout || conf.hookTimeout);
  }

  return {
    name, run, isGood: () => isGood === true
  };
}

module.exports = Hook;
