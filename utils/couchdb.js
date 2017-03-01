require('sugar');
const crypto = require('crypto');
const Promise = require('bluebird');
const nano = require('nano');
const fetch = require('node-fetch');
const config = require('../config');


const DB_CONNECTION = config.get('couchdb.connection');
const DB_IP = config.get('couchdb.ip');
const DB_PORT = config.get('couchdb.port');
const DB_USER = config.get('couchdb.user');
const DB_PASS = config.get('couchdb.pass');
const DB_SECRET = config.get('couchdb.secret');

const CONNECTION_DELIMETER = '://';
const DB_ADDRESS = DB_IP +':'+ DB_PORT;
const DB_URL = DB_CONNECTION + CONNECTION_DELIMETER + DB_ADDRESS;
const DB_CONNECTION_URL = DB_CONNECTION + CONNECTION_DELIMETER + DB_USER +':'+ DB_PASS +'@'+ DB_ADDRESS;

const NODE_NAME = config.get('couchbox.nodename');
const NODES = config.get('couchbox.nodes') || {};

console.log('NODE_NAME', NODE_NAME);
console.log('NODES', NODES);

let auth_attempts = 5;
const connections = new Map();

// return db connection
const connect = (nodeName = NODE_NAME) => {
  if (nodeName && Object.isString(nodeName) && nodeName in NODES) {
    if (connections.has(nodeName)) {
      return connections.get(nodeName);
    } else {
      if (nodeName === NODE_NAME) {
        connections.set(nodeName, nano(DB_CONNECTION_URL));
      } else {
        const node = NODES[nodeName].split(CONNECTION_DELIMETER);
        const connectionString = node[0] + CONNECTION_DELIMETER + DB_USER +':'+ DB_PASS +'@'+ node[1];
        connections.set(nodeName, nano(connectionString));
      }
      return connections.get(nodeName);
    }
  }
};
const connectBucket = (db) => connect().use(db); // return db-bucket connection

const connectNodeBucket = (nodeName = NODE_NAME, db) => {
  if (nodeName && Object.isString(nodeName) && nodeName in NODES && db && Object.isString(db)) {
    const connection = connect(nodeName);
    if (connection) return connection.use(db);
  }
};

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
}); // authenticate in db by credentials in config and update auth cookie in config

const getConfig = (cookie) => new Promise((resolve, reject) => {
  if (!cookie) cookie = config.get('couchdb.cookie');
  return fetch(DB_URL +'/_config', {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      cookie
    }
  }).then(res => res.json()).then(json => {
    if (!json || json.error) {
      if (json && json.error === 'unauthorized') {
        config.clean('couchdb.cookie');
        return loadConfig();
      }
      return reject(new Error('Bad config'));
    }
    return json;
  })
  .then(resolve)
}); // load couchdb _config, auth by cookie in param or in config

const getBasicSession = (Authorization) => new Promise(resolve => {
  fetch(DB_URL +'/_session', {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      Authorization
    }
  }).then(res => res.json()).then(json => json && json.ok ? json.userCtx : undefined).then(resolve)
    .catch(error => { resolve(undefined) });
});
const getCookieSession = (cookie) => new Promise(resolve => {
  return fetch(DB_URL +'/_session', {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      cookie
    }
  }).then(res => res.json()).then(json => json && json.ok ? json.userCtx : undefined).then(resolve)
    .catch(error => { resolve(undefined) });
});

const loadConfig = () => config.get('couchdb.cookie') ? getConfig() : auth().then(getConfig); // start load coundb _config, if no auth cookie - previously authenticate in couchdb

const makeAuthHeaders = (userCtx) => {
  const headers = {};
  if (userCtx && Object.isArray(userCtx.roles)) {
    headers['X-Auth-CouchDB-Roles'] = userCtx.roles.join(',');
  }
  if (userCtx && Object.isString(userCtx.name)) {
    headers['X-Auth-CouchDB-UserName'] = userCtx.name;
    headers['X-Auth-CouchDB-Token'] = crypto.createHmac('sha1', DB_SECRET).update(userCtx.name).digest('hex');
  }
  return headers;
}; // return HTTP header for virtual auth by userCtx

module.exports = {
  auth,
  loadConfig,
  connect,
  connectBucket,
  connectNodeBucket,
  makeAuthHeaders,
  getBasicSession, getCookieSession,
  Constants: {
    DB_URL
  }
};
