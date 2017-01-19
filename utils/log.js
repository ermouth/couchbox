const config = require('../config');

require('sugar');
const Promise = require('bluebird');
const couchdb = require('../couchdb');

const DB_NAME = config.get('logger.db');
const DB_SAVE = config.get('logger.dbSave') === true;
const BULK_SIZE = config.get('logger.bulkSize');

const db = couchdb.connectDB(DB_NAME);
let connectedDB = false;

function log(text, chain, time) {
  if (!time) time = new Date();
  if (!chain) chain = ['Logger'];
  console.log(time.iso() +' ['+ chain.reverse().join('->') +']: '+ text);
}

db.info((error, info) => {
  if (error) {
    log('No db: '+ DB_NAME);
  } else if (!info) {
    log('No db info: '+ DB_NAME);
  } else {
    connectedDB = true;
  }
});

function Logger(props = {}) {
  const _parent = props.logger;
  const _prefix = props.prefix;

  let db_saving = DB_SAVE;

  const logs = [];
  logs.length = BULK_SIZE;
  let log_index = 0;

  const save = (toSave) => new Promise((resolve, reject) => {
    db.bulk({ docs: toSave }, (error) => {
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
    const toSave = logs.slice(0, log_index);
    log_index = 0;
    save(toSave).then(resolve).catch(reject);
  });

  const endLog = _parent ? _parent.log : function(data) {
    const { time, chain, msg } = data;
    if (db_saving) logs[log_index++] = data;
    log(JSON.stringify(msg), chain, time);
    if (db_saving && log_index >= BULK_SIZE) saveToDB();
  };

  const preLog = ({ time, chain, msg }) => {
    if (!time) time = new Date();
    if (!chain) chain = [];
    chain.push(_prefix);
    endLog({ time, chain, msg });
  };

  const saveForced = () => {
    return db_saving ? saveToDB() : Promise.resolve();
  };

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
