require('sugar');
const exec = require('child_process').exec;
const Promise = require('bluebird');
const { uuid, cleanJSON } = require('./lib');
const couchdb = require('./couchdb');
const config = require('../config');


const LOG_CONSOLE = config.get('logger.console');
const LOG_DB = config.get('logger.db');
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
  db_log.info(function(error, info){
    if (error) log('No log db: '+ LOG_DB);
    else if (!info) log('No log db info: '+ LOG_DB);
    else return null;
    db_log = undefined;
    save_log = false;
  });
  return db_log;
}

function execBash(cmd, env = {}) {
  return new Promise(function(resolve, reject){
    if (!(Object.isString(cmd) && cmd.length)) return reject(new Error('Bad command'));
    exec(cmd, { env }, function(error, stdout, stderr){
      if (error) return reject(error);
      if (stderr) return reject(new Error(stderr));
      resolve(stdout);
    });
  });
}

function sendMail (recipients = config.get('couchbox.mail.recipients'), mailMessage, subject, from = config.get('couchbox.mail.from')) {
  if(!Object.isString(mailMessage)) mailMessage = cleanJSON(mailMessage, ' ');
  if (mailMessage.length === 0) return Promise.reject(new Error('Empty message'));
  mailMessage = [
    'To:'+ recipients,
    'From:'+ from,
    'Subject:'+ subject,
    'Mime-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Disposition: inline',
    '',
    mailMessage
  ].join('\n');
  return execBash('printf "${mailMessage}" | sendmail "$recipients"', {
    mailMessage,
    recipients
  }).catch(function (error) {
    console.error(mailMessage);
    console.error(error);
  })
}

function fatal_action(errorMessage) {
  if (config.get('couchbox.mail.active')) {
    const subj = 'Node '+ config.get('couchbox.nodename') +' - Fatal Alert';
    if (errorMessage.hasOwnProperty('error')) {
      try {
        const error = JSON.parse(errorMessage.error);
        if (error && error.message && error.stack) {
          const stack = error.stack;
          if (Object.keys(error).length > 2) {
            delete error.stack;
            errorMessage.error = error;
          } else {
            errorMessage.error = error.message;
          }
          errorMessage = cleanJSON(errorMessage, ' ') + '\n\nError stack:\n' + stack;
        }
      } catch (e) {
        console.error(e);
      }
    }
    sendMail(config.get('couchbox.mail.recipients'), errorMessage, subj)
      .catch(function(sendError){
        console.error(sendError)
      });
  }
}

function cover(t) {
  return t ? '['+ t +']' : '';
}
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

// function errorMessageMap(msg) {
//   let detect = msg.match(/^Invalid require path: Object has no property ".+"\.\s/);
//   if (detect && detect.length === 1) msg = detect[0].slice(0,-2);
//   return msg;
// }

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

function LoggerBody(prefix, emitSaveAction) {
  const that = this;
  const stack_log = new Array(BULK_SIZE);
  let index_log = 0;

  if (!emitSaveAction) emitSaveAction = function () {};

  function save(events, bucket, type = LOG_DOCUMENT_TYPE) {
    return new Promise(function(resolve, reject){
      const node = config.get('couchbox.nodename');
      const stamp = Date.now();
      const _id = uuid(stamp);

      (bucket || db_log).insert({ _id, events, type, node, stamp }, function(error){
        if (error) {
          log(JSON.stringify({ error }), [prefix]);
          return reject(error);
        }
        resolve();
      });
    });
  }

  that.save = function(forced = false){
    return new Promise(function(resolve, reject){
        if (forced === 'all') emitSaveAction();
      if (db_log && index_log > 0 && (forced || index_log >= BULK_SIZE)) {
        const log_events = stack_log.slice(0, index_log);
        index_log = 0;
        save(log_events, db_log, LOG_DOCUMENT_TYPE).then(resolve).catch(reject);
      } else {
        resolve();
      }
    });
  };

  that.log = function(data, forced){
    const { time, chain, msg, scope, eventName, eventType } = data;

    let message = '';
    let isError = false;
    const row = {
      type: eventType || TYPE_INFO,
      event: eventName
    };
    if (scope) row.scope = scope;

    // String
    if (Object.isString(msg)) {
      message = row.message = msg;
    }
    // Object
    else if (Object.isObject(msg)) {
      // Parse message for console
      if (msg.message) {
        if (msg.message instanceof Error || msg.message.stack) {
          message = row.message = msg.message.toString();
          row.messageStack = msg.message.stack;
          isError = true;
        } else {
          row.message = msg.message;
          if (Object.isString(msg.message)) message = msg.message;
          else message = JSON.stringify(msg.message);
        }
      }

      // Parse error
      if (msg.error) {
        if (msg.error instanceof Error || msg.error.stack) {
          row.error = msg.error.toString();
          row.errorStack = msg.error.stack;
        }
        else if (Object.isString(msg.error)) row.error = msg.error;
        else row.error = JSON.stringify(msg.error);
        // if (row.error) message += '\n ('+ row.error +')';
        isError = true;
      }

      if (msg.event) row.event = msg.event;
      if (msg.type) {
        if (!checkType(msg.type)) msg.type = TYPE_WARN;
        row.type = msg.type;
      }
      if (msg.principal) row.principal = msg.principal;
      if (msg.ref) row.ref = msg.ref;
      if (msg.code) row.code = msg.code;
      if (msg.url) row.url = msg.url;
      if (msg.data) row.data = msg.data;
    }
    // Error
    else if (msg instanceof Error || (msg.toString && msg.stack)) {
      row.type = TYPE_ERROR;
      message = row.message = msg.toString();
      if (msg.stack) row.error = msg.stack;
      if (msg.code) row.code = msg.code;
      if (msg.event) row.event = msg.event;
      if (msg.type) {
        if (!checkType(msg.type)) msg.type = TYPE_WARN;
        row.type = msg.type;
      }
    }
    else {
      row.type = TYPE_WARN;
      message = row.message = JSON.stringify(msg);
    }
    if (!row.message) row.message = message;
    if (isError && (row.type !== TYPE_ERROR && row.type !== TYPE_FATAL && row.type !== TYPE_WARN && row.type !== TYPE_DEBUG)) {
      row.type = TYPE_ERROR;
    }

    if (LOG_CONSOLE) log(message, chain, row.type, row.scope, row.event, time);

    if (row.type === TYPE_FATAL || save_log) {
      row.chain = chain.reverse().join(LOG_CHAIN_DELIMITER);
      if (!row.principal) row.principal = config.get('couchdb.user');
      row.stamp = time.getTime();
      if (row.type === TYPE_FATAL) try{fatal_action(row);}catch(e0){}
      if (save_log) {
        stack_log[index_log++] = row;
        that.save(forced || (row.type === TYPE_FATAL));
      }
    }
  };

  that.offline = function(){
    index_log = 0;
    db_log = undefined;
  };
  that.online = function() {
    return init_logs();
  };
}

function Logger(props = {}, emitSaveAction) {
  const that = this;
  const prefix = props.prefix;
  const scope = props.scope || '';
  const default_log_event = props.logEvent || LOG_DEFAULT_EVENT;


  let logger;
  if (props.logger) {
    logger = props.logger;
    that.getChain = function getChain() {
      return logger.getChain().concat([ prefix ]);
    };
  } else {
    logger = new LoggerBody(prefix, emitSaveAction);
    that.getChain = function getChainBase() {
      return [ prefix ];
    };
  }


  that.log = function({ time, chain, msg, scope, eventName = default_log_event, eventType = TYPE_INFO }, forced = false){
    if (!time) time = new Date();
    if (!chain) chain = [];
    chain.push(prefix);
    logger.log({ time, chain, msg, scope, eventName, eventType }, forced);
  };

  that.getLog = function getLog(){
    return function(msg, forced) {
      that.log({ msg, scope }, forced);
    };
  };

  that.getDebug = function getDebug() {
    return function (msg, forced) {
      that.log({ msg, eventName: DEBUG_DEFAULT_EVENT, eventType: TYPE_DEBUG }, forced);
    };
  };

  that.online = logger.online;
  that.offline = logger.offline;
  that.save = logger.save;
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
