const EventEmitter = require('events');
const lib = require('../lib');
const Logger = require('../utils/log');
require('sugar');

function Worker(cluster, props = {}) {
  const pid = process.pid;
  const logger = new Logger({
    prefix: 'Worker '+ pid
  });
  const log = logger.getLog();

  const ee = new EventEmitter();

  function sendToMaster(msg, data) {
    process.send({ msg, data });
  }

  process.on('message', (message) => {
    const { msg } = message;
    switch (msg) {
      case 'close':
        _onClose();
        break;
      default:
        break;
    }
    ee.emit('message', message);
  });

  // detect exit
  process.on('uncaughtException', _onWorkerError);
  process.on('SIGINT', _onSIGINT);
  process.on('exit', () => { log('Closed'); });

  function _onWorkerError(error) {
    log({ message:'Worker error', error });
    ee.emit('error', error);
  }
  function _onSIGINT() {
    log('SIGINT');
    ee.emit('exit');
  }
  function _onClose() {
    log('Close');
    ee.emit('exit');
  }

  function onClose() {
    ee.removeAllListeners();
    const onLog = (error) => {
      logger.goOffline();
      if (error) log({ message:'Error save log', error });
      process.exit();
    };
    logger.saveForced()
      .catch(onLog)
      .then(onLog);
  }

  return {
    pid,
    logger,
    sendToMaster,
    ee,
    close: onClose
  }
}

module.exports = Worker;