const Promise = require('bluebird');
const sugar = require('sugar');
const vm = require('vm');

module.exports.log = function log(msg) {
  const time = new Date();
	console.log(`${time.iso()}: ${JSON.stringify(msg)}`);
};

module.exports.makeFunc = function _makeFunc(lambdaString, options = {}) {
  if (!lambdaString) {
    return function(){ return; };
  }
  let lambda;
  try {
    lambda = eval(`(${lambdaString})`);
  } catch(e) {
    console.error(e);
  }
  return lambda;
};
