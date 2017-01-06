const crypto = require('crypto');
const vm = require('vm');
const Promise = require('bluebird');
const sugar = require('sugar');
const UglifyJS = require('uglify-js');

const log = module.exports.log = function log(msg) {
  const time = new Date();
	console.log(`${time.iso()}: ${JSON.stringify(msg)}`);
};

const hash = module.exports.hash = function hash(data) {
  // TODO: use more quickly hash function
  let md5sum = crypto.createHash('md5');
  md5sum.update(JSON.stringify(data));
  const sum = md5sum.digest('hex');
  md5sum = null;
  return sum;
};

const getGlobals = module.exports.getGlobals = function getGlobals(funcSrc) {
  if (!funcSrc) return null;

  let ast;

  try {
    ast = UglifyJS.parse(`(${funcSrc})`);
  } catch (e) {
    log('ERROR parse');
  }

  if (!ast) {
    return null;
  }

  ast.figure_out_scope();
  if (typeof(ast.globals) == "object" && ast.globals._size) {
    return Object.keys(ast.globals._values).map(valueKey => ast.globals._values[valueKey].name);
  }
  return [];
};

const validateGlobals = module.exports.validateGlobals = function validateGlobals(funcSrc, params = {}) {
  const globals = getGlobals(funcSrc);
  if (!globals) {
    return false;
  }

  let isGood = true;
  if (params.available && params.available.length) {
    const available = {};
    params.available.forEach(key => { available[key] = true; })
    for (let i = globals.length; i--;) {
      if (!available[globals[i]]) {
        isGood = false;
        break;
      }
    }
  } else if (params.inaccessible && params.inaccessible.length) {

  }
  return isGood;
};

const makeFunc =module.exports.makeFunc = function makeFunc(lambdaString, options = {}) {
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
