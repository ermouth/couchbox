require('sugar');
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

function Router(props = {}) {
  const logger = new Logger({ prefix: 'Router', logger: props.logger });
  const log = logger.getLog();

  const routes = new Map();

  function Route(domain, endpoint, path, route, handler) {
    return (req, res) => handler(req, res);
  }

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
    routes.set(routeKey, new Route(domain, endpoint, path, route, handler));
  }

  const getRoute = (meta) => routes.get(meta.host + meta.path) || routes.get('*' + meta.path);

  function onRequest(req, res) {
    const hostFull = (req.headers[config.get('api.hostKey')] || req.headers.host).split(':');
    const host = hostFull[0];
    const port = hostFull[1] || 80;
    const url = req.url;

    const queryIndex = url.indexOf('?');
    const path = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    const query = url.substring(queryIndex + 1);

    req.meta = { host, port, url, path, query };

    const sendError = (code, error) => {
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      res.write(error.toString());
      res.end();
    };
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
      if (Object.isObject(result.json)) {
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
      } else {
        const error = new Error('Bad JSON');
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

    const route = getRoute(req.meta);
    if (route) {
      route(req)
        .then(result => result.json ? sendJSON(result) : sendResult(result))
        .catch(error => {
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
          sendError(errorCode, error)
        });
    } else {
      sendError(404, new Error('404 Not found'));
    }
  }

  return {
    addRoute,
    onRequest
  };
}

module.exports = Router;