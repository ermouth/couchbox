const lib = require('./lib');
const Worker = require('./models/worker');
const DB = require('./models/db');

const {
  LOG_EVENT_WORKER_START, LOG_EVENT_WORKER_EXIT, LOG_EVENT_WORKER_CLOSE, LOG_EVENT_WORKER_ERROR,
  LOG_EVENT_BUCKET_ERROR
} = require('./constants/logEvents');

const { WORKER_EVENT_EXIT, WORKER_EVENT_UNHANDLED_ERROR } = require('./constants/worker');

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'Bucket worker' });
  const { logger } = worker;
  const log = logger.getLog();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: LOG_EVENT_WORKER_START
  });

  if (!(props.db && props.ddocs && Object.keys(props.ddocs).length)) {
    log({
      error: new Error('Bad params'),
      event: LOG_EVENT_WORKER_ERROR
    });
    return worker.close();
  }

  const bucket = new DB({
    name: props.db,
    seq: props.seq,
    ddocs: props.ddocs,
    logger,

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
        event: LOG_EVENT_WORKER_CLOSE
      });
      worker.sendToMaster('close', data);
      worker.close();
    }
  });

  worker.emitter.on(WORKER_EVENT_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError db '+ props.db,
      event: LOG_EVENT_BUCKET_ERROR,
      error
    });
  });

  worker.emitter.on(WORKER_EVENT_EXIT, () => {
    if (bucket.isRunning()) return bucket.close();
    log({
      message: 'On worker exit',
      event: LOG_EVENT_WORKER_EXIT
    });
    return worker.close();
  });

  bucket.init();
};
