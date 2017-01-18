const { env } = process;

const system = {
  hookTimeout: env['DB_HOOK_TIMEOUT'] || 5000,
  configTimeout: env['DB_CONFIG_TIMEOUT'] || 1000
};

const nodes = {
  domain: env['NODES_DOMAIN'] || 'vezdelegko.ru',
  domainPrefix: env['NODES_DOMAIN_PREFIX'] || 'https://couch-',
};

const logger = {
  db: env['LOGGER_DB'] || 'log',
  dbSave: env['LOGGER_DB_SAVE'] === true || env['LOGGER_DB_SAVE'] === 'true' || false,
  bulkSize: env['LOGGER_BULK_SIZE'] || 100
};

const couchdb = {
  connection: env['DB_CONNECTION'] || 'http',
  ip: env['DB_IP'] || 'localhost',
  port: env['DB_PORT'] || 5984,
  user: env['DB_USER'] || 'system',
  pass: env['DB_PASS'] || 'momomo'
};

module.exports = { system, logger, couchdb, nodes };
