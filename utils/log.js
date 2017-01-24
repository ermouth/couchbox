require('sugar');
const Promise = require('bluebird');
const couchdb = require('../couchdb');
const config = require('../config');


const DB_NAME = config.get('logger.db');
const DB_SAVE = config.get('logger.dbSave') === true;
const BULK_SIZE = config.get('logger.bulkSize');


function log(text, chain, time) {
  if (!time) time = new Date();
  if (!chain) chain = ['Logger'];
  console.log(time.iso() +' ['+ chain.reverse().join('→') +']: '+ text);
}

let db;
let connectedDB = false;
if (DB_SAVE) {
  db = couchdb.connectDB(DB_NAME);
  db.info((error, info) => {
    if (error) log('No db: '+ DB_NAME);
    else if (!info) log('No db info: '+ DB_NAME);
    else connectedDB = true;
  });
}

function Logger(props = {}) {
  const _parent = props.logger;
  const _prefix = props.prefix;

  const logs = new Array(BULK_SIZE);
  let log_index = 0;

  let db_saving = DB_SAVE;

  const save = (events) => new Promise((resolve, reject) => {
    const node = config.get('couchbox.nodename') || 'couchbox';
    const type = 'flog';
    const stamp = Date.now();
    db.insert({ events, type, node, stamp }, (error) => {
      if (error) {
        log(JSON.stringify({ error }), [_prefix]);
        return reject(error);
      }
      resolve();
    });
  });

  const saveToDB = () => new Promise((resolve, reject) => {
    if (!connectedDB) {
      const error = 'No log database connection';
      log(error, [_prefix]);
      return reject(new Error(error));
    }
    if (log_index === 0) return resolve();
    const events = logs.slice(0, log_index);
    log_index = 0;
    save(events).then(resolve).catch(reject);
  });

  const endLog = _parent ? _parent.log : function(data) {
    const { time, chain, msg } = data;

    let message, event = { chain: chain.reverse().join('→') };
    if (Object.isString(msg)) {
      event.message = message = msg;
    }else if (!Object.isObject(msg) || (!msg.message && !msg.error && !msg.principal && !msg.event && !msg.ref)) {
      event.message = message = JSON.stringify(msg);
    } else {
      message = '';
      if (msg.message) {
        event.message = Object.isString(msg.message) ? msg.message : JSON.stringify(msg.message);
        message += event.message;
      }
      if (msg.error) {
        event.error = JSON.stringify(msg.error);
        if (msg.error.message) message += (message.length ? ' ' : '') +'"'+ msg.error.message +'"';
        else message += (message.length ? ' ' : '') + event.error;
      }
      if (msg.code) event.code = msg.code;
      if (msg.principal) event.principal = msg.principal;
      if (msg.event) event.event = msg.event;
      if (msg.ref) event.ref = msg.ref;
    }

    log(message, chain, time);
    if (db_saving) {
      if (!event.principal) event.principal = config.get('couchdb.user');
      event.stamp = time.getTime();
      logs[log_index++] = event;
      if (log_index >= BULK_SIZE) saveToDB();
    }
  };

  const preLog = ({ time, chain, msg }) => {
    if (!time) time = new Date();
    if (!chain) chain = [];
    chain.push(_prefix);
    endLog({ time, chain, msg });
  };

  const saveForced = () => db_saving ? saveToDB() : Promise.resolve();

  const goOffline = () => {
    logs.length = 0;
    db_saving = false;
  };

  return {
    log: preLog,
    goOffline: _parent ? _parent.goOffline : goOffline,
    saveForced: _parent ? _parent.saveForced : saveForced,
    getLog: () => (msg) => preLog({ msg })
  };
}

module.exports = Logger;
