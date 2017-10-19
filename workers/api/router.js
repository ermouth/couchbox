require('sugar');
const Promise = require('bluebird');
const httpProxy = require('http-proxy');
const cookieParser = require('cookie');
const queryString = require('query-string');
// const locale = require('locale');
const lib = require('../../utils/lib');
const saveResults = require('../../utils/resultsSaver');
const Logger = require('../../utils/logger');
const config = require('../../config');


const isO = Object.isObject;
const isA = Object.isArray;
const isS = Object.isString;


const { HttpError, HTTP_CODES } = require('../../utils/errors');

const {
  // API_URL_ROOT,
  // API_DEFAULT_LOCALE,
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
    API_SAVE_ERROR,
    API_REQUEST,
    API_REQUEST_ERROR,
    API_REQUEST_REJECT
  }
} = require('./constants');

const ROOT_PATH = '/';
const PAGE_GENERATION_PROP = 'x-page-generation';


const CORS_RULES = {
  '*': false,
  'http': false,
  'https': false
};

function CORS_RULE_PARSER(rule) {
  const protocol = rule.substr(0, rule.indexOf('://'));
  if (CORS_RULES[protocol] === true) return;

  let address = rule.substr(protocol.length + 3);
  if (address === '*') {
    CORS_RULES[protocol] = true;
  }

  address = address.split('.');
  let all = false;
  if (address[0] === '*') {
    all = true;
    address = address.slice(1);
  }
  address = address.join('.');

  if (!Object.isObject(CORS_RULES[protocol])) CORS_RULES[protocol] = {};
  CORS_RULES[protocol][address] = all ? 2 : 1;
}

if (CORS_ORIGINS['*']) CORS_RULES['*'] = true;
else Object.keys(CORS_ORIGINS).forEach(CORS_RULE_PARSER);

function checkAddress(protocol, address, checkAll = false) {
  if (CORS_RULES[protocol][address]) {
    return checkAll ? CORS_RULES[protocol][address] === 2 : true;
  } else {
    address = address.split('.').slice(1).join('.');
    if (address) return checkAddress(protocol, address, true);
    return false;
  }
}

function corsHeads(req) {
  const headers = Object.clone(API_DEFAULT_HEADERS, true);
  if (!(req && req.headers && req.headers.origin)) return Promise.resolve({ headers });
  if (!CORS) return Promise.reject(new HttpError(500, 'Referrer not valid'));
  const origin = req.headers.origin;
  if (!CORS_RULES['*']) {
    const protocol = origin.substr(0, origin.indexOf('://'));
    if (!CORS_RULES[protocol]) return Promise.reject(new HttpError(500, 'Referrer not valid'));
    if (!checkAddress(protocol, origin.substr(protocol.length + 3))) return Promise.reject(new HttpError(500, 'Referrer not valid'));
  }
  headers['access-control-allow-origin'] = origin;
  headers['access-control-allow-headers'] = CORS_HEADES || '';
  headers['access-control-allow-methods'] = CORS_METHODS || '';
  headers['access-control-allow-credentials'] = CORS_CREDENTIALS;
  return Promise.resolve({ headers });
}

function parseBody(httpReq) {
  switch (httpReq.method) {
    case 'DELETE':
    case 'HEAD':
      return Promise.resolve('');
    case 'GET':
      return Promise.resolve(undefined);
  }
  return new Promise(function parseBodyPromise(resolve, reject) {
    const body = [];
    httpReq
      .on('data', function onBodyChunk(chunk) {
        body.push(chunk)
      })
      .on('end', function onBodyEnd() {
        resolve(Buffer.concat(body).toString());
      })
      .on('error', function onBodyError(error) {
        reject(error)
      });
  });
}

function makeReq(httpReq) {
  const { method, url } = httpReq;
  const headers = isO(httpReq.headers) ? httpReq.headers : {};
  const hostFull = (headers[config.get('api.hostKey')] || headers.host || ':80').split(':', 2);
  const host = hostFull[0];
  const port = (hostFull[1]|0) || 80;
  const peer = headers['x-forwarded-for'] || headers['referer'];
  const queryIndex = url.indexOf('?');
  const path = (queryIndex >= 0 ? url.substring(0, queryIndex) : url).substring(1).split(ROOT_PATH).filter(i => i && i.length > 0);
  const query = queryIndex >= 0 ? queryString.parse(url.substring(queryIndex + 1)) : {};
  return { host, port, method, raw_path: '/' + path.join(ROOT_PATH), query, path, headers, peer };
}

function Router(props = {}) {
  const { sessions } = props;
  const logger = new Logger({ prefix: 'Router', logger: props.logger });
  const log = logger.getLog();
  // const debug = logger.getDebug();

  const routes = new Map();
  const paths = {};

  const proxyHTTP = httpProxy.createProxyServer({});
  proxyHTTP.on('error', function onProxyError(err, req, res) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  });
  proxyHTTP.on('proxyReq', function onProxyReq(proxyReq, req) {
    let remoteAddress;
    if (req.connection) {
      if (req.connection.remoteAddress) remoteAddress = req.connection.remoteAddress;
      else if (req.connection.socket && req.connection.socket.remoteAddress) remoteAddress = req.connection.socket.remoteAddress;
    }
    if (!remoteAddress && req.socket && req.socket.remoteAddress) remoteAddress = req.socket.remoteAddress;

    proxyReq.setHeader('host', req.headers.host || '');
    if (remoteAddress) proxyReq.setHeader('x-forwarded-for', remoteAddress);
  });

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
    methods0.forEach(function onMethod(method) { methods[method] = true; });

    const routeKey = [domain, endpoint, path].compact(true).join(ROOT_PATH);
    routes.set(routeKey, { handler, bucket, methods });
    const fullPath = [domain, endpoint].concat(path.split(ROOT_PATH)).compact(true);
    addPath(fullPath, routeKey);
  }

  function makeRequest(httpReq, req, route) {
    req.cookie = cookieParser.parse(req.headers.cookie || '');
    if (route.bucket) req.info = { update_seq: route.bucket.getSeq() };
    return Promise.all([
      sessions.loadSession(req),
      parseBody(httpReq).catch(function onParseBodyError(error) {
        log({
          message: 'Error on parse body',
          event: API_REQUEST_ERROR,
          error
        });
        throw new HttpError(500, 'Bad request');
      })
    ])
    .then(function onMakeRequest([userCtx, body]) {
      if (route.bucket) userCtx.db = route.bucket.name;
      req.userCtx = userCtx;
      req.body = body;
      return req;
    });
  }

  function parseError(error) {
    if (!error) return 'Undefined error';
    if (Object.isString(error)) return error;
    if (Object.isObject(error)) return JSON.stringify(error);
    if (error instanceof Error || error.toString) return error.toString();
  }

  function makeError(errorData) {
    let code = 500;
    let error, reason;
    const errorRes = {
      event: API_REQUEST_REJECT
    };

    // HttpError
    if (errorData instanceof HttpError) {
      reason = errorData;
      if (errorData.code) code = errorData.code;
      if (errorData.error) error = errorData.error;
      if (errorData.event) errorRes.event = errorData.event;
    }
    // Error
    else if (errorData instanceof Error || errorData.stack) {
      reason = errorData;
      if (errorData.code) code = errorData.code;
      if (errorData.event) errorRes.event = errorData.event;
      if (errorData.headers) errorRes.headers = errorData.headers;
    }
    // String
    else if (Object.isString(errorData)) {
      reason = errorData;
    }
    // Number
    else if (Object.isNumber(errorData)) {
      code = errorData;
    }
    // Object
    else if (Object.isObject(errorData)) {
      if (errorData.code) code = +errorData.code;
      if (errorData.reason) reason = errorData.reason;
      if (errorData.error) error = errorData.error;
      if (errorData.event) errorRes.event = errorData.event;
      if (errorData.headers) errorRes.headers = errorData.headers;

      if (errorData.stream) errorRes.stream = errorData.stream;
      else if (errorData.body) errorRes.body = errorData.body;
      else if (errorData.json) errorRes.json = errorData.json;
    }
    // Any .toString
    else if (errorData && errorData.toString) {
      reason = errorData.toString();
    }

    if (!reason || reason === 'Handler rejection') reason = error || 'Route rejection';
    if (!error) error = HTTP_CODES[code] || 'bad_action';
    errorRes.code = code;
    errorRes.reason = reason;
    errorRes.error = error;

    if (!(errorRes.stream || errorRes.body || errorRes.json) && (!API_FALLBACK_URL || (code !== 404 && API_FALLBACK_URL))) {
      errorRes.json = {
        ok: false,
        reason: parseError(reason),
        error: parseError(error)
      };
    }

    return errorRes;
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

    function logRequest(error) {
      const msg = Object.assign(logProps, {
        message: 'Request ['+ code +'] '+ pageGen +'ms ' + logProps.url,
        data: {
          code: code,
          pageGen: pageGen
        },
        event: API_REQUEST
      });
      if (error) msg.error = error;
      log(msg);
    }

    if (result.stream && result.stream.pipe) {
      // Stream
      headers['x-accel-buffering'] = 'no';
      res.writeHead(code, headers); // disable nginx cache for stream

      let hasError = false;
      result.stream
        .on('error', function onStreamError(error) {
          log(Object.assign(logProps, {
            message: 'Error pipe result stream',
            event: API_REQUEST_ERROR,
            error,
            type: 'warn'
          }));
          hasError = true;
          return sendResult(req, res, makeError(new HttpError(500, 'Error pipe result stream')));
        })
        .pipe(res)
        .on('error', function onStreamPipeError(error) {
          hasError = true;
          log(Object.assign(logProps, {
            message: 'Error pipe result',
            event: API_REQUEST_ERROR,
            error,
            type: 'fatal'
          }));
          return sendResult(req, res, makeError(new HttpError(500, 'Error pipe result')));
        })
        .on('finish', function() {
          if (!hasError) logRequest();
        })
    } else {
      // Body
      if (!result.body && result.json) {
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
          return sendResult(req, res, makeError(new HttpError(500, 'Error on parse result')));
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
          return sendResult(req, res, makeError(new HttpError(500, 'Error on send result')));
        }
      }

      res.end(function onReqEnd(error) {
        logRequest(error);
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
    const req = makeReq(httpReq);
    const logProps = API_LOG_PARSER(req);

    function send(result) {
      if (API_FALLBACK_URL && (result.code === 404 || result.code === '404') && !(result.body || result.body || result.json)) {
        proxyHTTP.web(httpReq, res, { target: API_FALLBACK_URL });
      } else {
        sendResult(req, res, result);
      }
    }

    const route = getRoute(req.host, req.path, req.method);
    if (!route) return send(makeError(new HttpError(404)));

    let processPromise;

    function saveDocs(result) {
      return new Promise(function saveDocsPromise(resolve) {
        if (!(route.bucket && isA(result.docs) && result.docs.length > 0)) {
          return resolve(result);
        }
        saveResults(route.bucket.name, result.docs)
          .then(function saveDocsResults() {
            log(Object.assign(logProps, {
              message: 'Saved api results',
              event: API_SAVE
            }));
            return resolve(result);
          })
          .catch(function saveDocsError(error) {
            log(Object.assign(logProps, {
              message: 'Error on saving api results',
              event: API_SAVE_ERROR,
              error
            }));
            return resolve(result);
          });
      });
    }

    function onHandlerError(error) {
      if (Object.isObject(error) && Object.isArray(error.docs)) {
        return saveDocs(error).then(function onHandlerDocs() {
          return Promise.reject(error);
        });
      }
      return Promise.reject(error);
    }

    function processHandler() {
      return route.handler(req)
        .catch(onHandlerError)
        .then(saveDocs);
    }

    if (req.headers.origin) {
      if (req.method === 'OPTIONS') {
        // send cors headers only
        processPromise = corsHeads(req);
      } else {
        // send cors headers and router result
        processPromise = Promise.all([
          corsHeads(req),
          makeRequest(httpReq, req, route).then(processHandler)
        ]).then(function ([corsResult, routerResult]) {
          return Object.assign(corsResult, routerResult);
        });
      }
    } else {
      // send router result only
      processPromise = makeRequest(httpReq, req, route).then(processHandler);
    }

    processPromise
      .catch(function onRouteError(error) {
        const errorRes = makeError(error);
        log(Object.assign(logProps, {
          message: errorRes.reason,
          error: errorRes.error,
          event: errorRes.event || API_REQUEST_REJECT
        }));
        return errorRes;
      })
      .then(send);
  }

  return { addRoute, onRequest };
}

module.exports = Router;
