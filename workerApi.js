const lib = require('./lib');
const Worker = require('./models/worker');


const { LOG_EVENT_WORKER_START, LOG_EVENT_WORKER_EXIT, LOG_EVENT_SOCKET_ERROR } = require('./constants/logEvents');
const { WORKER_EVENT_EXIT, WORKER_EVENT_UNHANDLED_ERROR } = require('./constants/worker');

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'API worker' });
  const { logger } = worker;
  const log = logger.getLog();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: LOG_EVENT_WORKER_START
  });

  worker.emitter.on(WORKER_EVENT_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError api',
      event: LOG_EVENT_SOCKET_ERROR,
      error
    });
  });

  worker.emitter.on(WORKER_EVENT_EXIT, () => {
    log({
      message: 'On worker exit',
      event: LOG_EVENT_WORKER_EXIT
    });
    return worker.close();
  });
};