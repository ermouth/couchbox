const system = {
  hookTimeout: 5000,
  cofigUpdateTimeout: 1000
};

const couchdb = {
  connection: 'http',
  ip: 'localhost',
  port: 5984,
  user: 'system',
  pass: 'momomo'
};

module.exports = {
  system,
  couchdb
};
