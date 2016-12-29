const couchdb = {
  connection: 'http',
  ip: 'localhost',
  port: 5984,
  user: 'test',
  pass: 'testtest',

  hooks: {
    'test1/ddoc_test1': 'fetch',
    // 'test2/ddoc_test2': 'fetch'
  }
};

module.exports = {
  couchdb
};
