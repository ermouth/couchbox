require('sugar');
const Promise = require('bluebird');
const http = require('http');
const Bucket = require('./bucket');
const Router = require('./router');
const Sessions = require('./sessions');
const Logger = require('../../utils/logger');
const config = require('../../config');

const {
  API_URL_ROOT,
  LOG_EVENTS: {
    API_START, API_STOP, API_ROUTE_ERROR
  }
} = require('./constants');
const { COUCHDB_KEY_SPLITTER } = require('../sandbox/constants');

function API(props = {}) {
  const logger = new Logger({ prefix: 'API', logger: props.logger });
  const log = logger.getLog();

  const _onInit = props.onInit || function(){};
  const _onClose = props.onClose || function(){};

  let _running = false;
  let _closing = false;

  function isRunning() {
    return _running === true || _closing === true;
  }

  const API_PORT = props.port;
  const API_CLOSE_DELAY = config.get('api.ports').indexOf(API_PORT) >= 0
    ? config.get('api.ports').indexOf(API_PORT) * config.get('api.restart_delta')
    : config.get('api.restart_delta');

  function parseEndpointsParam(endpoints) {
    const result = {};
    if (!(endpoints && Object.isObject(endpoints))) return result;
    Object.keys(endpoints).forEach(function(key){
      const endpointKey = key.split(COUCHDB_KEY_SPLITTER);
      const domain = endpointKey[0];
      const endpoint = endpointKey[1];
      const endpointVal = endpoints[key];
      const paramsIndex = endpointVal.indexOf(' ');
      const dbParams = (paramsIndex > 0 ? endpointVal.substring(0, paramsIndex) : endpointVal).split('\/');
      const db = dbParams[0];
      const ddoc = dbParams[1];
      const methods = paramsIndex > 0 ? endpointVal.substring(paramsIndex + 1).split(/\s+/g).compact(true).unique() : [];
      if (!result[db]) result[db] = {};
      const route = domain + (endpoint ? API_URL_ROOT + endpoint : '');
      result[db][route] = { domain, endpoint, db, ddoc, methods };
    });
    return result;
  }

  let timeout = 0;
  const sessions = new Sessions({ logger });
  const router = new Router({ logger, sessions });


  // Default routes
  router.addRoute('*', '', '_now', ['GET','POST'], function route_now(req){
    return Promise.resolve({
      code: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: Date.now().toString()
    })
  });

  // Max sockets param
  if (config.get('api.maxSockets') && config.get('api.maxSockets') > 0) {
    http.globalAgent.maxSockets = config.get('api.maxSockets')|0;
  } else {
    http.globalAgent.maxSockets = Infinity;
  }

  // Server
  const server = http.createServer(router.onRequest);
  const connections = {};
  let connectionCounter = 0;

  function destroyConnection(socket, force) {
    if (force || (socket._isIdle && _closing)) {
      socket.destroy();
      delete connections[socket._connectionId];
    }
  }
  function onConnection(socket) {
    const id = connectionCounter++;
    socket._isIdle = true;
    socket._connectionId = id;
    connections[id] = socket;
    socket.on('close', function() {
      delete connections[id];
    });
    // TODO: on error handler
  }
  function onRequest(req, res) {
    req.socket._isIdle = false;
    res.on('finish', function() {
      req.socket._isIdle = true;
      destroyConnection(req.socket);
    });
  }

  server.on('connection', onConnection);
  server.on('request', onRequest);

  function init() {
    _running = true;

    const tmp = parseEndpointsParam(props.endpoints);
    Promise.map(Object.keys(tmp), function(name){
      const endpoints = tmp[name];
      const bucket = new Bucket({ logger, name });
      return bucket.init(endpoints).then(function(res){
        if (timeout < res.timeout) timeout = res.timeout;
        bucket.onUpdate(function(needStop) {
          if (needStop) close();
        });
        return res.handlers;
      });
    })
      .then(function(handlers){
        handlers.flatten().forEach(function({ domain, endpoint, handlerKey, methods, handler, bucket }){
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
  }

  function end(forced) {
    log({
      message: 'Stop api on port: '+ API_PORT + ', forced: '+ (forced === true ? 'true' : 'false') + ', delay: '+ API_CLOSE_DELAY,
      event: API_STOP
    });
    server.close(function(){
      if (_running) {
        _running = false;
        _onClose();
      }
    });
    sessions.close();
    Object.keys(connections).forEach(function(key){
      destroyConnection(connections[key])
    });
  }

  function close(forced) {
    if (_closing) return null;
    _closing = true;
    forced ? end(forced) : setTimeout(end, API_CLOSE_DELAY);
  }

  return { init, close, isRunning };
}

module.exports = API;