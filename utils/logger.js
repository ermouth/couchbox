require('sugar');
const Promise = require('bluebird');
const lib = require('./lib');
const couchdb = require('./couchdb');
const config = require('../config');


const LOG_CONSOLE = config.get('logger.console');
const LOG_DB = config.get('logger.db');
const NODE_NAME = config.get('couchbox.nodename');
const LOG_DEFAULT_EVENT = 'log/message';
const LOG_DOCUMENT_TYPE = 'flog';
const LOG_CHAIN_DELIMITER = '→';

const DEBUG = config.get('debug.enabled');
const DEBUG_DB = config.get('debug.db');
const DEBUG_LOG_TYPE = 'log_debug';
const DEBUG_DEFAULT_EVENT = 'debug/message';

const PERFORMANCE_EVENT_PEFIX = 'performance';

const BULK_SIZE = config.get('logger.bulkSize');

let save_log = LOG_DB && config.get('logger.dbSave') === true;
let save_debug = DEBUG && DEBUG_DB;

let db_log, db_debug;
let filter_debug = () => false;

function init_logs() {
  if (save_log) init_db_log();
  if (save_debug) init_db_debug();
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

function init_db_debug() {
  if (db_debug) return db_debug;

  // debugs events filter
  filter_debug = function (eventName) {
    if (eventName && eventName.length) {
      const filters = config.get('debug.events');
      if (!filters.length) return false;
      const eventArray = eventName.split('/');
      let filters_i = 0, filters_max = filters.length, filter, filter_i, filter_max;
      while(filters_i < filters_max) {
        filter = filters[filters_i++];
        filter_i = 0;
        filter_max = filter.length;
        while(filter_i < filter_max) {
          if (eventArray[filter_i] && filter[filter_i] === eventArray[filter_i]) {
            if (filter_max === ++filter_i) return true;
            continue;
          }
          break;
        }
      }
    }
    return false;
  };

  // debug db
  db_debug = couchdb.connectBucket(DEBUG_DB);
  db_debug.info((error, info) => {
    if (error) log('No debug db: '+ DEBUG_DB);
    else if (!info) log('No debug db info: '+ DEBUG_DB);
    else return null;
    save_debug = false;
    db_debug = undefined;
  });
  return db_debug;
}

function log(text, chain = ['Logger'], time = new Date()) {
  console.log(time.iso() +' ['+ chain.reverse().join(LOG_CHAIN_DELIMITER) +']: '+ text);
}

function errorMessageMap(msg) {
  let detect = msg.match(/^Invalid require path: Object has no property ".+"\.\s/);
  if (detect && detect.length === 1) msg = detect[0].slice(0,-2);
  return msg;
}

function LoggerBody(prefix) {
  const stack_log = new Array(BULK_SIZE);
  const stack_debug = new Array(BULK_SIZE);
  let index_log = 0;
  let index_debug = 0;

  const save = (events, bucket, type = LOG_DOCUMENT_TYPE) => new Promise((resolve, reject) => {
    const node = config.get('couchbox.nodename') || NODE_NAME;
    const stamp = Date.now();
    const _id = lib.uuid(stamp);
    // console.log({ _id, events, type, node, stamp });
    // return process.nextTick(() => resolve());
    (bucket || db_log || db_debug).insert({ _id, events, type, node, stamp }, (error) => {
      if (error) {
        log(JSON.stringify({ error }), [prefix]);
        return reject(error);
      }
      resolve();
    });
  });

  this.save = (forced = false) => new Promise((resolve, reject) => {
    const callStack = [];
    if (db_log && index_log > 0 && (forced || index_log >= BULK_SIZE)) {
      const log_events = stack_log.slice(0, index_log);
      index_log = 0;
      callStack.push(save(log_events, db_log, LOG_DOCUMENT_TYPE));
    }
    if (db_debug && index_debug > 0 && (forced || index_debug >= BULK_SIZE)) {
      const debug_events = stack_debug.slice(0, index_debug);
      index_debug = 0;
      callStack.push(save(debug_events, db_debug, DEBUG_LOG_TYPE));
    }
    Promise.all(callStack).then(resolve).catch(reject);
  });

  this.log = (data, forced, flag = 'log') => {
    const { time, chain, msg, eventName } = data;

    const row = { };
    let message;
    if (Object.isString(msg)) {
      row.message = message = msg;
    }else if (!Object.isObject(msg) || (!msg.message && !msg.error && !msg.principal && !msg.event && !msg.ref)) {
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
      }
      if (msg.code) row.code = msg.code;
      if (msg.principal) row.principal = msg.principal;
      if (msg.event) row.event = msg.event;
      if (msg.ref) row.ref = msg.ref;
    }
    if (eventName && !row.event) row.event = eventName;

    if (LOG_CONSOLE && flag !== 'debug') log(message, chain, time);

    const saveToLog = flag === 'log' && save_log;
    const saveToDebug = flag === 'debug' && save_debug && filter_debug(row.event);

    if (saveToLog || saveToDebug) {
      row.chain = chain.reverse().join(LOG_CHAIN_DELIMITER);
      if (!row.principal) row.principal = config.get('couchdb.user');
      row.stamp = time.getTime();
      if (saveToDebug) stack_debug[index_debug++] = row;
      if (saveToLog) stack_log[index_log++] = row;
      this.save(forced);
    }
  };

  this.offline = () => {
    index_log = 0;
    index_debug = 0;
    db_log = undefined;
    db_debug = undefined;
  };
  this.online = () => init_logs();
}

function Logger(props = {}) {
  const prefix = props.prefix;
  const default_log_event = props.logEvent || LOG_DEFAULT_EVENT;

  let logger;
  if (props.logger) {
    logger = props.logger;
    this.getChain = () => logger.getChain().concat([ prefix ]);
  } else {
    logger = new LoggerBody(prefix);
    this.getChain = () => [ prefix ];
  }

  this.log = ({ time, chain, msg, eventName = default_log_event}, forced = false, flag = 'log') => {
    if (!time) time = new Date();
    if (!chain) chain = [];
    chain.push(prefix);
    logger.log({ time, chain, msg, eventName }, forced, flag);
  };

  this.getLog = () => (msg, forced) => this.log({ msg }, forced);
  this.online = logger.online;
  this.offline = logger.offline;
  this.save = logger.save;

  if (DEBUG) {
    const default_debug_event = props.debugEvent || DEBUG_DEFAULT_EVENT;
    const default_performance_event = PERFORMANCE_EVENT_PEFIX +'/'+ NODE_NAME;

    this.debug = (msg, forced) => this.log({ msg, eventName: default_debug_event }, forced, 'debug');

    const perfomance = (msg) => this.log({ msg, eventName: default_performance_event }, false, 'debug');

    const performance_start = (stamp = Date.now(), tags = []) => perfomance({
      stamp,
      tags: [PERFORMANCE_EVENT_PEFIX].concat(Object.isArray(tags) ? tags : []),
      action: 'start'
    });

    const performance_end = (stamp = Date.now(), tags = []) => perfomance({
      stamp,
      tags: [PERFORMANCE_EVENT_PEFIX].concat(Object.isArray(tags) ? tags : []),
      action: 'end'
    });

    this.performance = {
      start: performance_start,
      end: performance_end
    }
  }
}

init_logs();

module.exports = Logger;
module.exports.LOG_EVENTS = { LOG_ERROR: 'log/error' };
