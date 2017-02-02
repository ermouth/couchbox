require('sugar');
const crypto = require('crypto');
const UglifyJS = require('uglify-js');

const uuid = module.exports.uuid = (now = Date.now()) => (now+'').substr(0,12)+('0000'+Number.random(46656,2821109907455).toString(36)).substr(-8);

const hashMD5 = module.exports.hashMD5 = (data) => crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');

const parseJSON = module.exports.parseJSON = function parseJSON(json) {
  let result;
  try {
    result = JSON.parse(json);
  } catch (e) {
    result = undefined;
  }
  return result;
};

const coverFunction = (funcSrc) => '(' + funcSrc + ')';

const uglifyParse = (funcSrc) => UglifyJS.parse(coverFunction(funcSrc));

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

const evalFunc = module.exports.evalFunc = (funcSrc) => eval(coverFunction(funcSrc));

const makeFunc = module.exports.makeFunc = function makeFunc(funcSrc) {
  uglifyParse(funcSrc);
  return evalFunc(funcSrc);
};

const checkPhone = module.exports.checkPhone = function checkPhone(phone) {
  if (!phone || phone.length < 9) return null;
  try {
    phone = phone.slice(0, 30).replace(/\D/g, '');
    if (/^(7|8)9\d{9}$/.test(phone)) return phone.slice(1);
    if (/^9\d{9}$/.test(phone)) return phone;
  } catch (e) { }
  return null;
};
