require('sugar');
const util = require('util');
const EventEmitter = require('events');
const lib = require('./lib');
const Logger = require('./logger');


// Constants
const WORKER_HANDLE_EXIT = 'WORKER_HANDLE_EXIT';
const WORKER_HANDLE_MESSAGE = 'WORKER_HANDLE_MESSAGE';
const WORKER_HANDLE_ERROR = 'WORKER_HANDLE_ERROR';
const WORKER_HANDLE_UNHANDLED_ERROR = 'WORKER_HANDLE_UNHANDLED_ERROR';

const WORKER_TYPE_BUCKET = 'WORKER_TYPE_BUCKET';
const WORKER_TYPE_SOCKET = 'WORKER_TYPE_SOCKET';
const WORKER_TYPE_API = 'WORKER_TYPE_API';
const WORKER_WAIT_TIMEOUT = 500;

// Log events
const { LOG_ERROR } = Logger.LOG_EVENTS;
const WORKER_START = 'worker/start';
const WORKER_CLOSE = 'worker/close';
const WORKER_CLOSED = 'worker/closed';
const WORKER_EXIT = 'worker/exit';
const WORKER_ERROR = 'worker/error';


function Worker(cluster, props = {}) {
  EventEmitter.call(this);
  const emitter = this;

  const pid = process.pid;
  const name = props.name || 'Worker';
  const logger = new Logger({ prefix: name +' '+ pid });
  const log = logger.getLog();

  const send = (msg, data) => process.send({ msg, data });

  // listen messages
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
    emitter.emit(WORKER_HANDLE_MESSAGE, message);
  });

  // detect exit
  process.on('unhandledRejection', _onUnhandledError);
  process.on('uncaughtException', _onError);
  process.on('SIGINT', () => _onClose(true));
  process.on('SIGTERM', () => _onClose(true));
  process.on('exit', () => {
    log({
      message: 'Closed',
      event: WORKER_CLOSED
    });
  });

  function _onUnhandledError(error) {
    if (emitter.listenerCount(WORKER_HANDLE_UNHANDLED_ERROR) > 0) emitter.emit(WORKER_HANDLE_UNHANDLED_ERROR, error);
    else {
      log({
        message: name +' unhandled error',
        event: WORKER_ERROR,
        error
      });
    }
  }

  function _onError(error) {
    if (emitter.listenerCount(WORKER_ERROR) > 0) emitter.emit(WORKER_ERROR, error);
    else {
      log({
        message: name +' error',
        event: WORKER_ERROR,
        error
      });
    }
  }

  function _onClose(forced) {
    if (emitter.listenerCount(WORKER_HANDLE_EXIT) > 0) emitter.emit(WORKER_HANDLE_EXIT, forced);
    else close();
  }

  function close() {
    logger.saveForced()
      .catch(error => log({ message:'Error save log', event: LOG_ERROR, error }))
      .finally(() => {
        logger.goOffline();
        process.exit();
      });
  }

  this.pid = pid;
  this.logger = logger;
  this.send = send;
  this.emitter = emitter;
  this.close = close;
}

util.inherits(Worker, EventEmitter);

module.exports = Worker;
module.exports.Constants = {
  WORKER_HANDLE_EXIT,
  WORKER_HANDLE_MESSAGE,
  WORKER_HANDLE_ERROR,
  WORKER_HANDLE_UNHANDLED_ERROR,

  WORKER_TYPE_BUCKET,
  WORKER_TYPE_SOCKET,
  WORKER_TYPE_API,
  WORKER_WAIT_TIMEOUT
};
module.exports.LOG_EVENTS = {
  WORKER_START,
  WORKER_CLOSE,
  WORKER_CLOSED,
  WORKER_EXIT,
  WORKER_ERROR,
};
