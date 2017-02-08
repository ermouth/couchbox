require('sugar');
const Promise = require('bluebird');
const cookieParser = require('cookie');
const queryString = require('query-string');
const lib = require('../utils/lib');
const saveResults = require('../utils/resultsSaver');
const Logger = require('../utils/logger');
const config = require('../config');

const {
  LOG_EVENT_API_REQUEST_ERROR,
  LOG_EVENT_API_REQUEST_REJECT,
  LOG_EVENT_API_REQUEST_BODY_ERROR,
  LOG_EVENT_API_SAVE,
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

const corsHeads = (request) => {
  const heads = API_DEFAULT_HEADERS;
  if (!(request && request.headers && request.headers.origin)) return Promise.resolve(heads);
  if (!CORS) return Promise.reject(new Error('Referrer not valid'));
  const rule = CORS_ORIGINS['*'] ? '*' : CORS_ORIGINS[request.headers.origin] ? request.headers.origin : null;
  if (!rule) return Promise.reject(new Error('Referrer not valid'));
  heads[H_CORS_ORIGIN] = rule;
  heads[H_CORS_HEADERS] = CORS_HEADES || '';
  heads[H_CORS_METHODS] = CORS_METHODS || '';
  heads[H_CORS_CRED] = CORS_CREDENTIALS;
  return Promise.resolve(heads);
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

  const getRoute = (host, routePath) => routes.get(host + routePath) || routes.get('*' + routePath);

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

  const makeRequest = (req, request, route, callback) => new Promise((resolve, reject) => {
    request.cookie = cookieParser.parse(request.headers.cookie || '');
    if (route.bucket) request.info = { update_seq: route.bucket.getSeq() };
    corsHeads(request).then(heads => Promise.all([
        sessions.loadSession(request).then(userCtx => { request.userCtx = userCtx; }),
        parseBody(req).then(body => { request.body = body; })
          .catch(error => {
            log({
              message: 'Error on parse body',
              event: LOG_EVENT_API_REQUEST_ERROR,
              error
            });
          })
      ]).then(() => resolve({ request, heads }))
    ).catch(reject)
  });

  function onRequest(req, res) {
    const sendResponse = (result) => result.json ? sendJSON(result) : sendResult(result);
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

    makeRequest(req, request, route).then(({ request, heads }) =>
      route.handler(request)
        .then(result => {
          result.headers = Object.assign(heads, result.headers || {});
          if (route.bucket && result.docs && result.docs.length) {
            return saveResults(route.bucket.getBucket(), result.docs).then(() => {
              log({
                message: 'Saved api results: "'+ request.raw_path +'"',
                ref: request.raw_path,
                event: LOG_EVENT_API_SAVE
              });
              return result;
            });
          }
          return result;
        })
        .then(sendResponse)
    ).catch((error) => {
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
  }

  return { addRoute, onRequest };
}

module.exports = Router;