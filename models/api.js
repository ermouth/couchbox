const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');
const couchdb = require('../couchdb');
const config = require('../config');


const { LOG_EVENT_API_START, LOG_EVENT_API_STOP } = require('../constants/logEvents');

function API(props = {}) {
  const logger = new Logger({ prefix: 'API', logger: props.logger });
  const log = logger.getLog();

  const _onInit = props.onInit || function(){};
  const _onClose = props.onClose || function(){};

  let _running = false;
  let _closing = false;

  const isRunning = () => _running === true || _closing === true;

  //

  const API_PORT = props.port;


  const init = () => {
    _running = true;
    log({
      message: 'Start api listen requests on port: '+ API_PORT,
      event: LOG_EVENT_API_START
    });
    _onInit();
  };

  const close = () => {
    _closing = true;
    log({
      message: 'Stop api on port: '+ API_PORT,
      event: LOG_EVENT_API_STOP
    });
    _onClose();
  };


  return {
    init, close,
    isRunning
  };
}

module.exports = API;