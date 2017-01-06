const crypto = require('crypto');
const vm = require('vm');
const Promise = require('bluebird');
const sugar = require('sugar');

module.exports.log = function log(msg) {
  const time = new Date();
	console.log(`${time.iso()}: ${JSON.stringify(msg)}`);
};

module.exports.hash = function hash(data) {
  // TODO: use more quickly hash function
  let md5sum = crypto.createHash('md5');
  md5sum.update(JSON.stringify(data));
  const sum = md5sum.digest('hex');
  md5sum = null;
  return sum;
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
