const http = require('http');
const socketio = require('socket.io');
const Logger = require('../../utils/logger');
const redisClient = require('../../utils/redis');
const lib = require('../../utils/lib');
const config = require('../../config');


const {
  NODE_NAME,
  SOCKET_EVENT_PREFIX,
  SOCKET_PORT, SOCKET_PATH,
  LOG_EVENTS: {
    SOCKET_START, SOCKET_STOP
  }
} = require('./constants');

function Socket(props = {}) {
  const logger = new Logger({ prefix: 'Socket', logger: props.logger });
  const log = logger.getLog();

  // Max sockets param
  if (config.get('socket.maxSockets') && config.get('socket.maxSockets') > 0) {
    http.globalAgent.maxSockets = config.get('socket.maxSockets')|0;
  } else if (config.get('api.maxSockets') && config.get('api.maxSockets') > 0) {
    http.globalAgent.maxSockets = config.get('api.maxSockets')|0;
  } else {
    http.globalAgent.maxSockets = Infinity;
  }

  const server = http.Server();
  const io = socketio(server, { path: SOCKET_PATH });

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
        message: 'Start listen sockets on port: '+ SOCKET_PORT +' with path: '+ SOCKET_PATH,
        event: SOCKET_START
      });
      redisClient.subscribe(SOCKET_EVENT_PREFIX + NODE_NAME);
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

    socket.on('disconnect', () => {
      if (clients.has(id)) {
        clients.delete(id);
        clientCount--;
      }
    });
  });

  const destroyConnection = (socket, force) => {
    if (force || _closing) {
      socket.destroy();
      clients.delete(socket.id);
      clientCount--;
    }
  };

  const close = (forced) => {
    _closing = true;
    io.close(() => {
      _running = false;
      log({
        message: 'Stop listen sockets on port: '+ SOCKET_PORT + ', forced: ' + (forced === true ? 'true' : 'false'),
        event: SOCKET_STOP
      });
      _onClose();
    });
    if (clientCount) Array.from(clients.values()).forEach(destroyConnection);
  };

  const isRunning = () => _running === true || _closing === true;

  return {
    init, close,
    isRunning
  };
}

module.exports = Socket;