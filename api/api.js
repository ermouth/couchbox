require('sugar');
const Promise = require('bluebird');
const http = require('http');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const Bucket = require('./bucket');
const Router = require('./router');
const config = require('../config');

const { LOG_EVENT_API_START, LOG_EVENT_API_STOP, LOG_EVENT_API_ROUTE_ERROR } = require('../constants/logEvents');

const { API_URL_ROOT } = require('../constants/api');

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
  const router = new Router({ logger });

  router.addRoute('*', '_', 'now', (req) => new Promise((resolve, reject) => {
    resolve({
      code: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: Date.now().toString()
    });
  }));

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
     Promise.all(Object.keys(tmp).map(name => {
       const endpoints = tmp[name];
       const bucket = new Bucket({ logger, name });
       return bucket.init(endpoints).then(res => {
         if (timeout < res.timeout) timeout = res.timeout;
         bucket.onUpdate((needStop) => needStop && close());
         return res.handlers;
       });
     })).then(results => {
       results.flatten().forEach(({ domain, endpoint, path, handler }) => {
         try {
           router.addRoute(domain, endpoint, path, handler);
         } catch (error) {
           log({
             message: 'Error on route creation: "'+ [domain, '/', endpoint, path].join('') + '"',
             event: LOG_EVENT_API_ROUTE_ERROR,
             error
           });
         }
       });
       server.listen(API_PORT, function () {
         log({
           message: 'Start api listen requests on port: '+ API_PORT,
           event: LOG_EVENT_API_START
         });
         _onInit({ timeout });
       });
     });
  };

  const end = () => {
    log({
      message: 'Stop api on port: '+ API_PORT,
      event: LOG_EVENT_API_STOP
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
    forced ? end() : setTimeout(end, API_CLOSE_DELAY);
  };

  return {
    init, close,
    isRunning
  };
}

module.exports = API;