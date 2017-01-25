const lib = require('./lib');
const Worker = require('./models/worker');
const DB = require('./models/db');

module.exports = function initWorker(cluster, props = {}) {

  const dbName = props.db;
  let db;
  const worker = new Worker(cluster, {
    onUnhandledError: (error) => {
      log({
        message: 'UnhandledError db '+ dbName,
        event: 'db/error',
        error
      });
    },
    onExit: () => {
      log({
        message: 'On worker exit',
        event: 'worker/exit'
      });
      if (db) {
        if (db.isRunning()) return db.close();
      }
      return worker.close();
    }
  });
  const { logger } = worker;
  const log = logger.getLog();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: 'worker/start'
  });

  if (!(props.db && props.ddocs && Object.keys(props.ddocs).length)) {
    log({
      error: new Error('Bad params'),
      event: 'worker/error'
    });
    worker.close();
    return null;
  }

  const { seq, ddocs } = props;
  db = new DB(dbName, {
    logger, seq, ddocs,

    onOldWorker: (data) => {
      // log('Detect old worker: '+ data.seq);
      worker.sendToMaster('oldWorker', data);
    },

    onStartFeed: () => {
      // log('On start feed');
      worker.sendToMaster('startFeed');
    },
    onStopFeed: () => {
      // log('On stop feed');
      worker.sendToMaster('stopFeed');
    },

    onInit: (data) => {
      // log('Init worker:' + data.seq);
      worker.sendToMaster('init', data);
    },

    onClose: (data) => {
      log({
        message: 'Close',
        event: 'worker/close'
      });
      worker.sendToMaster('close', data);
      worker.close();
    }
  });
};
