require('sugar');
const lib = require('./lib');
const { env } = process;

const mapInt = (val) => +val;
const mapStr = (val) => val;
const mapBool = (val) => val === true || val === 'true';
const checkBool = (val) => val === true || val === false;
const checkNumPlus = (val) => val > 0;
const checkStr = (val) => val && val.length > 0;
const checkIn = (en, val) => val && en.hasOwnProperty(val);
const checkEnum = (items) => { const en = {}; items.forEach(i => (en[i] = true)); return checkIn.fill(en); };

const defaultConfig = {
  'couchbox.nodename': {
    env: 'NODE_NAME',
    value: undefined,
    map: mapStr,
    check: checkStr
  },

  'system.configTimeout': {
    env: 'DB_CONFIG_TIMEOUT',
    value: 10000,
    map: mapInt,
    check: checkNumPlus
  },

  'hooks.timeout': {
    env: 'DB_HOOK_TIMEOUT',
    value: 5000,
    map: mapInt,
    check: checkNumPlus
  },

  'logger.db': {
    env: 'LOGGER_DB',
    value: 'log',
    map: mapStr,
    check: checkStr
  },
  'logger.dbSave': {
    env: 'LOGGER_DB_SAVE',
    value: false,
    map: mapBool,
    check: checkBool
  },
  'logger.bulkSize': {
    env: 'LOGGER_BULK_SIZE',
    value: 100,
    map: mapInt,
    check: checkNumPlus
  },

  'nodes.domain': {
    env: 'NODES_DOMAIN',
    value: 'vezdelegko.ru',
    map: mapStr,
    check: checkStr
  },
  'nodes.domainPrefix': {
    env: 'NODES_DOMAIN_PREFIX',
    value: 'https://couch-',
    map: mapStr,
    check: checkStr
  },

  'couchdb.connection': {
    env: 'DB_CONNECTION',
    value: 'http',
    map: mapStr,
    check: checkEnum(['http', 'https'])
  },
  'couchdb.ip': {
    env: 'DB_IP',
    value: 'localhost',
    map: mapStr,
    check: checkStr
  },
  'couchdb.port': {
    env: 'DB_PORT',
    value: 5984,
    map: mapInt,
    check: checkNumPlus
  },
  'couchdb.user': {
    env: 'DB_USER',
    value: 'system',
    map: mapStr,
    check: checkStr
  },
  'couchdb.pass': {
    env: 'DB_PASS',
    value: 'momomo',
    map: mapStr,
    check: checkStr
  },
  'couchdb.secret': {
    env: 'DB_SECRET',
    value: undefined,
    map: mapStr,
    check: checkStr
  },
  'couchdb.cookie': {
    env: 'DB_COOKIE',
    value: undefined,
    map: mapStr,
    check: checkStr
  },

  'redis.ip': {
    env: 'REDIS_IP',
    value: 'localhost',
    map: mapStr,
    check: checkStr
  },
  'redis.port': {
    env: 'REDIS_PORT',
    value: 6379,
    map: mapInt,
    check: checkNumPlus
  },

  'socket.enabled': {
    env: 'SOCKET',
    value: false,
    map: mapBool,
    check: checkBool
  },
  'socket.port': {
    env: 'SOCKET_PORT',
    value: 8000,
    map: mapInt,
    check: checkNumPlus
  },
  'socket.path': {
    env: 'SOCKET_PATH',
    value: '/_socket',
    map: mapStr,
    check: checkStr
  },
};

const makeConfig = () => {
  const conf = {};
  Object.keys(defaultConfig).forEach(fieldPath => {
    const field = defaultConfig[fieldPath];
    if (!field) return null;
    lib.addField(conf, fieldPath, field.value);
    if (field.env && env.hasOwnProperty(field.env)) {
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
    conf[field.env] = lib.getField(config, fieldPath);
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

module.exports.clean = (fieldPath) => {
  const field = defaultConfig[fieldPath];
  if (!field) return null;
  lib.addField(config, fieldPath, undefined);
  return true;
}; // set property to undefined
