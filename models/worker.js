require('sugar');
const lib = require('../lib');
const Logger = require('../utils/log');


function Worker(cluster, props = {}) {
  const pid = process.pid;
  const name = props.name || 'Worker';
  const logger = new Logger({
    prefix: name +' '+ pid
  });
  const log = logger.getLog();

  const onMessage = props.onMessage || function(){};
  const onError = props.onError || function(){};
  const onExit = props.onExit;

  let isClosing = false;

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
    onMessage(message);
  });

  // detect exit
  process.on('uncaughtException', _onError);
  process.on('SIGINT', _onSIGINT);
  process.on('exit', () => { log('Closed'); });

  function _onError(error) {
    // log({ message: name +' error', error });
    onError(error);
  }
  function _onSIGINT() {
    // log('SIGINT');
    _onClose();
  }

  function _onClose() {
    if (onExit) onExit();
    else startClose();
  }

  function startClose() {
    // log('Close');
    isClosing = true;
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
    close: startClose,
    isClosing: () => isClosing === true
  }
}

module.exports = Worker;