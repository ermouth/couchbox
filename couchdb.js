const config = require('./config');
const Promise = require('bluebird');

const DB_CONNECTION = config.couchdb.connection;
const DB_IP = config.couchdb.ip;
const DB_PORT = config.couchdb.port;
const DB_USER = config.couchdb.user;
const DB_PASS = config.couchdb.pass;

const nano = require('nano');
const fetch = require('node-fetch');

let cookie;
const url = `${DB_CONNECTION}://${DB_IP}:${DB_PORT}`;

const auth = module.exports.auth = () => new Promise((resolve, reject) => {
  if (cookie) return resolve(cookie);
  const couchdb = nano(url);
  couchdb.auth(DB_USER, DB_PASS, function (err, body, headers) {
    if (err) return reject(err);
    if (headers && headers['set-cookie'] && headers['set-cookie'][0]) {
      cookie = headers['set-cookie'][0].split(';')[0];
    }
    if (cookie) resolve(cookie);
    else reject('Bad auth');
  });
});

const loadConfig = module.exports.loadConfig = () => {
  return auth().then(() => new Promise((resolve, reject) => {
    if (!cookie) return reject('No auth');
    const requestOptions = {
      method: 'GET',
      headers: { cookie }
    };
    return fetch(url +'/_config', requestOptions).then(res => {
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

module.exports.connect = (db) => {
  return nano(`${DB_CONNECTION}://${DB_USER}:${DB_PASS}@${DB_IP}:${DB_PORT}`).use(db);
};
