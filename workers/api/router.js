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
const isO = Object.isObject;
const isA = Object.isArray;
const isS = Object.isString;


const { LocaleError, HttpError } = require('../../utils/errors');

const {
  API_URL_ROOT,
  API_DEFAULT_LOCALE,
  API_DEFAULT_CODE,
  API_DEFAULT_HEADERS,
  API_DEFAULT_METHODS,
  API_AVAILABLE_METHODS,
  API_LOG_PARSER,
  API_FALLBACK_URL,
  CORS,
  CORS_CREDENTIALS,
  CORS_ORIGINS,
  CORS_METHODS,
  CORS_HEADES,
  LOG_EVENTS: {
    API_SAVE,
    API_REQUEST,
    API_REQUEST_ERROR,
    API_REQUEST_REJECT
  }
} = require('./constants');

const ROOT_PATH = '/';
const PAGE_GENERATION_PROP = 'x-page-generation';

const corsHeads = (req) => {
  const headers = Object.clone(API_DEFAULT_HEADERS, true);
  if (!(req && req.headers && req.headers.origin)) return Promise.resolve({ headers });
  if (!CORS) return Promise.reject(new HttpError(500, 'Referrer not valid'));
  const rule = CORS_ORIGINS['*'] ? '*' : CORS_ORIGINS[req.headers.origin] ? req.headers.origin : null;
  if (!rule) return Promise.reject(new HttpError(500, 'Referrer not valid'));
  headers['access-control-allow-origin'] = rule;
  headers['access-control-allow-headers'] = CORS_HEADES || '';
  headers['access-control-allow-methods'] = CORS_METHODS || '';
  headers['access-control-allow-credentials'] = CORS_CREDENTIALS;
  return Promise.resolve({ headers });
};

const parseBody = (httpReq) => new Promise((resolve, reject) => {
  switch (httpReq.method) {
    case 'DELETE':
    case 'HEAD':
      resolve('');
      break;
    case 'GET':
      resolve(undefined);
      break;
    default:
      const body = [];
      httpReq
        .on('data', chunk => body.push(chunk))
        .on('end', () => resolve(Buffer.concat(body).toString()))
        .on('error', error => reject(error));
  }
});

const makeRoute = (httpReq) => {
  const { method, url } = httpReq;
  const headers = isO(httpReq.headers) ? httpReq.headers : {};
  const hostFull = (headers[config.get('api.hostKey')] || headers.host || ':80').split(':', 2);
  const host = hostFull[0];
  const port = (hostFull[1]|0) || 80;
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

  const routes = new Map();
  const paths = {};

  function onProxyReq(proxyReq, req, res, options) {
    let remoteAddress;
    if (req.connection) {
      if (req.connection.remoteAddress) remoteAddress = req.connection.remoteAddress;
      else if (req.connection.socket && req.connection.socket.remoteAddress) remoteAddress = req.connection.socket.remoteAddress;
    }
    if (!remoteAddress && req.socket && req.socket.remoteAddress) remoteAddress = req.socket.remoteAddress;

    proxyReq.setHeader('host', req.headers.host || '');
    proxyReq.setHeader('x-forwarded-for', remoteAddress);
  }
  const proxyHTTP = httpProxy.createProxyServer({}).on('proxyReq', onProxyReq);

  function findRoute(path, parent) {
    const p = path.shift();
    const node = (parent || paths)[p];
    if (node) {
      if (path.length) return findRoute(path, node);
      return isO(node) ? node[ROOT_PATH] : node;
    }
    return isO(parent) ? parent[ROOT_PATH] : parent;
  }

  function getRoute(host, path, method) {
    const routeKey = findRoute([host].concat(path).compact(true));
    if (routeKey) {
      let route = routes.get(routeKey);
      if (route && (method === 'OPTIONS' || route.methods[method])) return route;
    }
    if (host !== '*') return getRoute('*', path, method);
  }

  function addPath(path, routeKey, index = 1, separator = ROOT_PATH) {
    const p = path.slice(0, index).join(separator);
    const node = lib.getField(paths, p, separator);
    const val = path.length > index ? {} : routeKey;
    if (!node) {
      if (index > 1) {
        const parentPath = path.slice(0, index - 1).join(separator);
        const parent = lib.getField(paths, parentPath, separator);
        if (parent) {
          if (!isO(parent)) lib.addField(paths, parentPath, { [ROOT_PATH]: parent }, separator);
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
    if (!(methods0 && methods0.length > 0)) throw new Error('Empty methods');
    if (!(domain && isS(domain) && domain.length > 0)) domain = '*';
    if (domain !== '*' && !path) throw new Error('Empty path');
    if (!handler) throw new Error('Empty handler');
    if (domain !== '*' && !(path && path.length >= 1 && path[0] !== ROOT_PATH)) throw new Error('Bad route');

    const methods = {};
    methods0.forEach(m => methods[m] = true);

    const routeKey = domain + API_URL_ROOT + endpoint + ROOT_PATH + path;
    routes.set(routeKey, { handler, bucket, methods });
    const fullPath = [domain, endpoint].concat(path.split(ROOT_PATH)).compact(true);
    addPath(fullPath, routeKey);
  }

  function makeRequest(httpReq, req, route) {
    req.cookie = cookieParser.parse(req.headers.cookie || '');
    if (route.bucket) req.info = { update_seq: route.bucket.getSeq() };
    return Promise.all([
      sessions.loadSession(req),
      parseBody(httpReq).catch(error => {
        log({
          message: 'Error on parse body',
          event: API_REQUEST_ERROR,
          error
        });
        throw new HttpError(500, 'Bad request', error);
      })
    ])
    .then(([userCtx, body]) => {
      if (route.bucket) userCtx.db = route.bucket.name;
      req.userCtx = userCtx;
      req.body = body;
      return req;
    });
  }

  function makeError(error, req) {
    let code = 500;
    const json = {
      reason: 'Bad action',
      ok: false
    };

    if (error) {
      if (error instanceof HttpError || error instanceof LocaleError) {
        let errorLocale = new locale.Locales(req.headers['accept-language'] || API_DEFAULT_LOCALE)[0];
        if (errorLocale && errorLocale.language) errorLocale = errorLocale.language.toUpperCase();
        else errorLocale = 'EN';

        if (error.code) code = error.code;
        else if (error && error.error && error.error.code) code = error.error.code;

        json.reason = error.toString(errorLocale);
        if (error.error) json.error = Object.isString(error.error) ? error.error : error.error.message;

        return { code, json };
      }

      if (error.code > 0) code = error.code;
      if (error.reason) json.reason = error.reason;

      if (error instanceof Error) {
        json.error = error.toString();
      } else {
        if (isO(error)) {
          json.error = new Error(error.message || error.error);
        } else {
          json.error = new Error(error);
        }
      }
    }

    return { code, json };
  }

  function sendResult(req, res, result = {}) {
    const code = result.code || API_DEFAULT_CODE;
    const headers = result.headers || API_DEFAULT_HEADERS;
    const logProps = API_LOG_PARSER(req);
    let pageGen = 0;

    if (req && req.headers && req.headers[PAGE_GENERATION_PROP]) {
      pageGen = Date.now() - req.headers[PAGE_GENERATION_PROP];
      headers[PAGE_GENERATION_PROP] = pageGen;
    } else {
      delete headers[PAGE_GENERATION_PROP];
    }

    function logRequest() {
      log(Object.assign(logProps, {
        message: 'Request ['+ pageGen +'ms] '+ code +' ' + logProps.url,
        data: {
          code: code,
          pageGen: pageGen
        },
        event: API_REQUEST
      }));
    }

    if (result.stream && result.stream.pipe) {
      // Stream
      headers['x-accel-buffering'] = 'no';
      res.writeHead(code, headers); // disable nginx cache for stream

      let hasError = false;
      result.stream
        .on('error', error => {
          log(Object.assign(logProps, {
            message: 'Error pipe result stream',
            event: API_REQUEST_ERROR,
            error,
            type: 'warn'
          }));
          hasError = true;
          return sendResult(req, res, makeError(new HttpError(500, error.message, error), req));
        })
        .pipe(res)
        .on('error', error => {
          hasError = true;
          log(Object.assign(logProps, {
            message: 'Error pipe result',
            event: API_REQUEST_ERROR,
            error,
            type: 'fatal'
          }));
          return sendResult(req, res, makeError(new HttpError(500, error.message, error), req));
        })
        .on('finish', function() {
          if (!hasError) logRequest();
        })
    } else {
      // Body
      if (result.json) {
        // JSON sugar
        headers['content-type'] = 'application/json; charset=UTF-8';
        try {
          result.body = JSON.stringify(result.json);
        } catch (error) {
          log(Object.assign(logProps, {
            message: 'Error on parse result',
            event: API_REQUEST_ERROR,
            error
          }));
          return sendResult(req, res, makeError(new HttpError(500, error.message, error), req));
        }
      }

      res.writeHead(code, headers);

      if (result.body !== undefined) {
        try {
          res.write(result.body);
        } catch (error) {
          log(Object.assign(logProps, {
            message: 'Error on send result',
            event: API_REQUEST_ERROR,
            error
          }));
          return sendResult(req, res, makeError(new HttpError(500, error.message, error), req));
        }
      }

      res.end(error => {
        logRequest();
        if (error) {
          log(Object.assign(logProps, {
            message: 'Error on send response',
            event: API_REQUEST_ERROR,
            error,
            type: 'fatal'
          }));
        }
      });
    }
  }

  function onRequest(httpReq, res) {
    httpReq.headers[PAGE_GENERATION_PROP] = Date.now();
    const req = makeRoute(httpReq);
    const logProps = API_LOG_PARSER(req);

    function sendR(result) {
      sendResult(req, res, result);
    }
    function sendE(error) {
      if (error && (error.code === 404 || error.code === '404') && API_FALLBACK_URL) {
        proxyHTTP.web(httpReq, res, { target: API_FALLBACK_URL });
      } else {
        sendR(makeError(error, req));
      }
    }

    const route = getRoute(req.host, req.path, req.method);
    if (!route) return sendE(new HttpError(404));

    let processPromise;

    function onHandlerResult(result) {
      if (route.bucket && isA(result.docs) && result.docs.length > 0) {
        return saveResults(route.bucket.name, result.docs).then(function onResults() {
          log(Object.assign(logProps, {
            message: 'Saved api results',
            event: API_SAVE
          }));
          return result;
        });
      }
      return result;
    }
    function processRequest(req) {
      return route.handler(req).then(onHandlerResult);
    }


    if (req.headers.origin) {
      if (req.method === 'OPTIONS') {
        // send cors headers only
        processPromise = corsHeads(req);
      } else {
        // send cors headers and router result
        processPromise = Promise.all([
          corsHeads(req),
          makeRequest(httpReq, req, route).then(processRequest)
        ]).then(([corsResult, routerResult]) => Object.assign(corsResult, routerResult));
      }
    } else {
      // send router result only
      processPromise = makeRequest(httpReq, req, route).then(processRequest);
    }

    processPromise
      .then(sendR)
      .catch(error => {
        log(Object.assign(logProps, {
          message: 'Route rejection',
          event: API_REQUEST_REJECT,
          error
        }));
        sendE(error);
      });
  }

  return { addRoute, onRequest };
}

module.exports = Router;
