require('sugar');
const Promise = require('bluebird');
const http = require('http');
const Bucket = require('./bucket');
const Router = require('./router');
const Sessions = require('./sessions');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const config = require('../../config');

const {
  API_URL_ROOT,
  LOG_EVENTS: {
    API_START, API_STOP, API_ROUTE_ERROR
  }
} = require('./constants');

function API(props = {}) {
  const logger = new Logger({ prefix: 'API', logger: props.logger });
  const log = logger.getLog();

  const _onInit = props.onInit || function(){};
  const _onClose = props.onClose || function(){};

  let _running = false;
  let _closing = false;

  const isRunning = () => _running === true || _closing === true;

  const API_PORT = props.port;
  const API_CLOSE_DELAY = config.get('api.ports').indexOf(API_PORT) * config.get('api.restartDelta');

  const parseEndpointsParam = (endpoints) => {
    const result = {};
    if (!(endpoints && Object.isObject(endpoints))) return result;
    Object.keys(endpoints).forEach(key => {
      const endpointKey = key.split(/\\|\|/);
      const domain = endpointKey[0];
      const endpoint = endpointKey[1];
      const endpointVal = endpoints[key];
      const paramsIndex = endpointVal.indexOf(' ');
      const dbParams = (paramsIndex > 0 ? endpointVal.substring(0, paramsIndex) : endpointVal).split('\/');
      const db = dbParams[0];
      const ddoc = dbParams[1];
      const methods = paramsIndex > 0 ? endpointVal.substring(paramsIndex + 1).split(/\s+/g).compact(true).unique() : [];
      if (!result[db]) result[db] = {};
      const route = domain + API_URL_ROOT + endpoint;
      result[db][route] = { domain, endpoint, db, ddoc, methods };
    });
    return result;
  };

  let timeout = 0;
  const sessions = new Sessions({ logger });
  const router = new Router({ logger, sessions });


  // Default routes
  router.addRoute('*', '_now', '', ['GET','POST'], (req) => Promise.resolve({
    code: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: Date.now().toString()
  }));


  // Server
  const server = http.createServer(router.onRequest);
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

  server.on('connection', onConnection);
  server.on('request', onRequest);

  const init = () => {
    _running = true;

    const tmp = parseEndpointsParam(props.endpoints);
    Promise.map(Object.keys(tmp), (name) => {
      const endpoints = tmp[name];
      const bucket = new Bucket({ logger, name });
      return bucket.init(endpoints).then(res => {
        if (timeout < res.timeout) timeout = res.timeout;
        bucket.onUpdate((needStop) => needStop && close());
        return res.handlers;
      });
    }).then(handlers => {
      handlers.flatten().forEach(({ domain, endpoint, handlerKey, methods, handler, bucket }) => {
        const path = handlerKey;
        try {
          router.addRoute(domain, endpoint, path, methods, handler, bucket);
        } catch (error) {
          log({
            message: 'Error on route creation: "'+ [domain, '/', endpoint, path].join('') + '"',
            event: API_ROUTE_ERROR,
            error
          });
        }
      });
      server.listen(API_PORT, function () {
        log({
          message: 'Start api listen requests on port: '+ API_PORT,
          event: API_START
        });
        _onInit({ timeout });
      });
    });
  };

  const end = (forced) => {
    log({
      message: 'Stop api on port: '+ API_PORT + ', forced: '+ (forced === true ? 'true' : 'false'),
      event: API_STOP
    });
    server.close(() => {
      if (_running) {
        _running = false;
        _onClose();
      }
    });
    sessions.close();
    Object.keys(connections).forEach(key => destroyConnection(connections[key]));
  };

  const close = (forced) => {
    if (_closing) return null;
    _closing = true;
    forced ? end(forced) : setTimeout(end, API_CLOSE_DELAY);
  };

  return { init, close, isRunning };
}

module.exports = API;