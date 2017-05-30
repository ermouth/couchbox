const http = require('http');
const httpProxy = require('http-proxy');
const Logger = require('../../utils/logger');
const lib = require('../../utils/lib');


const {
  PROXY_PORT, PROXY_PATH,

  API_ENABLED, API_PORTS,
  SOCKET_ENABLED, SOCKET_PORT, SOCKET_PATH,

  LOG_EVENTS: {
    PROXY_START, PROXY_STOP
  }
} = require('./constants');

function ProxyWorker(props = {}) {
  const logger = new Logger({ prefix: 'Proxy', logger: props.logger });
  const log = logger.getLog();

  const _onInit = props.onInit || function(){}; // Call on init all ddocs
  const _onClose = props.onClose || function(){}; // Call on closing

  let _running = false;
  let _closing = false;

  let lastApiWorker = 0;
  const maxApiWorker = API_PORTS.length;

  const getApiWorker = () => ({
    host: 'localhost',
    port: API_PORTS[++lastApiWorker === maxApiWorker ? lastApiWorker = 0 : lastApiWorker]
  });

  const getSocketWorker = () => ({
    host: 'localhost',
    port: SOCKET_PORT
  });

  function onProxyReq(proxyReq, req, res, options) {
    let remoteAddress;
    if (req.connection) {
      if (req.connection.remoteAddress) remoteAddress = req.connection.remoteAddress;
      else if (req.connection.socket && req.connection.socket.remoteAddress) remoteAddress = req.connection.socket.remoteAddress;
    }
    if (!remoteAddress && req.socket && req.socket.remoteAddress) remoteAddress = req.socket.remoteAddress;

    proxyReq.setHeader('host', req.headers.host);
    proxyReq.setHeader('x-forwarded-for', remoteAddress);
  }

  const proxyHTTP = httpProxy.createProxyServer({}).on('proxyReq', onProxyReq);
  const proxySOCKET = new httpProxy.createProxyServer({ target: getSocketWorker() }).on('proxyReq', onProxyReq);


  const connections = {};
  let connectionCounter = 0;

  const destroyConnection = (socket, force) => {
    if (force || (socket._isIdle && _closing)) {
      socket.destroy();
      delete connections[socket._connectionId];
    }
  };

  const onConnection = (socket) => {
    const id = connectionCounter++;
    socket._isIdle = true;
    socket._connectionId = id;
    connections[id] = socket;
    socket.on('close', function() {
      delete connections[id];
    });
  };

  const onRequest = (req, res) => {
    req.socket._isIdle = false;
    res.on('finish', function() {
      req.socket._isIdle = true;
      destroyConnection(req.socket);
    });
  };

  const processors = [];

  if (SOCKET_ENABLED) {
    processors.push((req, res) => {
      if (req.url.indexOf(SOCKET_PATH) === 0) {
        proxySOCKET.web(req, res);
        return true;
      }
    });
  }

  if (API_ENABLED) {
    processors.push((req, res) => {
      proxyHTTP.web(req, res, { target: getApiWorker() });
      return true;
    });
  }

  function router(req, res) {
    for (let index = 0, max = processors.length; index < max; index++) {
      if (processors[index](req, res)) break;
    }
  }

  const server = http.createServer(router);
  server.on('connection', onConnection);
  server.on('request', onRequest);

  if (SOCKET_ENABLED) {
    server.on('upgrade', function (req, socket, head) {
      proxySOCKET.ws(req, socket, head);
    });
  }


  const init = () => {
    server.listen(PROXY_PORT, () => {
      _running = true;
      log({
        message: 'Start proxy on port: '+ PROXY_PORT +' with path: '+ PROXY_PATH,
        event: PROXY_START
      });
      _onInit();
    });
  };

  const end = (forced) => {
    log({
      message: 'Stop listen sockets on port: '+ PROXY_PORT + ', forced: ' + (forced === true ? 'true' : 'false'),
      event: PROXY_STOP
    });
    server.close(() => {
      if (_running) {
        _running = false;
        _onClose();
      }
    });
    Object.keys(connections).forEach(key => destroyConnection(connections[key]));
  };

  const close = (forced) => {
    if (_closing) return null;
    _closing = true;
    end(forced);
  };

  const isRunning = () => _running === true || _closing === true;

  return { init, close, isRunning };
}

module.exports = ProxyWorker;