const lib = require('../../utils/lib');
const Worker = require('../../utils/worker');
const Bucket = require('./bucket');


const { WORKER_HANDLE_EXIT, WORKER_HANDLE_ERROR, WORKER_HANDLE_UNHANDLED_ERROR } = Worker.Constants;
const { WORKER_START, WORKER_EXIT, WORKER_CLOSE, WORKER_ERROR } = Worker.LOG_EVENTS;

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'Bucket worker' });
  const { logger } = worker;
  const log = logger.getLog();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: WORKER_START
  });

  const bucket = new Bucket(Object.assign(props.params || {}, {
    logger,
    onInit: (data) => {
      worker.send('init', data);
    },
    onStartFeed: () => {
      worker.send('startFeed');
    },
    onStopFeed: () => {
      worker.send('stopFeed');
    },
    onOldWorker: (data) => {
      worker.send('oldWorker', data);
    },
    onClose: (data) => {
      log({
        message: 'Close',
        event: WORKER_CLOSE
      });
      worker.send('close', data);
      worker.close();
    }
  }));

  worker.on(WORKER_HANDLE_ERROR, (error) => {
    log({
      message: 'Error bucket '+ props.params.name,
      event: WORKER_ERROR,
      error
    });
  });

  worker.on(WORKER_HANDLE_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError bucket '+ props.params.name,
      event: WORKER_ERROR,
      error
    });
    console.error(error);
  });

  worker.on(WORKER_HANDLE_EXIT, (forced) => {
    if (bucket.isRunning()) return bucket.close(forced);
    log({
      message: 'On worker exit, forced: '+ (forced === true ? 'true' : 'false'),
      event: WORKER_EXIT
    });
    return worker.close();
  });

  bucket.init();
};
