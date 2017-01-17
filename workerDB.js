const config = require('./config');
const lib = require('./lib');

const Worker = require('./models/worker');
const DB = require('./models/db');

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, {});
  const { logger, ee } = worker;
  const log = logger.getLog();

  log('Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '));

  if (!(props.db && props.ddocs && Object.keys(props.ddocs).length)) {
    log('Bad params - close worker');
    worker.close();
    return null;
  }

  const { conf, seq, ddocs } = props;
  const db = new DB(props.db, {
    logger, conf, seq, ddocs,

    onOldWorker: (oldWorkerSeq) => {
      log('Detect old worker: '+ oldWorkerSeq);
      worker.sendToMaster('oldWorker', oldWorkerSeq);
    },
    onStopFeed: () => {
      log('Stop feed');
      worker.sendToMaster('stopFeed');
    },
    onInit: (workerSeq) => {
      log('Init worker:'+ workerSeq);
      worker.sendToMaster('init', workerSeq);
    },
    onClose: (workerSeq) => {
      log('Start closing');
      worker.sendToMaster('close', workerSeq);
      worker.close();
    }
  });

  ee.on('exit', () => {
    log('Close worker');
    if (db && db.isRunning()) db.close();
    else worker.close();
  });
};