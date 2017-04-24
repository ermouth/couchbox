const lib = require('../../utils/lib');
const Worker = require('../../utils/worker');
const Socket = require('./socket');
const configValidator = require('./configValidator');
const config = require('../../config');

const { WORKER_HANDLE_EXIT, WORKER_HANDLE_UNHANDLED_ERROR } = Worker.Constants;
const { WORKER_START, WORKER_EXIT, WORKER_CLOSE, WORKER_ERROR } = Worker.LOG_EVENTS;

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'Socket' });
  const { logger } = worker;
  const log = logger.getLog();

  if (!configValidator(config.get('socket'))) {
    const error = new Error('Not valid socket config');
    log({
      message: 'Error: '+ error.message,
      event: WORKER_ERROR,
      error,
      type: 'fatal'
    });
    return worker.close();
  }

  const socket = new Socket(Object.assign(props.params || {}, {
    logger,
    onInit: (data) => {
      worker.send('init', data);
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

  worker.emitter.on(WORKER_HANDLE_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError socket',
      event: WORKER_ERROR,
      error
    });
  });

  worker.emitter.on(WORKER_HANDLE_EXIT, (forced) => {
    if (socket.isRunning()) return socket.close(forced);
    log({
      message: 'On worker exit, forced: '+ (forced === true ? 'true' : 'false'),
      event: WORKER_EXIT
    });
    return worker.close();
  });

  socket.init();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: WORKER_START
  });

};