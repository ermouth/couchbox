const config = require('../../config');

module.exports = {
  NODE_NAME: config.get('couchbox.nodename'),
  SOCKET_PORT: config.get('socket.port'),
  SOCKET_PATH: config.get('socket.path'),
  SOCKET_NODE_DELIMITER: ':',
  SOCKET_EVENT_PREFIX: 'socket.emit.',

  LOG_EVENTS: {
    SOCKET_START: 'socket/start',
    SOCKET_STOP: 'socket/stop',
    SOCKET_ERROR: 'socket/error',
  }
};
