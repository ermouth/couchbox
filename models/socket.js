const http = require('http');
const socketio = require('socket.io');
const Logger = require('../utils/log');
const redisClient = require('../redis');
const lib = require('../lib');
const config = require('../config');

const NODE_NAME = config.get('couchbox.nodename');
const SOCKET_PORT = config.get('socket.port');
const { LOG_EVENT_SOCKET_START, LOG_EVENT_SOCKET_STOP } = require('../constants/logEvents');

function Socket(props = {}) {
  const logger = new Logger({ prefix: 'Socket', logger: props.logger });
  const log = logger.getLog();

  const server = http.Server();
  const io = socketio(server);

  const _onInit = props.onInit || function(){}; // Call on init all ddocs
  const _onClose = props.onClose || function(){}; // Call on closing

  let _running = false;
  let _closing = false;

  const clients = new Map();
  let clientCount = 0;

  const init = () => {
    server.listen(SOCKET_PORT, () => {
      _running = true;
      log({
        message: 'Start listen sockets on port: '+ SOCKET_PORT,
        event: LOG_EVENT_SOCKET_START
      });

      redisClient.subscribe(NODE_NAME +'.socket.emit');

      _onInit();
    });
  };

  redisClient.on('message', function(ch, json) {
    let msg = lib.parseJSON(json) || {};
    if (Object.isObject(msg) && msg.channel) {
      io.emit(msg.channel, msg.message);
    }
  });

  io.on('connection', (socket) => {
    const { id } = socket;
    clients.set(id, socket);
    clientCount++;

    socket.on('disconnect', onSocketDisconnect.fill(socket));
  });

  const onSocketDisconnect = (socket) => {
    const { id } = socket;
    if (clients.has(id)) {
      clients.delete(id);
      clientCount--;
    }
    if (_closing) {
      if (clientCount === 0) close();
    }
  };

  const close = () => {
    if (_closing) {
      if (!clientCount) _onClose();
    } else {
      _closing = true;
      log({
        message: 'Stop listen sockets on port: '+ SOCKET_PORT,
        event: LOG_EVENT_SOCKET_STOP
      });
      io.close();
    }
  };

  const isRunning = () => _running === true || _closing === true;

  return {
    init, close,
    isRunning
  };
}

module.exports = Socket;