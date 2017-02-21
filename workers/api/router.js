require('sugar');
const Promise = require('bluebird');
const cookieParser = require('cookie');
const queryString = require('query-string');
const lib = require('../../utils/lib');
const saveResults = require('../../utils/resultsSaver');
const Logger = require('../../utils/logger');
const config = require('../../config');


const {
  NotFoundError,
  SendingError,
  BadReferrerError
} = require('../../utils/errors');

const {
  API_URL_ROOT,
  API_URL_PREFIX,
  API_DEFAULT_CODE,
  API_DEFAULT_HEADERS,
  API_DEFAULT_METHODS,
  API_AVAILABLE_METHODS,
  CORS,
  CORS_CREDENTIALS,
  CORS_ORIGINS,
  CORS_METHODS,
  CORS_HEADES,
  LOG_EVENTS: {
    API_SAVE, API_REQUEST_ERROR, API_REQUEST_REJECT
  }
} = require('./constants');

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
      return new Promise(resolve => {
        const body = [];
        req.on('data', chunk => body.push(chunk)).on('end', () => resolve(Buffer.concat(body).toString()));
      });
  }
};

const makeRoute = (req) => {
  const { method, url } = req;
  const headers = Object.isObject(req.headers) ? req.headers : {};
  const hostFull = (headers[config.get('api.hostKey')] || headers.host).split(':', 2);
  const host = hostFull[0];
  const port = hostFull[1] || 80;

  const peer = headers['x-forwarded-for'] || headers.referer;

  const queryIndex = url.indexOf('?');
  const raw_path = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
  const query = queryIndex >= 0 ? queryString.parse(url.substring(queryIndex + 1)) : {};
  const path = raw_path.substring(1).split('/');

  const routePath = '/' + path.filter(i => i && i.length).join('/');

  return { host, port, method, raw_path, query, path, routePath, headers, peer };
};

function Router(props = {}) {
  const { sessions } = props;
  const logger = new Logger({ prefix: 'Router', logger: props.logger });
  const log = logger.getLog();

  const routes = new Map();

  const getRoute = (host, routePath, method) => {
    let route = routes.get(host + routePath);
    if (route && (method === 'OPTIONS' || route.methods[method])) return route;
    if (host !== '*') return getRoute('*', routePath, method);
  };

  function addRoute(domain, endpoint, path, methods0 = API_DEFAULT_METHODS, handler, bucket) {
    methods0 = methods0.map(m => m.toUpperCase()).filter(m => m in API_AVAILABLE_METHODS);
    if (!methods0 || !methods0.length) throw new Error('Empty methods');
    if (!domain) throw new Error('Empty domain');
    if (!endpoint) throw new Error('Empty endpoint');
    if (endpoint[0] !== API_URL_PREFIX) throw new Error('Bad endpoint: ' + endpoint);
    if (!path) throw new Error('Empty path');
    if (!handler) throw new Error('Empty handler');
    if (!(endpoint && endpoint.length >= 1 && path && path.length >= 1 && path[0] !== '/')) throw new Error('Bad route');

    const methods = {}; methods0.forEach(m => methods[m] = true);

    const routeKey = domain + API_URL_ROOT + endpoint + (endpoint === API_URL_PREFIX ? '' : '/')+ path;
    routes.set(routeKey, { handler, bucket, methods });
  }

  const makeRequest = (req, request, route) => {
    request.cookie = cookieParser.parse(request.headers.cookie || '');
    if (route.bucket) request.info = { update_seq: route.bucket.getSeq() };
    return Promise.all([
      sessions.loadSession(request).then(userCtx => {
        if (route.bucket) userCtx.db = route.bucket.name;
        request.userCtx = userCtx;
      }),
      parseBody(req).then(body => { request.body = body; }).catch(error => {
        log({
          message: 'Error on parse body',
          event: API_REQUEST_ERROR,
          error
        });
      })
    ])
    .then(() => request);
  };

  const makeError = (error) => {
    let code = 500;
    const json = {
      error: 'not_found',
      reason: 'missing'
    };

    if (error) {
      if (error.code > 0) code = error.code;
      if (error.reason) json.reason = error.reason;

      if (error instanceof Error) {
        json.error = error.message;
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

  const sendResult = (res, result = {}) => {
    const code = result.code || API_DEFAULT_CODE;
    const headers = result.headers || API_DEFAULT_HEADERS;

    if (result.stream && result.stream.pipe) {
      res.writeHead(code, headers);
      result.stream.pipe(res);
    } else {
      if (result.json) {
        headers['Content-Type'] = 'application/json';
        try {
          result.body = JSON.stringify(result.json);
        } catch (error) {
          log({
            message: 'Error on parse result',
            event: API_REQUEST_ERROR,
            error
          });
          return sendResult(res, makeError(new SendingError(error)));
        }
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
          return sendResult(res, makeError(new SendingError(error)));
        }
      }
      res.end((error) => {
        if (error) {
          log({
            message: 'Error on send response',
            event: API_REQUEST_ERROR,
            error
          });
        }
      });
    }
  };

  function onRequest(req, res) {
    const send = result => sendResult(res, result);
    const sendError = error => sendResult(res, makeError(error));

    const request = makeRoute(req);
    const route = getRoute(request.host, request.routePath, request.method);
    if (!route) return sendError(new NotFoundError('not_found'));

    let processPromise;

    const processRequest = (request) => route.handler(request).then(result => {
      if (route.bucket && result.docs && result.docs.length) {
        return saveResults(route.bucket.getBucket(), result.docs).then(() => {
          log({
            message: 'Saved api results: "' + request.raw_path + '"',
            ref: request.raw_path,
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
      // send router result
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