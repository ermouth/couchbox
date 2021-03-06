/*
* Couchbox, query server extension for CouchDB, v 0.1
* Worker configurator, prepares cfg
* ---------
* (c) 2017 ftescht, ermouth
*/

require('sugar');
const lib = require('./utils/lib');
const { env } = process;


const CONFIG_COUCHBOX = 'couchbox';
const CONFIG_COUCHBOX_PLUGINS = 'couchbox_plugins';
const CONFIG_COUCHBOX_API = 'couchbox_api';
const CONFIG_COUCHBOX_HOOKS = 'couchbox_hooks';


const mapInt = (val) => val|0;
const mapStr = (val) => val;
const mapBool = (val) => val === true || val === 'true';
const mapJSON = (val) => Object.isString(val) ? lib.parseJSON(val) : Object.isObject(val) ? val : undefined;
const mapsStrArr = (splitter, mapper = mapStr) => (val) => {
  return val
    ? Object.isString(val)
      ? val.split(splitter).map(mapper).filter(checkStr)
      : Object.isArray(val) ? val.map(mapper).filter(checkStr) : []
    : [];
};
const mapsIntArr = (splitter) => (val) => {
  return val
    ? Object.isString(val)
      ? val.split(splitter).map(mapInt).filter(checkNumPlus)
      : Object.isArray(val) ? val.map(mapInt).filter(checkNumPlus) : []
    : [];
};
const mapArrCustom = (splitter, mapper = mapStr, checker = checkStr) => (val) => {
  return val
    ? Object.isString(val)
      ? val.split(splitter).map(mapper).filter(checker)
      : Object.isArray(val) ? val.map(mapper).filter(checker) : []
    : [];
};

const checkBool = (val) => val === true || val === false;
const checkNumPlus = (val) => val > 0;
const checkStr = (val) => val && val.length > 0;
const checkJSON = (val) => Object.isObject(val);
const checkIn = (en, val) => val && val in en;
const checkEnum = (items) => { const en = {}; items.forEach(i => (en[i] = true)); return checkIn.fill(en); };
const checkNumPlusArr = (val) => Object.isArray(val) && (val.length === 0 || (val.length > 0 && val.filter(checkNumPlus).unique().length === val.length));
const checkStrArr = (val) => Object.isArray(val) && (val.length === 0 || (val.length > 0 && val.filter(checkStr).unique().length === val.length));
const checkArrCustom = (checker = checkStr) => (val) => Object.isArray(val) && (val.length === 0 || (val.length > 0 && val.filter(checker).unique().length === val.length));

const strStr = (val) => val;
const strInt = (val) => val.toString();
const strBool = (val) => val.toString();
const strArrStr = (delimiter) => (val) => val.map(strStr).join(delimiter);
const strArrInt = (delimiter) => (val) => val.map(strInt).join(delimiter);
const strJSON = (val) => JSON.stringify(val);
const strArrCustom = (delimiter, stringify = strStr) => (val) => val.map(stringify).join(delimiter);

const defaultConfig = {
  'couchbox.nodename': {
    env: 'NODE_NAME',
    value: 'lc',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'couchbox.nodes': {
    env: 'NODES',
    value: {},
    str: strJSON,
    map: mapJSON,
    check: checkJSON
  },
  'couchbox.max_parallel_changes': {
    env: 'MAX_PARALLEL_CHANGES',
    value: 16,
    str: strInt,
    map: mapInt,
    check: checkNumPlus
  },
  'couchbox.cold_start': {
    env: 'COLD_START',
    value: 'normal',
    str: strStr,
    map: mapStr,
    check: checkEnum(['normal', 'now'])
  },

  'couchbox.mail': {
    env: 'MAIL',
    value: { active: false, from: 'CouchBox', recipients: '' },
    str: strJSON,
    map: mapJSON,
    check: checkJSON
  },

  'debug': {
    env: 'DEBUG',
    value: false,
    str: strBool,
    map: mapBool,
    check: checkBool
  },

  'system.configTimeout': {
    env: 'DB_CONFIG_TIMEOUT',
    value: 10000,
    str: strInt,
    map: mapInt,
    check: checkNumPlus
  },

  'process.timeout': {
    env: 'DB_HOOK_TIMEOUT',
    value: 5000,
    str: strInt,
    map: mapInt,
    check: checkNumPlus
  },

  'logger.console': {
    env: 'LOGGER_CONSOLE',
    value: true,
    str: strBool,
    map: mapBool,
    check: checkBool
  },
  'logger.db': {
    env: 'LOGGER_DB',
    value: 'log',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'logger.dbSave': {
    env: 'LOGGER_DB_SAVE',
    value: false,
    str: strBool,
    map: mapBool,
    check: checkBool
  },
  'logger.bulkSize': {
    env: 'LOGGER_BULK_SIZE',
    value: 100,
    str: strInt,
    map: mapInt,
    check: checkNumPlus
  },

  'couchdb.connection': {
    env: 'DB_CONNECTION',
    value: 'http',
    str: strStr,
    map: mapStr,
    check: checkEnum(['http', 'https'])
  },
  'couchdb.ip': {
    env: 'DB_IP',
    value: 'localhost',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'couchdb.port': {
    env: 'DB_PORT',
    value: 5984,
    str: strInt,
    map: mapInt,
    check: checkNumPlus
  },
  'couchdb.user': {
    env: 'DB_USER',
    value: 'system',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'couchdb.pass': {
    env: 'DB_PASS',
    value: '',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'couchdb.secret': {
    env: 'DB_SECRET',
    value: undefined,
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'couchdb.cookie': {
    env: 'DB_COOKIE',
    value: undefined,
    str: strStr,
    map: mapStr,
    check: checkStr
  },

  'user.session': {
    env: 'USER_SESSION',
    value: 60 * 60, // in seconds (default 1 hour)
    str: strInt,
    map: mapInt,
    check: checkNumPlus
  },

  'redis.ip': {
    env: 'REDIS_IP',
    value: 'localhost',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'redis.port': {
    env: 'REDIS_PORT',
    value: 6379,
    str: strInt,
    map: mapInt,
    check: checkNumPlus
  },
  'redis.user': {
    env: 'REDIS_USER',
    value: '',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'redis.password': {
    env: 'REDIS_PASSWORD',
    value: '',
    str: strStr,
    map: mapStr,
    check: checkStr
  },
  'redis.redis_commander': {
    env: 'REDIS_COMMANDER',
    value: { active:false, port:8881, user:'test', pass:'pass' },
    str: strJSON,
    map: mapJSON,
    check: checkJSON
  },

  'cors.enabled': {
    env: 'CORS',
    value: false,
    str: strBool,
    map: mapBool,
    check: checkBool
  },
  'cors.credentials': {
    env: 'CORS_CREDENTIALS',
    value: false,
    str: strBool,
    map: mapBool,
    check: checkBool
  },
  'cors.headers': {
    env: 'CORS_HEADERS',
    value: [],
    str: strArrStr(','),
    map: mapsStrArr(/,\s*/),
    check: checkStrArr
  },
  'cors.methods': {
    env: 'CORS_METHODS',
    value: [],
    str: strArrStr(', '),
    map: mapsStrArr(/,\s*/),
    check: checkStrArr
  },
  'cors.origins': {
    env: 'CORS_ORIGINS',
    value: [],
    str: strArrStr(', '),
    map: mapsStrArr(/,\s*/),
    check: checkStrArr
  },

  'api': {
    env: 'API',
    value: { active:false, ports:[8001], restart_delta:5000, hostKey:'host' },
    str: strJSON,
    map: mapJSON,
    check: checkJSON
  },

  'proxy': {
    env: 'PROXY',
    value: { active: false, port:8888, path:'/' },
    str: strJSON,
    map: mapJSON,
    check: checkJSON
  },

  'socket': {
    env: 'SOCKET',
    value: { active: false, port:8000, path:'/_socket' },
    str: strJSON,
    map: mapJSON,
    check: checkJSON
  },

  'plugins': {
    env: 'PLUGINS',
    value: {},
    str: strJSON,
    map: mapJSON,
    check: checkJSON
  },
};

const makeConfig = () => {
  const conf = {};
  Object.keys(defaultConfig).forEach(fieldPath => {
    const field = defaultConfig[fieldPath];
    if (!field) return null;
    lib.addField(conf, fieldPath, field.value);
    if (field.env && field.env in env) {
      const value = field.map(env[field.env]);
      if (field.check(value)) lib.addField(conf, fieldPath, value);
    }
  });
  return conf;
}; // parse config from env variables

const config = module.exports = makeConfig();

module.exports.getEnv = (fieldPath) => defaultConfig[fieldPath] ? defaultConfig[fieldPath].env : undefined;

module.exports.toEnv = () => {
  const conf = {};
  Object.keys(defaultConfig).forEach(fieldPath => {
    const field = defaultConfig[fieldPath];
    if (!field || !field.env) return null;
    const val = lib.getField(config, fieldPath);
    conf[field.env] = field.str(val);
  });
  return conf;
}; // serialize config to env variables

module.exports.get = (fieldPath) => lib.getField(config, fieldPath); // return config property fieldPath may be 'prop' or 'parent.prop'

module.exports.parse = (fieldPath, val) => {
  const field = defaultConfig[fieldPath];
  if (!field) return undefined;
  return field.map(val);
};

module.exports.check = (fieldPath, val) => {
  const field = defaultConfig[fieldPath];
  return field && field.check(val);
};

module.exports.set = (fieldPath, val) => {
  const field = defaultConfig[fieldPath];
  if (!field) return null;
  const value = field.map(val);
  if (field.check(value)) {
    lib.addField(config, fieldPath, value);
    return true;
  }
  return false;
}; // set property, need valid val

module.exports.patch = (fieldPath, key, val) => {
  const field = defaultConfig[fieldPath];
  if (!field) return null;
  const value = field.map(val);
  if (field.check(value)) {
    lib.addField(config, [fieldPath, key], value);
    return true;
  }
  return false;
}; // patch property, need valid val

module.exports.clean = (fieldPath) => {
  const field = defaultConfig[fieldPath];
  if (!field) return null;
  lib.addField(config, fieldPath, undefined);
  return true;
}; // set property to undefined

module.exports.Constants = {
  CONFIG_COUCHBOX,
  CONFIG_COUCHBOX_PLUGINS,
  CONFIG_COUCHBOX_API,
  CONFIG_COUCHBOX_HOOKS
};

module.exports.LOG_EVENTS = {
  CONFIG_BUCKET: 'config/bucket',
  CONFIG_HOOKS: 'config/hooks',
  CONFIG_API: 'config/api',
  CONFIG_ENDPOINTS: 'config/endpoints',
  CONFIG_SOCKET: 'config/socket',
  CONFIG_PROXY: 'config/proxy',
  CONFIG_REDIS_COMMANDER: 'config/redis-commander',
};
