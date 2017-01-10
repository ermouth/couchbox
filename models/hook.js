const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../lib');
require('sugar');

const HOOK_MODES = {
  'parallel': 'parallel',
  'transitive': 'transitive',
  'sequential': 'sequential',
}
const HOOK_DEFAULT_TIMEOUT = 10e3;
const HOOK_DEFAULT_MODE = HOOK_MODES['transitive'];


const libContext = {
  Error, setTimeout,
  Promise,
  isArray: Array.isArray
};
const availableGlobals = Object.keys(libContext).concat(['resolve', 'reject']);


function Hook(name, props = {}, params = {}) {
  const { logger } = params;
  const log = logger.getLog({ prefix: 'Hook '+ name });

  const mode = props.mode && HOOK_MODES[props.mode] ? props.mode : HOOK_DEFAULT_MODE;
  const timeout = props.timeout && props.timeout > 0 ? props.timeout : HOOK_DEFAULT_TIMEOUT;
  const since = props.since && props.since > 0 ? props.since : 'now';
  const attachments = props.attachments || false;
  const conflicts = props.conflicts || false;

  let _script;
  let _lambda;
  let isGood = false;

  function _compileLambda(lambdaSrc) {
    const lambdaScope = { log };

    const validationResult = lib.validateGlobals(lambdaSrc, { available: availableGlobals.concat(Object.keys(lambdaScope)) });
    if (validationResult && validationResult.length) {
      throw new Error('Bad function validation: '+ JSON.stringify(validationResult));
    }

    _script = new vm.Script('new Promise((resolve, reject) => (' + lambdaSrc + ').call(lambdaScope, change) );');

    _lambda = (change) => {
      const boxScope = Object.assign({}, libContext, { lambdaScope, change });
      let result;
      try {
        result = _script.runInNewContext(boxScope);
      } catch(err) {
        result = undefined;
        console.error(err);
      }
      return result;
    };
  }

  try {
    _compileLambda(props.lambda);
    isGood = true;
  } catch (error) {
    isGood = false;
    log(error);
  }

  function run(change) {
    return _lambda(change).timeout(timeout);
  }

  return {
    isGood: () => !!isGood,
    run
  };
}

module.exports = Hook;
