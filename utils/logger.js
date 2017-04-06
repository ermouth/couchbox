require('sugar');
const Promise = require('bluebird');
const lib = require('./lib');
const couchdb = require('./couchdb');
const config = require('../config');


const LOG_CONSOLE = config.get('logger.console');
const LOG_DB = config.get('logger.db');
const NODE_NAME = config.get('couchbox.nodename');
const LOG_DEFAULT_EVENT = 'log/message';
const DEBUG_DEFAULT_EVENT = 'debug/message';
const LOG_DOCUMENT_TYPE = 'flog';
const LOG_CHAIN_DELIMITER = '→';

const TYPE_INFO = 'info';
const TYPE_ERROR = 'error';
const TYPE_FATAL = 'fatal';
const TYPE_DEBUG = 'debug';
const TYPE_WARN = 'warn';
const TYPE_TRACE = 'trace';

const BULK_SIZE = config.get('logger.bulkSize');

let save_log = LOG_DB && config.get('logger.dbSave') === true;
let db_log;

function init_logs() {
  if (save_log) init_db_log();
}

function init_db_log() {
  if (db_log) return db_log;
  db_log = couchdb.connectBucket(LOG_DB);
  db_log.info((error, info) => {
    if (error) log('No log db: '+ LOG_DB);
    else if (!info) log('No log db info: '+ LOG_DB);
    else return null;
    db_log = undefined;
    save_log = false;
  });
  return db_log;
}

function fatal_action(message) {
  // TODO: send email or something else
}

const errorsSet = new Set();
errorsSet.add(TYPE_ERROR);
errorsSet.add(TYPE_FATAL);

const cover = t => t ? '['+ t +']' : '';
function log(text, chain = ['Logger'], type = TYPE_WARN, scope = '', event, time = new Date()) {
  const message = (
    time.iso() +
    cover(process.pid) +
    cover(type) +
    cover(chain.reverse().join(LOG_CHAIN_DELIMITER)) +
    cover(event) +
    cover(scope) +
    ' ' +
    text
  );
  switch (type) {
    case TYPE_FATAL:
    case TYPE_ERROR:
      return console.error(message);
    case TYPE_WARN:
      return console.warn(message);
    case TYPE_TRACE:
      return console.trace(message);
    case TYPE_INFO:
      return console.info(message);
    default:
      console.log(message);
  }
}

function errorMessageMap(msg) {
  let detect = msg.match(/^Invalid require path: Object has no property ".+"\.\s/);
  if (detect && detect.length === 1) msg = detect[0].slice(0,-2);
  return msg;
}

function checkType(type) {
  switch (type) {
    case TYPE_INFO:
    case TYPE_DEBUG:
    case TYPE_ERROR:
    case TYPE_FATAL:
    case TYPE_TRACE:
    case TYPE_WARN:
      return true;
    default:
      return false;
  }
}

function LoggerBody(prefix) {
  const stack_log = new Array(BULK_SIZE);
  let index_log = 0;

  const save = (events, bucket, type = LOG_DOCUMENT_TYPE) => new Promise((resolve, reject) => {
    const node = config.get('couchbox.nodename') || NODE_NAME;
    const stamp = Date.now();
    const _id = lib.uuid(stamp);

    (bucket || db_log).insert({ _id, events, type, node, stamp }, (error) => {
      if (error) {
        log(JSON.stringify({ error }), [prefix]);
        return reject(error);
      }
      resolve();
    });
  });

  this.save = (forced = false) => new Promise((resolve, reject) => {
    if (db_log && index_log > 0 && (forced || index_log >= BULK_SIZE)) {
      const log_events = stack_log.slice(0, index_log);
      index_log = 0;
      save(log_events, db_log, LOG_DOCUMENT_TYPE).then(resolve).catch(reject);
    } else {
      resolve();
    }
  });

  this.log = (data, forced) => {
    const { time, chain, msg, scope, eventName, eventType } = data;

    const row = { };
    let message;
    if (Object.isString(msg)) {
      row.message = message = msg;
    } else if (!Object.isObject(msg) || (!msg.message && !msg.error && !msg.principal && !msg.event && !msg.ref)) {
      row.message = message = JSON.stringify(msg);
    } else {
      message = '';
      if (msg.message) {
        row.message = Object.isString(msg.message) ? msg.message : JSON.stringify(msg.message);
        message += row.message;
      }
      if (msg.error) {
        row.error = JSON.stringify(msg.error);
        if (msg.error.message) message += (message.length ? ' ' : '') +'"'+ errorMessageMap(msg.error.message) +'"';
        else message += (message.length ? ' ' : '') + row.error;
        if ((!msg.type || !checkType(msg.type)) && eventType !== TYPE_DEBUG) msg.type = TYPE_ERROR;
      }
      if (msg.code) row.code = msg.code;
      if (msg.principal) row.principal = msg.principal;
      if (msg.event) row.event = msg.event;
      if (msg.ref) row.ref = msg.ref;
      if (msg.type) {
        if (!checkType(msg.type)) msg.type = TYPE_WARN;
      }
      else msg.type = eventType || TYPE_INFO;
      if (msg.ref) row.ref = msg.ref;
    }
    if (eventName && !row.event) row.event = eventName;
    if (scope && !row.scope) row.scope = scope;
    if (msg.type || eventType) row.type = msg.type || eventType;

    if (LOG_CONSOLE) log(message, chain, row.type, row.scope, row.event, time);

    if (row.type === TYPE_FATAL || save_log) {
      row.chain = chain.reverse().join(LOG_CHAIN_DELIMITER);
      if (!row.principal) row.principal = config.get('couchdb.user');
      row.stamp = time.getTime();
      if (row.type === TYPE_FATAL) {
        fatal_action(row);
      }
      if (save_log) {
        stack_log[index_log++] = row;
        this.save(forced);
      }
    }
  };

  this.offline = () => {
    index_log = 0;
    db_log = undefined;
  };
  this.online = () => init_logs();
}

function Logger(props = {}) {
  const prefix = props.prefix;
  const scope = props.scope || '';
  const default_log_event = props.logEvent || LOG_DEFAULT_EVENT;

  let logger;
  if (props.logger) {
    logger = props.logger;
    this.getChain = () => logger.getChain().concat([ prefix ]);
  } else {
    logger = new LoggerBody(prefix);
    this.getChain = () => [ prefix ];
  }


  this.log = ({ time, chain, msg, scope, eventName = default_log_event, eventType }, forced = false) => {
    if (!time) time = new Date();
    if (!chain) chain = [];
    chain.push(prefix);
    logger.log({ time, chain, msg, scope, eventName, eventType }, forced);
  };

  this.getLog = () => (msg, forced) => this.log({ msg, scope }, forced);
  this.getDebug = () => (msg, forced) => this.log({ msg, eventName: DEBUG_DEFAULT_EVENT, eventType: TYPE_DEBUG }, forced);
  this.online = logger.online;
  this.offline = logger.offline;
  this.save = logger.save;
}

init_logs();

module.exports = Logger;
module.exports.LOG_TYPES = {
  TYPE_INFO,
  TYPE_ERROR,
  TYPE_FATAL,
  TYPE_DEBUG,
  TYPE_WARN,
  TYPE_TRACE
};
module.exports.LOG_EVENTS = {
  LOG_ERROR: 'log/error'
};
