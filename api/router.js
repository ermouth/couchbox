require('sugar');
const Promise = require('bluebird');
const cookieParser = require('cookie');
const queryString = require('query-string');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const config = require('../config');

const {
  LOG_EVENT_API_REQUEST_ERROR,
  LOG_EVENT_API_REQUEST_REJECT,
  LOG_EVENT_API_REQUEST_BODY_ERROR,
  LOG_EVENT_API_SESSION_ERROR
} = require('../constants/logEvents');

const {
  API_URL_ROOT,
  API_URL_PREFIX,
  API_DEFAULT_CODE,
  API_DEFAULT_HEADERS
} = require('../constants/api');

const CORS = config.get('cors.enabled') === true;
const CORS_CREDENTIALS = config.get('cors.credentials') === true;
const CORS_ORIGINS = {}; config.get('cors.origins').forEach(host => host && (CORS_ORIGINS[host] = true));
const CORS_METHODS = config.get('cors.methods').join(', ');
const CORS_HEADES = config.get('cors.headers').join(', ');

const H_CORS_ORIGIN = 'Access-Control-Allow-Origin';
const H_CORS_HEADERS = 'Access-Control-Allow-Headers';
const H_CORS_METHODS = 'Access-Control-Allow-Methods';
const H_CORS_CRED = 'Access-Control-Allow-Credentials';

const corsHeads = (request, result) => {
  if (!(request && request.headers && request.headers.origin && result && CORS)) return result;
  if (!result.headers) result.headers = API_DEFAULT_HEADERS;
  const { origin } = request.headers;
  const rule = CORS_ORIGINS['*'] ? '*' : CORS_ORIGINS[origin] ? origin : null;
  if (rule) {
    if (!result.headers[H_CORS_ORIGIN]) result.headers[H_CORS_ORIGIN] = rule;
    if (!result.headers[H_CORS_HEADERS]) result.headers[H_CORS_HEADERS] = CORS_HEADES || '';
    if (!result.headers[H_CORS_METHODS]) result.headers[H_CORS_METHODS] = CORS_METHODS || '';
    if (!result.headers[H_CORS_CRED]) result.headers[H_CORS_CRED] = CORS_CREDENTIALS;
  }
  return result;
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

  const routePath = '/' + path.slice(0,2).join('/');

  return { host, port, method, raw_path, query, path, routePath, headers, peer };
};

function Router(props = {}) {
  const { sessions } = props;
  const logger = new Logger({ prefix: 'Router', logger: props.logger });
  const log = logger.getLog();

  const routes = new Map();

  function addRoute(domain, endpoint, path, handler, bucket) {
    if (!domain) throw new Error('Empty domain');
    if (!endpoint) throw new Error('Empty endpoint');
    if (endpoint[0] !== API_URL_PREFIX) throw new Error('Bad endpoint: ' + endpoint);
    if (!path) throw new Error('Empty path');
    if (!handler) throw new Error('Empty handler');
    if (!(endpoint && endpoint.length >= 1 && path && path.length >= 1 && path[0] !== '/')) throw new Error('Bad route');

    const routeKey = domain + API_URL_ROOT + endpoint + (endpoint === API_URL_PREFIX ? '' : '/')+ path;
    routes.set(routeKey, { handler, bucket });
  }

  const getRoute = (host, routePath) => routes.get(host + routePath) || routes.get('*' + routePath);

  const makeRequest = (req, request, route, callback) => {
    request.cookie = cookieParser.parse(request.headers.cookie || '');
    if (route.bucket) request.info = { update_seq: route.bucket.getSeq() };
    let i = 2;
    const done = () => (!--i) && callback(request);
    sessions.loadSession(request)
      .then(userCtx => { request.userCtx = userCtx; })
      .catch(error => {
        log({
          message: 'Error on load session',
          event: LOG_EVENT_API_SESSION_ERROR,
          error
        });
      })
      .finally(done);
    parseBody(req)
      .then(body => { request.body = body; })
      .catch(error => {
        log({
          message: 'Error on parse body',
          event: LOG_EVENT_API_REQUEST_ERROR,
          error
        });
      })
      .finally(done);
  };

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
            message: 'Error on send result',
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
      if (code === 404) {
        res.writeHead(code, API_DEFAULT_HEADERS);
        res.write(error.toString());
        res.end((sendError) => {
          if (sendError) {
            log({
              message: 'Error on send error',
              event: LOG_EVENT_API_REQUEST_ERROR,
              error: sendError
            });
          }
        });
        return null;
      }
      const json = error ? error : new Error('Empty error');
      if (!json.type) json.type = 'Error';
      sendJSON({ code, json });
    };

    const request = makeRoute(req);
    const route = getRoute(request.host, request.routePath);
    if (!route) return sendError(404, new Error('404 Not found'));

    makeRequest(req, request, route, (request) => {
      route.handler(request)
        .then(result => corsHeads(request, result))
        .then(result => result.json ? sendJSON(result) : sendResult(result))
        .catch((error) => {
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
        });
    });
  }

  return { addRoute, onRequest };
}

module.exports = Router;