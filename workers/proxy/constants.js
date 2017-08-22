const config = require('../../config');

module.exports = {
  NODE_NAME: config.get('couchbox.nodename'),
  PROXY_PORT: config.get('proxy.port'),
  PROXY_PATH: config.get('proxy.path'),
  PROXY_DEFAULT: config.get('proxy.default'),

  API_ENABLED: config.get('api.active'),
  API_PORTS: config.get('api.ports'),

  SOCKET_ENABLED: config.get('socket.active'),
  SOCKET_PORT: config.get('socket.port'),
  SOCKET_PATH: config.get('socket.path'),

  LOG_EVENTS: {
    PROXY_START: 'proxy/start',
    PROXY_STOP: 'proxy/stop',
    PROXY_ERROR: 'proxy/error',
  }
};
