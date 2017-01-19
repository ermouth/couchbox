require('sugar');
const crypto = require('crypto');
const UglifyJS = require('uglify-js');

const hash = module.exports.hash = function hash(data) {
  // TODO: use more quickly hash function
  let md5sum = crypto.createHash('md5');
  md5sum.update(JSON.stringify(data));
  const sum = md5sum.digest('hex');
  md5sum = null;
  return sum;
};

const parseJSON = module.exports.parseJSON = function parseJSON(json) {
  let result;
  try {
    result = JSON.parse(json);
  } catch (e) {
    result = undefined;
  }
  return result;
};

function coverFunction(funcSrc) {
  return '(' + funcSrc + ')';
}

function uglifyParse(funcSrc) {
  return UglifyJS.parse(coverFunction(funcSrc));;
}

const getGlobals = module.exports.getGlobals = function getGlobals(funcSrc) {
  if (!funcSrc) return null;

  const ast = uglifyParse(funcSrc);

  ast.figure_out_scope();
  if (typeof(ast.globals) == "object" && ast.globals._size) {
    return Object.keys(ast.globals._values).map(valueKey => ast.globals._values[valueKey].name);
  }
  return [];
};

const validateGlobals = module.exports.validateGlobals = function validateGlobals(funcSrc, params = {}) {
  const globals = getGlobals(funcSrc);
  const errors = [];
  if (params.available && params.available.length) {
    const available = {};
    params.available.forEach(key => { available[key] = true; });
    for (let i = globals.length; i--;) {
      if (!available[globals[i]]) {
        errors.push(globals[i]);
      }
    }
  } else if (params.inaccessible && params.inaccessible.length) {
    const inaccessible = {};
    params.inaccessible.forEach(key => { inaccessible[key] = true; });
    for (let i = globals.length; i--;) {
      if (inaccessible[globals[i]]) {
        errors.push(globals[i]);
      }
    }
  }
  return errors.length ? errors : false;
};

const getField = module.exports.getField = (obj = {}, path) => {
  const fieldPath = Object.isString(path) ? path.split('.') : path;
  const field = fieldPath.shift();
  if (field) {
    return fieldPath.length > 0
      ? getField(obj[field], fieldPath)
      : obj[field];
  }
  return null;
};
const addField = module.exports.addField = (obj = {}, path, value) => {
  const fieldPath = Object.isString(path) ? path.split('.') : path;
  const field = fieldPath.shift();
  if (field) {
    obj[field] = fieldPath.length > 0
      ? addField(obj[field], fieldPath, value)
      : value;
  }
  return obj;
};

const makeFunc = module.exports.makeFunc = function makeFunc(funcSrc) {
  uglifyParse(funcSrc);
  return eval(coverFunction(funcSrc));
};
