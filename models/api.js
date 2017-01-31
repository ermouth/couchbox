const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');
const couchdb = require('../couchdb');
const config = require('../config');
const express = require('express');

const NODE_NAME = config.get('couchbox.nodename');
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

  let server;
  const app = express();

  app.use(function(req, res) {
    res.json({
      nodename: NODE_NAME,
      path: req.path
    });
  });

  const init = () => {
    _running = true;
    server = app.listen(API_PORT, function () {
      log({
        message: 'Start api listen requests on port: '+ API_PORT,
        event: LOG_EVENT_API_START
      });
      _onInit();
    });
  };

  const close = () => {
    _closing = true;
    log({
      message: 'Stop api on port: '+ API_PORT,
      event: LOG_EVENT_API_STOP
    });
    server.close();
    _running = false;
    _onClose();
  };

  return {
    init, close,
    isRunning
  };
}

module.exports = API;