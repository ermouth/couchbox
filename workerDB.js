const config = require('./config');
const lib = require('./lib');
const Logger = require('./utils/log');

const DB = require('./models/db');

module.exports = function initWorkerDB(cluster, props = {}) {
  const pid = process.pid;
  const state = {};

  const logPrefix = 'Worker '+ pid;
  const logger = new Logger({
    prefix: logPrefix
  });
  const log = logger.getLog();

  log('started with '+ Object.keys(props).map(key => (key +'='+ props[key])).join(' '));

  // detect exit
  process.on('uncaughtException', _onGlobalError);
  process.on('SIGINT', closeWorker);
  process.on('exit', () => { log('close'); });

  function _onGlobalError(error) {
    log({ error });
  }

  // messages listener
  process.on('message', (message) => {
    const { msg, data } = message;
    switch (msg) {
      case 'close':
        closeWorker();
        break;
      default:
        break;
    }
  });

  // send message to master
  function sendMessage(msg, data) {
    process.send({ msg, data });
  }

  // send state on process
  function onProcess() {
    log('process');
    sendMessage('process', state);
  }

  // close worker
  function closeWorker() {
    console.log('closeWorker');
    db.close();
  }
  function onClose() {
    sendMessage('close', state);
    process.exit();
  }

  // start closing worker
  function onClosing() {
    log('start closing');
    sendMessage('closing', state);
  }


  // Init worker functions

  const dbName = props.db;
  const since = props.since || 'now';
  const ddocs = props.ddocs || {};

  if (!Object.keys(ddocs).length) {
    close();
    return null;
  }

  function db_process(seq) {
    state.seq = seq;
    onProcess();
  }

  function db_closing(seq) {
    state.seq = seq;
    onClosing();
  }

  function db_close(seq) {
    state.seq = seq;
    onClose();
  }


  const db = new DB(dbName, ddocs, {
    logger,
    onProcess: db_process,
    onClosing: db_closing,
    onClose: db_close
  });
  db.init(since);
};
