require('sugar');
const lib = require('./lib');
const { env } = process;

const defaultConfig = {
  'couchbox.nodename': {
    env: 'NODE_NAME',
    value: undefined,
    map: val => val.toString(),
    check: val => val > 0
  },

  'system.configTimeout': {
    env: 'DB_CONFIG_TIMEOUT',
    value: 10000,
    map: val => +val,
    check: val => val > 0
  },

  'hooks.timeout': {
    env: 'DB_HOOK_TIMEOUT',
      value: 5000,
      map: val => +val,
      check: val => val > 0
  },

  'logger.db': {
    env: 'LOGGER_DB',
    value: 'log',
    map: val => val,
    check: val => val && val.length > 0
  },
  'logger.dbSave': {
    env: 'LOGGER_DB_SAVE',
    value: false,
    map: val => val === true || val === 'true',
    check: val => val === true || val === false
  },
  'logger.bulkSize': {
    env: 'LOGGER_BULK_SIZE',
    value: 100,
    map: val => +val,
    check: val => val > 0
  },

  'nodes.domain': {
    env: 'NODES_DOMAIN',
    value: 'vezdelegko.ru',
    map: val => val,
    check: val => val && val.length > 0
  },
  'nodes.domainPrefix': {
    env: 'NODES_DOMAIN_PREFIX',
    value: 'https://couch-',
    map: val => val,
    check: val => val && val.length > 0
  },

  'couchdb.connection': {
    env: 'DB_CONNECTION',
    value: 'http',
    map: val => val,
    check: val => val === 'http' || val === 'https'
  },
  'couchdb.ip': {
    env: 'DB_IP',
    value: 'localhost',
    map: val => val,
    check: val => val && val.length > 0
  },
  'couchdb.port': {
    env: 'DB_PORT',
    value: 5984,
    map: val => +val,
    check: val => val > 0
  },
  'couchdb.user': {
    env: 'DB_USER',
    value: 'system',
    map: val => val,
    check: val => val && val.length > 0
  },
  'couchdb.pass': {
    env: 'DB_PASS',
    value: 'momomo',
    map: val => val,
    check: val => val && val.length > 0
  },
  'couchdb.secret': {
    env: 'DB_SECRET',
    value: undefined,
    map: val => val,
    check: val => val && val.length > 0
  },
  'couchdb.cookie': {
    env: 'DB_COOKIE',
    value: undefined,
    map: val => val,
    check: val => val && val.length > 0
  },

  'redis.ip': {
    env: 'REDIS_IP',
    value: 'localhost',
    map: val => val,
    check: val => val && val.length > 0
  },
  'redis.port': {
    env: 'REDIS_PORT',
    value: 6379,
    map: val => +val,
    check: val => val > 0
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

module.exports.set = (fieldPath, val) => {
  const field = defaultConfig[fieldPath];
  if (!field) return null;
  const value = field.map(val);
  if (value) {
    lib.addField(config, fieldPath, value);
    return true;
  }
  return false;
}; // set property, need valid val

module.exports.reset = (fieldPath) => {
  const field = defaultConfig[fieldPath];
  if (!field) return null;
  lib.addField(config, fieldPath, undefined);
  return true;
}; // set property to undefined