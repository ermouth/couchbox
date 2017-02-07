const lib = require('../utils/lib');
const Worker = require('../utils/worker');
const Bucket = require('./bucket');

const {
  LOG_EVENT_WORKER_START, LOG_EVENT_WORKER_EXIT, LOG_EVENT_WORKER_CLOSE,
  LOG_EVENT_BUCKET_ERROR
} = require('../constants/logEvents');

const { WORKER_EVENT_EXIT, WORKER_EVENT_UNHANDLED_ERROR } = require('../constants/worker');


module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'Bucket worker' });
  const { logger } = worker;
  const log = logger.getLog();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: LOG_EVENT_WORKER_START
  });


  const bucket = new Bucket(Object.assign(props.params || {}, {
    logger,
    onInit: (data) => {
      worker.sendToMaster('init', data);
    },
    onStartFeed: () => {
      worker.sendToMaster('startFeed');
    },
    onStopFeed: () => {
      worker.sendToMaster('stopFeed');
    },
    onOldWorker: (data) => {
      worker.sendToMaster('oldWorker', data);
    },
    onClose: (data) => {
      log({
        message: 'Close',
        event: LOG_EVENT_WORKER_CLOSE
      });
      worker.sendToMaster('close', data);
      worker.close();
    }
  }));

  worker.emitter.on(WORKER_EVENT_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError db '+ props.params.name,
      event: LOG_EVENT_BUCKET_ERROR,
      error
    });
  });

  worker.emitter.on(WORKER_EVENT_EXIT, (forced) => {
    if (bucket.isRunning()) return bucket.close(forced);
    log({
      message: 'On worker exit, forced: '+ (forced === true ? 'true' : 'false'),
      event: LOG_EVENT_WORKER_EXIT
    });
    return worker.close();
  });

  bucket.init();
};
