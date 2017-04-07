require('sugar');
const crypto = require('crypto');
const globalsDetect = require('acorn-globals');


// Atomics

function notEmpty(val) {
  return val === undefined || val === null;
}

function isEmpty(val) {
  return !notEmpty(val);
}


// Utils

function parseJSON(json) {
  let result;
  try {
    result = JSON.parse(json);
  } catch (e) {
    result = undefined;
  }
  return result;
}

function toBase64(str) {
  return new Buffer(str).toString('base64');
}

function coverFunction(funcSrc) {
  return '(' + funcSrc + ')';
}

function evalFunc(funcSrc) {
  return eval(coverFunction(funcSrc));
}

const addField = function addField(obj = {}, path, value, separator = '.') {
  const fieldPath = Object.isString(path) ? path.split(separator) : path;
  const field = fieldPath.shift();
  if (field) {
    obj[field] = fieldPath.length > 0
      ? addField(obj[field], fieldPath, value, separator)
      : value;
  }
  return obj;
};

const getField = function getField(obj = {}, path, separator = '.') {
  const fieldPath = Object.isString(path) ? path.split(separator) : path;
  const field = fieldPath.shift();
  if (field) {
    return fieldPath.length > 0
      ? getField(obj[field], fieldPath, separator)
      : obj[field];
  }
  return null;
};


// Hashes

function uuid(now = Date.now()) {
  return (now+'').substr(0,12)+('0000'+Number.random(46656,2821109907455).toString(36)).substr(-8);
}

function guid() {
  const S4 = () => (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}

function sdbmCode(src) {
  // Very fast hash used in Berkeley DB
  const s = JSON.stringify(src), length = s.length;
  let i = 0, hash = -219;
  while (i < length) hash = s.charCodeAt(i++)+(hash<<6)+(hash<<16)-hash;
  return (1e11+hash).toString(36);
}

function hashMD5(data) {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}


// Validators

function checkPhone(phone) {
  if (!phone || phone.length < 9) return null;
  try {
    phone = phone.slice(0, 30).replace(/\D/g, '');
    if (/^(7|8)9\d{9}$/.test(phone)) return phone.slice(1);
    if (/^9\d{9}$/.test(phone)) return phone;
  } catch (e) { }
  return null;
}

function getGlobals(src) {
  return (src) ? globalsDetect(src).map(i => i.name) : null;
}

function validateGlobals(globals, params = {}) {
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
}


// Errors

function errorBeautify(error) {
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
}

module.exports = {
  notEmpty,
  isEmpty,

  parseJSON,
  toBase64,
  coverFunction,
  evalFunc,

  uuid,
  guid,
  sdbmCode,
  hashMD5,

  getField,
  addField,

  checkPhone,
  getGlobals,
  validateGlobals,

  errorBeautify
};
