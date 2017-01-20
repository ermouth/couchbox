const lib = require('./lib');
const Worker = require('./models/worker');
const DB = require('./models/db');

module.exports = function initWorker(cluster, props = {}) {

  let db;
  const worker = new Worker(cluster, {
    onExit: () => {
      log('On worker exit');
      if (db && db.isRunning()) db.close();
      else worker.close();
    }
  });
  const { logger } = worker;
  const log = logger.getLog();

  log('Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '));

  if (!(props.db && props.ddocs && Object.keys(props.ddocs).length)) {
    log('Bad params - close worker');
    worker.close();
    return null;
  }

  const { seq, ddocs } = props;
  db = new DB(props.db, {
    logger, seq, ddocs,

    onOldWorker: (data) => {
      log('Detect old worker: '+ data.seq);
      worker.sendToMaster('oldWorker', data);
    },

    onStartFeed: () => {
      log('On start feed');
      worker.sendToMaster('startFeed');
    },
    onStopFeed: () => {
      log('On stop feed');
      worker.sendToMaster('stopFeed');
    },

    onInit: (data) => {
      log('Init worker:' + data.seq);
      worker.sendToMaster('init', data);
    },

    onClose: (data) => {
      log('Start closing');
      worker.sendToMaster('close', data);
      worker.close();
    }
  });
};
