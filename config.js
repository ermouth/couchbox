const { env } = process;

const system = {
  hookTimeout: env['DB_HOOK_TIMEOUT'] || 5000,
  configTimeout: env['DB_CONFIG_TIMEOUT'] ||1000
};

const couchdb = {
  connection: env['DB_CONNECTION'] || 'http',
  ip: env['DB_IP'] || 'localhost',
  port: env['DB_PORT'] || 5984,
  user: env['DB_USER'] || 'system',
  pass: env['DB_PASS'] || 'momomo'
};

module.exports = {
  system,
  couchdb
};
