require('sugar');
const EventEmitter = require('events');
const lib = require('./lib');
const Logger = require('./logger');

const { LOG_EVENT_LOG_ERROR, LOG_EVENT_WORKER_CLOSED, LOG_EVENT_WORKER_ERROR } = require('../constants/logEvents');

const WORKER_EVENT_EXIT = 'WORKER_EVENT_EXIT';
const WORKER_EVENT_MESSAGE = 'WORKER_EVENT_MESSAGE';
const WORKER_EVENT_ERROR = 'WORKER_EVENT_ERROR';
const WORKER_EVENT_UNHANDLED_ERROR = 'WORKER_EVENT_UNHANDLED_ERROR';

const WORKER_TYPE_BUCKET = 'WORKER_TYPE_BUCKET';
const WORKER_TYPE_SOCKET = 'WORKER_TYPE_SOCKET';
const WORKER_TYPE_API = 'WORKER_TYPE_API';
const WORKER_WAIT_TIMEOUT = 500;

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
      case 'exit':
        _onClose(true);
        break;
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
  process.on('SIGTERM', _onSIGTERM);
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
    _onClose(true);
  }
  function _onSIGTERM() {
    _onClose(true);
  }

  function _onClose(forced) {
    if (emitter.listenerCount(WORKER_EVENT_EXIT) > 0) emitter.emit(WORKER_EVENT_EXIT, forced);
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
module.exports.Constants = {
  WORKER_EVENT_EXIT,
  WORKER_EVENT_MESSAGE,
  WORKER_EVENT_ERROR,
  WORKER_EVENT_UNHANDLED_ERROR,

  WORKER_TYPE_BUCKET,
  WORKER_TYPE_SOCKET,
  WORKER_TYPE_API,
  WORKER_WAIT_TIMEOUT
};
