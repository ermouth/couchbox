require('sugar');
const EventEmitter = require('events');
const lib = require('../lib');
const Logger = require('../utils/log');

const { LOG_EVENT_LOG_ERROR, LOG_EVENT_WORKER_CLOSED, LOG_EVENT_WORKER_ERROR } = require('../constants/logEvents');
const { WORKER_EVENT_EXIT, WORKER_EVENT_MESSAGE, WORKER_EVENT_ERROR, WORKER_EVENT_UNHANDLED_ERROR } = require('../constants/worker');

function Worker(cluster, props = {}) {
  const pid = process.pid;
  const name = props.name || 'Worker';
  const logger = new Logger({ prefix: name +' '+ pid });
  const log = logger.getLog();

  const emitter = new EventEmitter();
  const sendToMaster = (msg, data) => process.send({ msg, data });

  process.on('message', (message) => {
    const { msg } = message;
    switch (msg) {
      case 'close':
        _onClose();
        break;
      default:
        break;
    }
    emitter.emit(WORKER_EVENT_MESSAGE, message);
  });

  // detect exit
  process.on('unhandledRejection', _onUnhandledError);
  process.on('uncaughtException', _onError);
  process.on('SIGINT', _onSIGINT);
  process.on('exit', () => {
    log({
      message: 'Closed',
      event: LOG_EVENT_WORKER_CLOSED
    });
  });

  function _onUnhandledError(error) {
    emitter.emit(WORKER_EVENT_UNHANDLED_ERROR, error);
  }
  function _onError(error) {
    log({
      message: name +' error',
      event: LOG_EVENT_WORKER_ERROR,
      error
    });
    emitter.emit(WORKER_EVENT_ERROR, error);
  }
  function _onSIGINT() {
    // log('SIGINT');
    _onClose();
  }

  function _onClose() {
    if (emitter.listenerCount(WORKER_EVENT_EXIT) > 0) emitter.emit(WORKER_EVENT_EXIT);
    else close();
  }

  function close() {
    logger.saveForced()
      .catch(error => log({ message:'Error save log', event: LOG_EVENT_LOG_ERROR, error }))
      .finally(() => {
        logger.goOffline();
        process.exit();
      });
  }

  return {
    pid, logger, emitter,
    sendToMaster,
    close
  }
}

module.exports = Worker;
