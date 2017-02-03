require('sugar');
const cookieParser = require('cookie');
const queryString = require('query-string');
const Logger = require('../utils/logger');
const config = require('../config');

const {
  LOG_EVENT_API_REQUEST_ERROR,
  LOG_EVENT_API_REQUEST_REJECT,
  LOG_EVENT_API_REQUEST_BODY_ERROR
} = require('../constants/logEvents');

const {
  API_URL_ROOT,
  API_URL_PREFIX,
  API_DEFAULT_CODE,
  API_DEFAULT_HEADERS
} = require('../constants/api');

const CORS = config.get('cors.enabled') === true;
const CORS_CREDENTIALS = config.get('cors.credentials') === true;
const CORS_ORIGINS = {};
config.get('cors.origins').forEach(host => {
  if (host) CORS_ORIGINS[host] = true;
});
const CORS_METHODS = config.get('cors.methods').join(', ');
const CORS_HEADES = config.get('cors.headers').join(', ');


const corsUpdate = (request, result) => {
  if (!request || !result || !CORS) return result;
  if (!result.headers) result.headers = API_DEFAULT_HEADERS;
  const rule = CORS_ORIGINS['*'] ? '*'
    : request.headers && request.headers.origin && CORS_ORIGINS[request.headers.origin] ? request.headers.origin : null;
  if (!rule) return result;
  if (!result.headers['Access-Control-Allow-Origin']) {
    result.headers['Access-Control-Allow-Origin'] = rule;
  }
  if (!result.headers['Access-Control-Allow-Methods']) {
    result.headers['Access-Control-Allow-Methods'] = CORS_METHODS || '';
  }
  if (!result.headers['Access-Control-Allow-Headers']) {
    result.headers['Access-Control-Allow-Headers'] = CORS_HEADES || '';
  }
  if (!result.headers['Access-Control-Allow-Credentials']) {
    result.headers['Access-Control-Allow-Credentials'] = CORS_CREDENTIALS;
  }
  return result;
};

const parseBody = (req, callback) => {
  switch (req.method) {
    case 'DELETE':
    case 'HEAD':
      callback('');
      break;
    case 'GET':
      callback(undefined);
      break;
    default:
      const body = [];
      req.on('data', function(chunk) {
        body.push(chunk);
      }).on('end', function() {
        callback(Buffer.concat(body).toString());
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

  const routePath = '/' + path.slice(0,2).join('/');

  return { host, port, method, raw_path, query, path, routePath, headers, peer };
};

const makeRequest = (req, request, callback) => {
  request.cookie = cookieParser.parse(request.headers.cookie || '');
  request.requested_path = request.path;
  request.info = { update_seq: undefined };
  request.update_seq = undefined;
  request.secObj = undefined;
  request.userCtx = undefined;
  return parseBody(req, (body) => {
    request.body = body;
    callback(request);
  });
};

function Router(props = {}) {
  const logger = new Logger({ prefix: 'Router', logger: props.logger });
  const log = logger.getLog();

  const routes = new Map();

  function addRoute(domain, endpoint, path, handler) {
    if (!domain) throw new Error('Empty domain');
    if (!endpoint) throw new Error('Empty endpoint');
    if (endpoint[0] !== API_URL_PREFIX) throw new Error('Bad endpoint: ' + endpoint);
    if (!path) throw new Error('Empty path');
    if (!handler) throw new Error('Empty handler');

    const route =
      (endpoint && endpoint.length >= 1 && path && path.length >= 1) && (
        (endpoint === API_URL_PREFIX && path[0] !== '/') ||
        (endpoint.length > 1 && endpoint[0] === API_URL_PREFIX && path[0] === '/')
      )
      ? API_URL_ROOT + endpoint + path
      : null;
    if (!route) throw new Error('Empty route');

    const routeKey = domain + route;
    routes.set(routeKey, handler);
  }

  const getRoute = (host, routePath) => routes.get(host + routePath) || routes.get('*' + routePath);

  function onRequest(req, res) {
    const sendResult = (result) => {
      const code = result.code || API_DEFAULT_CODE;
      const headers = result.headers || API_DEFAULT_HEADERS;
      res.writeHead(code, headers);
      if (result.body !== undefined) {
        try {
          res.write(result.body);
        } catch (error) {
          log({
            message: 'Error on result.body',
            event: LOG_EVENT_API_REQUEST_ERROR,
            error
          });
          return sendError(500, error);
        }
      }
      res.end((error) => {
        if (error) {
          log({
            message: 'Error on result',
            event: LOG_EVENT_API_REQUEST_BODY_ERROR,
            error
          });
        }
      });
    };
    const sendJSON = (result) => {
      const code = result.code || API_DEFAULT_CODE;
      const headers = result.headers || API_DEFAULT_HEADERS;
      headers['Content-Type'] = 'application/json';
      res.writeHead(code, headers);
      try {
        res.write(JSON.stringify(result.json));
      } catch (error) {
        log({
          message: 'Error on result.json',
          event: LOG_EVENT_API_REQUEST_ERROR,
          error
        });
        return sendError(500, error);
      }
      res.end((error) => {
        if (error) {
          log({
            message: 'Error on result',
            event: LOG_EVENT_API_REQUEST_BODY_ERROR,
            error
          });
        }
      });
    };
    const sendError = (code, error) => {
      const json = error ? error : new Error('Empty error');
      if (!json.type) json.type = 'Error';
      sendJSON({ code, json });
    };

    const request = makeRoute(req);
    const route = getRoute(request.host, request.routePath);
    if (!route) return sendError(404, new Error('404 Not found'));

    makeRequest(req, request, (request) => {
      const onError = (error) => {
        let errorCode = 500;
        if (!(error instanceof Error)) {
          if (Object.isObject(error)) {
            if (error.code > 0) errorCode = error.code;
            error = new Error(error.message || error.error);
          } else {
            error = new Error(error);
          }
        }
        log({
          message: 'Route rejection',
          event: LOG_EVENT_API_REQUEST_REJECT,
          error
        });
        sendError(errorCode, error);
      };
      route(request)
        .then(result => corsUpdate(request, result))
        .then(result => result.json ? sendJSON(result) : sendResult(result))
        .catch(onError);
    });
  }

  return {
    addRoute,
    onRequest
  };
}

module.exports = Router;