const config = require('./config');

const DB_CONNECTION = config.couchdb.connection;
const DB_IP = config.couchdb.ip;
const DB_PORT = config.couchdb.port;
const DB_USER = config.couchdb.user;
const DB_PASS = config.couchdb.pass;

const nano = require('nano')(`${DB_CONNECTION}://${DB_USER}:${DB_PASS}@${DB_IP}:${DB_PORT}`);

module.exports = nano;
