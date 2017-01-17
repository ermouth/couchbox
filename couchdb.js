const config = require('./config');
const Promise = require('bluebird');

const DB_CONNECTION = config.couchdb.connection;
const DB_IP = config.couchdb.ip;
const DB_PORT = config.couchdb.port;
const DB_USER = config.couchdb.user;
const DB_PASS = config.couchdb.pass;

const nano = require('nano');
const fetch = require('node-fetch');

const DB_URL = DB_CONNECTION +'://'+ DB_IP +':'+ DB_PORT;
const DB_CONNECTION_URL = DB_CONNECTION +'://'+ DB_USER +':'+ DB_PASS +'@'+ DB_IP +':'+ DB_PORT;

const auth = () => new Promise((resolve, reject) => {
  nano(DB_URL).auth(DB_USER, DB_PASS, function (err, body, headers) {
    if (err) return reject(err);
    let cookie;
    if (headers && headers['set-cookie'] && headers['set-cookie'][0]) {
      cookie = headers['set-cookie'][0].split(';')[0];
    }
    if (cookie) resolve(cookie);
    else reject('Bad auth');
  });
});

const loadConfig = () => {
  return auth().then((cookie) => new Promise((resolve, reject) => {
    const requestOptions = {
      method: 'GET',
      headers: { cookie }
    };
    return fetch(DB_URL +'/_config', requestOptions).then(res => {
      return res.json();
    }).then(json => {
      if (!json || json.error) {
        return reject(json);
      } else {
        return resolve(json);
      }
    })
  }));
};

let connection;

const connect = () => {
  if (!connection) connection = nano(DB_CONNECTION_URL);
  return connection;
};

const connectDB = (db) => {
  return connect().use(db);
};

module.exports = {
  auth,
  loadConfig,
  connect,
  connectDB
};
