const config = require('./config');

require('sugar');
const crypto = require('crypto');
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


let secret;
let connection;

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
        if (json && json.couch_httpd_auth && json.couch_httpd_auth.secret) {
          secret = json.couch_httpd_auth.secret;
        }
        return resolve(json);
      }
    })
  }));
};

const connect = () => {
  if (!connection) connection = nano(DB_CONNECTION_URL);
  return connection;
};

const connectDB = (db) => {
  return connect().use(db);
};

const makeAuthHeaders = (userCtx) => {
  const headers = {};
  if (userCtx && Object.isArray(userCtx.roles)) {
    headers['X-Auth-CouchDB-Roles'] = userCtx.roles.join(',');
  }
  if (userCtx && Object.isString(userCtx.name)) {
    headers['X-Auth-CouchDB-UserName'] = userCtx.name;
    headers['X-Auth-CouchDB-Token'] = crypto.createHash('sha1').update(secret + userCtx.name).digest('hex');
  }
  return headers;
};

module.exports = {
  auth,
  loadConfig,
  connect,
  connectDB,
  makeAuthHeaders
};
