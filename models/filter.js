const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');

function Filter(name, lambda, props) {
  const logger = new Logger({
    prefix: 'Filter '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  let _lambda;
  let isGood = false;

  try {
    _lambda = lib.makeFunc(lambda);
    isGood = true;
  } catch(error) {
    isGood = false;
    log({ message: 'Error compile filter lambda: '+ name, error });
  }

  function filter(change) {
    return isGood && !!_lambda(change);
  }

  return {
    name, filter, isGood: () => isGood === true
  };
}

module.exports = Filter;
