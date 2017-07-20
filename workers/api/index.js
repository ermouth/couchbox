const lib = require('../../utils/lib');
const Worker = require('../../utils/worker');
const API = require('./api');
const configValidator = require('./configValidator');
const config = require('../../config');


const { WORKER_HANDLE_EXIT, WORKER_HANDLE_UNHANDLED_ERROR, WORKER_ACTION_LOGS_SAVE } = Worker.Constants;
const { WORKER_START, WORKER_EXIT, WORKER_CLOSE, WORKER_ERROR } = Worker.LOG_EVENTS;

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'API' });
  const { logger } = worker;
  const log = logger.getLog();

  if (!configValidator(config.get('api'))) {
    const error = new Error('Not valid api config');
    log({
      message: 'Error: '+ error.message,
      error,
      event: WORKER_ERROR
    });
    return worker.close();
  }

  const api = new API(Object.assign(props.params || {}, {
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
    },

    onSaveLogs: () => worker.send(WORKER_ACTION_LOGS_SAVE)

  }));

  worker.emitter.on(WORKER_HANDLE_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError api',
      event: WORKER_ERROR,
      error
    });
  });

  worker.emitter.on(WORKER_HANDLE_EXIT, (forced) => {
    if (api.isRunning()) return api.close(forced);
    log({
      message: 'On worker exit, forced: '+ (forced === true ? 'true' : 'false'),
      event: WORKER_EXIT
    });
    return worker.close();
  });

  api.init();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: WORKER_START
  });
};