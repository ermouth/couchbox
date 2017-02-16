require('sugar');
const crypto = require('crypto');
const globalsDetect = require('acorn-globals');

const uuid = module.exports.uuid = (now = Date.now()) => (now+'').substr(0,12)+('0000'+Number.random(46656,2821109907455).toString(36)).substr(-8);

const sdbmCode = module.exports.sdbmCode = function sdbmCode(src) {
  // Very fast hash used in Berkeley DB
  const s = JSON.stringify(src), length = s.length;
  let i = 0, hash = -219;
  while (i < length) hash = s.charCodeAt(i++)+(hash<<6)+(hash<<16)-hash;
  return (1e11+hash).toString(36);
};

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

const getGlobals = module.exports.getGlobals = function getGlobals(src) {
  return (src) ? globalsDetect(src).map(i => i.name) : null;
};

const validateGlobals = module.exports.validateGlobals = function validateGlobals(funcSrc, params = {}) {
  let globals;
  try {
    globals = getGlobals(funcSrc);
  } catch(error) {
    return error;
  }

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

const checkPhone = module.exports.checkPhone = function checkPhone(phone) {
  if (!phone || phone.length < 9) return null;
  try {
    phone = phone.slice(0, 30).replace(/\D/g, '');
    if (/^(7|8)9\d{9}$/.test(phone)) return phone.slice(1);
    if (/^9\d{9}$/.test(phone)) return phone;
  } catch (e) { }
  return null;
};

const toBase64 = module.exports.toBase64 = function toBase64(str) {
  return new Buffer(str).toString('base64');
};

module.exports.errorBeautify = function errorStackGrabber(error) {
  if (!error) return error;
  switch (error.message) {
    case 'operation timed out':
      return {
        message: 'gateway_timeout',
        reason: error.message,
        code: 504,
        error: error
      };
  }
  if (error.stack) {
    const stack = error.stack.split(/\n/g, 2);
    if (stack && stack.length === 2) {
      const errPos = stack[1].match(/at\sObject\.(.*)\s.+>:(\d+):(\d+)\)/);
      if (errPos && errPos.length && errPos[1] && errPos[2] >= 0 && errPos[3] >= 0) {
        error.message += ' at "'+ errPos[1] +'" on ('+ errPos[2] + ':'+ errPos[3] + ')';
      }
    }
  }
  return error;
};
