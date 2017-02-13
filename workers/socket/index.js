const lib = require('../../utils/lib');
const Worker = require('../../utils/worker');
const Socket = require('./socket');

const { LOG_EVENT_WORKER_START, LOG_EVENT_WORKER_EXIT, LOG_EVENT_WORKER_CLOSE, LOG_EVENT_SOCKET_ERROR } = require('../../constants/logEvents');
const { WORKER_EVENT_EXIT, WORKER_EVENT_UNHANDLED_ERROR } = Worker.Constants;


module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'Socket worker' });
  const { logger } = worker;
  const log = logger.getLog();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: LOG_EVENT_WORKER_START
  });

  const socket = new Socket(Object.assign(props.params || {}, {
    logger,
    onInit: (data) => {
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
  }));

  worker.emitter.on(WORKER_EVENT_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError socket',
      event: LOG_EVENT_SOCKET_ERROR,
      error
    });
  });

  worker.emitter.on(WORKER_EVENT_EXIT, (forced) => {
    if (socket.isRunning()) return socket.close(forced);
    log({
      message: 'On worker exit, forced: '+ (forced === true ? 'true' : 'false'),
      event: LOG_EVENT_WORKER_EXIT
    });
    return worker.close();
  });

  socket.init();
};