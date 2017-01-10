const Promise = require('bluebird');
const lib = require('../lib');

function Filter(name, lambda, params) {
  const { logger } = params;
  const log = logger.getLog({ prefix: 'Filter '+ name });

  let _lambda;
  let isGood = false;

  try {
    _lambda = lib.makeFunc(lambda);
    isGood = true;
  } catch(error) {
    isGood = false;
    log(error);
  }

  function filter(change) {
    return isGood && !!_lambda(change);
  }

  return {
    isGood: () => !!isGood,
    filter
  };
}

module.exports = Filter;
