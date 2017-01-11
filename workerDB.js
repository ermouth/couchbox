const config = require('./config');
const lib = require('./lib');
const Logger = require('./utils/log');

const Worker = require('./models/worker');
const DB = require('./models/db');

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, {});
  const { logger, ee } = worker;
  const log = logger.getLog();

  log('Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '));

  let db;
  ee.on('exit', () => {
    log('Close worker');
    if (db && db.isStarted()) db.close();
    else worker.close();
  });

  const { conf } = props;
  const state = {};
  const dbName = props.db;
  const since = props.since || 'now';
  const ddocs = props.ddocs || {};

  if (!Object.keys(ddocs).length) {
    log('No ddocs - close worker');
    worker.close();
    return null;
  }

  function db_process(seq) {
    log('Process');
    state.seq = seq;
    worker.sendToMaster('process', state);
  }

  function db_end(seq) {
    log('Start closing');
    state.seq = seq;
    worker.sendToMaster('end', state);
  }

  function db_stopFollow(seq) {
    log('Stop follow');
    state.seq = seq;
    worker.sendToMaster('stopFollow', state);
  }

  function db_close(seq) {
    state.seq = seq;
    worker.sendToMaster('close', state);
    worker.close();
  }

  db = new DB(dbName, ddocs, {
    logger, conf,
    onProcess: db_process,
    onEnd: db_end,
    onStopFollow: db_stopFollow,
    onClose: db_close
  });
  db.init(since);
};