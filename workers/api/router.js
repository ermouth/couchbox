require('sugar');
const Promise = require('bluebird');
const httpProxy = require('http-proxy');
const cookieParser = require('cookie');
const queryString = require('query-string');
const locale = require('locale');
const lib = require('../../utils/lib');
const saveResults = require('../../utils/resultsSaver');
const Logger = require('../../utils/logger');
const config = require('../../config');


const DEBUG = config.get('debug');

const {
  NotFoundError,
  SendingError,
  BadRequestError,
  BadReferrerError
} = require('../../utils/errors');

const {
  API_URL_ROOT,
  API_URL_PREFIX,
  API_DEFAULT_CODE,
  API_DEFAULT_HEADERS,
  API_DEFAULT_METHODS,
  API_AVAILABLE_METHODS,
  API_REFERRER_PARSER,
  API_FALLBACK_URL,
  CORS,
  CORS_CREDENTIALS,
  CORS_ORIGINS,
  CORS_METHODS,
  CORS_HEADES,
  LOG_EVENTS: {
    API_SAVE, API_REQUEST_ERROR, API_REQUEST_REJECT
  }
} = require('./constants');

const ROOT_PATH = '/';
const PAGE_GENERATION_PROP = 'X-Page-Generation';

const corsHeads = (request) => {
  const headers = API_DEFAULT_HEADERS;
  if (!(request && request.headers && request.headers.origin)) return Promise.resolve({ headers });
  if (!CORS) return Promise.reject(new BadReferrerError());
  const rule = CORS_ORIGINS['*'] ? '*' : CORS_ORIGINS[request.headers.origin] ? request.headers.origin : null;
  if (!rule) return Promise.reject(new BadReferrerError());
  headers['Access-Control-Allow-Origin'] = rule;
  headers['Access-Control-Allow-Headers'] = CORS_HEADES || '';
  headers['Access-Control-Allow-Methods'] = CORS_METHODS || '';
  headers['Access-Control-Allow-Credentials'] = CORS_CREDENTIALS;
  return Promise.resolve({ headers });
};

const parseBody = (req) => {
  switch (req.method) {
    case 'DELETE':
    case 'HEAD':
      return Promise.resolve('');
    case 'GET':
      return Promise.resolve(undefined);
      break;
    default:
      return new Promise((resolve, reject) => {
        const body = [];
        req
          .on('data', chunk => body.push(chunk))
          .on('end', () => resolve(Buffer.concat(body).toString()))
          .on('error', error => reject(error));
      });
  }
};

const makeRoute = (req) => {
  const { method, url } = req;
  const headers = Object.isObject(req.headers) ? req.headers : {};
  const hostFull = (headers[config.get('api.hostKey')] || headers.host).split(':', 2);
  const host = hostFull[0];
  const port = hostFull[1]|0 || 80;

  const peer = headers['x-forwarded-for'] || headers.referer;

  const queryIndex = url.indexOf('?');
  const raw_path = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
  const query = queryIndex >= 0 ? queryString.parse(url.substring(queryIndex + 1)) : {};
  const path = raw_path.substring(1).split(ROOT_PATH);

  const routePath = ROOT_PATH + path.filter(i => i && i.length).join(ROOT_PATH);

  return { host, port, method, raw_path, query, path, routePath, headers, peer };
};

function Router(props = {}) {
  const { sessions } = props;
  const logger = new Logger({ prefix: 'Router', logger: props.logger });
  const log = logger.getLog();
  const debug = logger.getDebug();

  function onProxyReq(proxyReq, req, res, options) {
    let remoteAddress;
    if (req.connection) {
      if (req.connection.remoteAddress) remoteAddress = req.connection.remoteAddress;
      else if (req.connection.socket && req.connection.socket.remoteAddress) remoteAddress = req.connection.socket.remoteAddress;
    }
    if (!remoteAddress && req.socket && req.socket.remoteAddress) remoteAddress = req.socket.remoteAddress;

    proxyReq.setHeader('Host', req.headers.host);
    proxyReq.setHeader('X-Forwarded-For', remoteAddress);
  }
  const proxyHTTP = httpProxy.createProxyServer({}).on('proxyReq', onProxyReq);

  const routes = new Map();
  const paths = {};

  const findRoute = (path, parent) => {
    const p = path.shift();
    const node = (parent || paths)[p];
    if (node) {
      if (path.length) return findRoute(path, node);
      return Object.isObject(node) ? node[ROOT_PATH] : node;
    }
    return Object.isObject(parent) ? parent[ROOT_PATH] : parent;
  };
  const getRoute = (host, path, method) => {
    const routeKey = findRoute([host].concat(path).compact(true));
    if (routeKey) {
      let route = routes.get(routeKey);
      if (route && (method === 'OPTIONS' || route.methods[method])) return route;
    }
    if (host !== '*') return getRoute('*', path, method);
  };

  function addPath(path, routeKey, index = 1, separator = ROOT_PATH) {
    const p = path.slice(0, index).join(separator);
    const node = lib.getField(paths, p, separator);
    const val = path.length > index ? {} : routeKey;
    if (!node) {
      if (index > 1) {
        const parentPath = path.slice(0, index - 1).join(separator);
        const parent = lib.getField(paths, parentPath, separator);
        if (parent) {
          if (!Object.isObject(parent)) lib.addField(paths, parentPath, { [ROOT_PATH]: parent }, separator);
          lib.addField(paths, p, val, separator);
        }
      } else {
        lib.addField(paths, p, val, separator);
      }
    }
    if (path.length > index) addPath(path, routeKey, index + 1, separator);
  }

  function addRoute(domain, endpoint, path, methods0 = API_DEFAULT_METHODS, handler, bucket) {
    methods0 = methods0.map(m => m.toUpperCase()).filter(m => m in API_AVAILABLE_METHODS);
    if (!methods0 || !methods0.length) throw new Error('Empty methods');
    if (!domain) throw new Error('Empty domain');
    if (!endpoint) throw new Error('Empty endpoint');
    if (endpoint[0] !== API_URL_PREFIX) throw new Error('Bad endpoint: ' + endpoint);
    if (domain !=='*' && !path) throw new Error('Empty path');
    if (!handler) throw new Error('Empty handler');
    if (domain !=='*' && !(endpoint && endpoint.length >= 1 && path && path.length >= 1 && path[0] !== ROOT_PATH)) throw new Error('Bad route');

    const methods = {}; methods0.forEach(m => methods[m] = true);

    const routeKey = domain + API_URL_ROOT + endpoint + (endpoint === API_URL_PREFIX ? '' : ROOT_PATH)+ path;
    routes.set(routeKey, { handler, bucket, methods });
    const fullPath = [domain, endpoint].concat(path.split(ROOT_PATH)).compact(true);
    addPath(fullPath, routeKey);
  }

  const makeRequest = (req, request, route) => {
    request.cookie = cookieParser.parse(request.headers.cookie || '');
    if (route.bucket) request.info = { update_seq: route.bucket.getSeq() };
    return Promise.all([
      sessions.loadSession(request),
      parseBody(req).catch(error => {
        log({
          message: 'Error on parse body',
          event: API_REQUEST_ERROR,
          error
        });
        throw new BadRequestError(error);
      })
    ])
    .then(([userCtx, body]) => {
      if (route.bucket) userCtx.db = route.bucket.name;
      request.userCtx = userCtx;
      request.body = body;
      return request;
    });
  };

  const makeError = (error, req) => {
    let code = 500;
    const json = {
      error: 'not_found',
      reason: 'missing'
    };

    if (error) {
      if (error.code > 0) code = error.code;
      if (error.reason) json.reason = error.reason;

      if (error instanceof Error) {
        if (req && req.headers && error.error) {
          let errorLocale = new locale.Locales(req.headers['accept-language'])[0];
          if (errorLocale && errorLocale.language) errorLocale = errorLocale.language.toUpperCase();
          else errorLocale = 'EN';
          json.error = error.error.toString(errorLocale);
        } else {
          json.error = error.message;
        }
      } else {
        if (Object.isObject(error)) {
          json.error = new Error(error.message || error.error);
        } else {
          json.error = new Error(error);
        }
      }
    }

    return { code, json };
  };

  const sendResult = (req, res, result = {}) => {
    const code = result.code || API_DEFAULT_CODE;
    const headers = result.headers || API_DEFAULT_HEADERS;

    if (result.stream && result.stream.pipe) {
      // Stream
      headers[PAGE_GENERATION_PROP] = Date.now() - req.headers[PAGE_GENERATION_PROP];
      headers['X-Accel-Buffering'] = 'no';
      res.writeHead(code, headers); // disable nginx cache for stream

      result.stream
        .on('error', error => {
          log({
            message: 'Error pipe result stream',
            event: API_REQUEST_ERROR,
            error,
            type: 'warn'
          });
          return sendResult(req, res, makeError(new SendingError(error), req));
        })
        .pipe(res)
        .on('error', error => {
          log({
            message: 'Error pipe result',
            event: API_REQUEST_ERROR,
            error,
            type: 'fatal'
          });
          return sendResult(req, res, makeError(new SendingError(error), req));
        })
    } else {
      // Body
      if (result.json) {
        // JSON sugar
        headers['Content-Type'] = 'application/json; charset=UTF-8';
        try {
          result.body = JSON.stringify(result.json);
        } catch (error) {
          log({
            message: 'Error on parse result',
            event: API_REQUEST_ERROR,
            error
          });
          return sendResult(req, res, makeError(new SendingError(error), req));
        }
      }

      if (req && req.headers && req.headers[PAGE_GENERATION_PROP]) {
        headers[PAGE_GENERATION_PROP] = Date.now() - req.headers[PAGE_GENERATION_PROP];
      }

      res.writeHead(code, headers);

      if (result.body !== undefined) {
        try {
          res.write(result.body);
        } catch (error) {
          log({
            message: 'Error on send result',
            event: API_REQUEST_ERROR,
            error
          });
          return sendResult(req, res, makeError(new SendingError(error), req));
        }
      }
      res.end((error) => {
        if (error) {
          log({
            message: 'Error on send response',
            event: API_REQUEST_ERROR,
            error,
            type: 'fatal'
          });
        }
      });
    }
  };


  function onRequest(req, res) {
    req.headers[PAGE_GENERATION_PROP] = Date.now();
    const send = result => sendResult(req, res, result);
    const sendError = error => {
      if (DEBUG) {
        debug({
          message: 'Error on request',
          error
        });
      }
      if (error && (error.code === 404 || error.code === '404') && API_FALLBACK_URL) {
        proxyHTTP.web(req, res, { target: API_FALLBACK_URL });
      } else {
        sendResult(req, res, makeError(error, req));
      }
    };

    const request = makeRoute(req);

    if (DEBUG) debug('Request: '+ JSON.stringify(request));

    const route = getRoute(request.host, request.path, request.method);
    if (!route) return sendError(new NotFoundError('not_found'));

    let processPromise;

    const processRequest = (request) => route.handler(request).then(result => {
      if (route.bucket && Object.isArray(result.docs) && result.docs.length > 0) {
        return saveResults(route.bucket.getBucket(), result.docs).then(() => {
          log({
            message: 'Saved api results: "' + request.raw_path + '"',
            ref: API_REFERRER_PARSER(request),
            event: API_SAVE
          });
          return result;
        });
      }
      return result;
    });

    if (request.headers.origin) {
      if (request.method === 'OPTIONS') {
        // send cors headers only
        processPromise = corsHeads(request);
      } else {
        // send cors headers and router result
        processPromise = Promise.all([
          corsHeads(request),
          makeRequest(req, request, route).then(processRequest)
        ]).then(([corsResult, routerResult]) => Object.assign(corsResult, routerResult));
      }
    } else {
      // send router result only
      processPromise = makeRequest(req, request, route).then(processRequest);
    }

    processPromise.then(send).catch(error => {
      log({
        message: 'Route rejection',
        event: API_REQUEST_REJECT,
        error
      });
      sendError(error);
    });
  }

  return { addRoute, onRequest };
}

module.exports = Router;