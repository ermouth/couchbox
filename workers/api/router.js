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
} = require('../../constants/errors');

const {
  LOG_EVENT_API_REQUEST_ERROR,
  LOG_EVENT_API_REQUEST_REJECT,
  LOG_EVENT_API_SAVE,
} = require('../../constants/logEvents');

const {
  API_URL_ROOT,
  API_URL_PREFIX,
  API_DEFAULT_CODE,
  API_DEFAULT_HEADERS
} = require('./constants');

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
  const headers = API_DEFAULT_HEADERS;
  if (!(request && request.headers && request.headers.origin)) return Promise.resolve(headers);
  if (!CORS) return Promise.reject(new BadReferrerError());
  const rule = CORS_ORIGINS['*'] ? '*' : CORS_ORIGINS[request.headers.origin] ? request.headers.origin : null;
  if (!rule) return Promise.reject(new BadReferrerError());
  headers[H_CORS_ORIGIN] = rule;
  headers[H_CORS_HEADERS] = CORS_HEADES || '';
  headers[H_CORS_METHODS] = CORS_METHODS || '';
  headers[H_CORS_CRED] = CORS_CREDENTIALS;
  return Promise.resolve(headers);
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
          event: LOG_EVENT_API_REQUEST_ERROR,
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
    if (result.json) {
      headers['Content-Type'] = 'application/json';
      try {
        result.body = JSON.stringify(result.json);
      } catch (error) {
        log({
          message: 'Error on parse result',
          event: LOG_EVENT_API_REQUEST_ERROR,
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
          event: LOG_EVENT_API_REQUEST_ERROR,
          error
        });
        return sendResult(res, makeError(new SendingError(error)));
      }
    }
    res.end((error) => {
      if (error) {
        log({
          message: 'Error on send response',
          event: LOG_EVENT_API_REQUEST_ERROR,
          error
        });
      }
    });
  };

  function onRequest(req, res) {
    const send = result => sendResult(res, result);
    const sendError = error => sendResult(res, makeError(error));

    const request = makeRoute(req);
    const route = getRoute(request.host, request.routePath);
    if (!route) return sendError(new NotFoundError('not_found'));

    (request.method === 'OPTIONS'
      ? corsHeads(request).then(headers => ({ headers }))
      : makeRequest(req, request, route).then(request =>
        route.handler(request).then(result => {
          if (route.bucket && result.docs && result.docs.length) {
            return saveResults(route.bucket.getBucket(), result.docs).then(() => {
              log({
                message: 'Saved api results: "' + request.raw_path + '"',
                ref: request.raw_path,
                event: LOG_EVENT_API_SAVE
              });
              return result;
            });
          }
          return result;
        })
      )
    ).then(send).catch(error => {
      log({
        message: 'Route rejection',
        event: LOG_EVENT_API_REQUEST_REJECT,
        error
      });
      sendError(error);
    });
  }

  return { addRoute, onRequest };
}

module.exports = Router;