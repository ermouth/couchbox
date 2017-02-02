require('sugar');
const Promise = require('bluebird');
const http = require('http');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const Bucket = require('./bucket');
const Router = require('./router');
// const couchdb = require('../utils/couchdb');
const config = require('../config');

const NODE_NAME = config.get('couchbox.nodename');
const { LOG_EVENT_API_START, LOG_EVENT_API_STOP, LOG_EVENT_API_ROUTE_ERROR } = require('../constants/logEvents');

const {
  API_URL_ROOT,
} = require('../constants/api');

function API(props = {}) {
  const logger = new Logger({ prefix: 'API', logger: props.logger });
  const log = logger.getLog();

  const _onInit = props.onInit || function(){};
  const _onClose = props.onClose || function(){};

  let _running = false;
  let _closing = false;

  const isRunning = () => _running === true || _closing === true;

  const API_PORT = props.port;

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
      const methods = paramsIndex > 0 ? endpointVal.substring(paramsIndex + 1).split(/\s+/g).compact(true) : [];
      if (!result[db]) result[db] = {};
      const route = domain + API_URL_ROOT + endpoint;
      result[db][route] = { domain, endpoint, db, ddoc, methods };
    });
    return result;
  };

  const dbs = {};

  const router = new Router({ logger });

  router.addRoute('*', '_', 'now', (req) => new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve({
        code: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: Date.now().toString()
      });
    }, 5000);
    setTimeout(close, 2000);
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

  server.on('connection', function(socket) {
    const id = connectionCounter++;
    socket._isIdle = true;
    socket._connectionId = id;
    connections[id] = socket;
    socket.on('close', function() {
      delete connections[id];
    });
  });

  server.on('request', function(req, res) {
    console.log('new request');
    req.socket._isIdle = false;
    res.on('finish', function() {
      console.log('finish');
      req.socket._isIdle = true;
      destroyConnection(req.socket);
    });
  });

  const onHandler = (domain, endpoint, path, handler) => {
    console.log();
    console.log('onHandler', domain, endpoint, path, handler);
    console.log();
  };

  const init = () => {
    _running = true;

    const tmp = parseEndpointsParam(props.endpoints);
    // Promise.all(Object.keys(tmp).map(name => {
    //   console.log();
    //   console.log('name', name, tmp[name]);
    //   console.log();
    //   const endpoints = tmp[name];
    //   const bucket = dbs[name] = new Bucket({ logger, name });
    //   return bucket.init(endpoints);
    // })).then(results => {
    //   results.flatten().forEach(({ domain, endpoint, path, handler }) => {
    //     try {
    //       router.addRoute(domain, endpoint, path, handler);
    //     } catch (error) {
    //       log({
    //         message: 'Error on route creation: "'+ [domain, '/', endpoint, path].join('') + '"',
    //         event: LOG_EVENT_API_ROUTE_ERROR,
    //         error
    //       });
    //     }
    //   });
       server.listen(API_PORT, function () {
         log({
           message: 'Start api listen requests on port: '+ API_PORT,
           event: LOG_EVENT_API_START
         });
         _onInit();
       });
    // });
  };

  const close = () => {
    _closing = true;
    log({
      message: 'Stop api on port: '+ API_PORT,
      event: LOG_EVENT_API_STOP
    });
    server.close(() => {
      if (_running) {
        _running = false;
        _onClose();
        console.log('ONCLOSE 0');
      }
    });
    Object.keys(connections).forEach(key => destroyConnection(connections[key]));
  };

  return {
    init, close,
    isRunning
  };
}

module.exports = API;