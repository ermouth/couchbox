require('sugar');
const crypto = require('crypto');
const Promise = require('bluebird');
const nano = require('nano');
const fetch = require('node-fetch');
const config = require('./config');


const DB_CONNECTION = config.get('couchdb.connection');
const DB_IP = config.get('couchdb.ip');
const DB_PORT = config.get('couchdb.port');
const DB_USER = config.get('couchdb.user');
const DB_PASS = config.get('couchdb.pass');

const DB_ADDRESS = DB_IP +':'+ DB_PORT;
const DB_URL = DB_CONNECTION +'://'+ DB_ADDRESS;
const DB_CONNECTION_URL = DB_CONNECTION +'://'+ DB_USER +':'+ DB_PASS +'@'+ DB_ADDRESS;


let auth_attempts = 5;
let connection;

const connect = () => connection ? connection : (connection = nano(DB_CONNECTION_URL));
const connectDB = (db) => connect().use(db);

const auth = () => new Promise((resolve, reject) => {
  const oldCookie = config.get('couchdb.cookie');
  if (oldCookie) return resolve(oldCookie);
  if (!auth_attempts) return reject(new Error('End last auth attempt'));
  nano(DB_URL).auth(DB_USER, DB_PASS, function (error, body, headers) {
    if (error) return reject(error);
    let cookie;
    if (headers && headers['set-cookie'] && headers['set-cookie'][0]) {
      cookie = headers['set-cookie'][0].split(';')[0];
      if (cookie !== oldCookie) {
        config.set('couchdb.cookie', cookie);
        return resolve(cookie);
      }
    }
    reject(new Error('Bad auth'));
  });
});

const getConfig = (cookie) => new Promise((resolve, reject) => {
  if (!cookie) cookie = config.get('couchdb.cookie');
  return fetch(DB_URL +'/_config', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        cookie
      }
    })
    .then(res => res.json())
    .then(json => {
      if (!json || json.error) {
        if (json && json.error === 'unauthorized') {
          config.reset('couchdb.cookie');
          return loadConfig();
        }
        return reject(new Error('Bad config'));
      }
      return json;
    })
    .then(resolve)
});

const loadConfig = () => config.get('couchdb.cookie') ? getConfig() : auth().then(getConfig);

const makeAuthHeaders = (userCtx) => {
  const headers = {};
  if (userCtx && Object.isArray(userCtx.roles)) {
    headers['X-Auth-CouchDB-Roles'] = userCtx.roles.join(',');
  }
  if (userCtx && Object.isString(userCtx.name)) {
    headers['X-Auth-CouchDB-UserName'] = userCtx.name;
    headers['X-Auth-CouchDB-Token'] = crypto.createHmac('sha1', config.get('couchdb.secret')).update(userCtx.name).digest('hex');
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
