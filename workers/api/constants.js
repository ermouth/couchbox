const config = require('../../config');

const NODE_NAME = config.get('couchbox.nodename');

const SESSION_TTL = config.get('user.session') * 1e3; // to ms

const CORS = config.get('cors.enabled') === true;
const CORS_CREDENTIALS = config.get('cors.credentials') === true;
const CORS_ORIGINS = {}; config.get('cors.origins').forEach(host => host && (CORS_ORIGINS[host] = true));
const CORS_METHODS = config.get('cors.methods').join(', ');
const CORS_HEADES = config.get('cors.headers').join(', ');

module.exports = {
  NODE_NAME,

  SESSION_TTL,

  CORS,
  CORS_CREDENTIALS,
  CORS_ORIGINS,
  CORS_METHODS,
  CORS_HEADES,

  API_URL_ROOT: '/',
  API_URL_PREFIX: '_',
  API_DEFAULT_TIMEOUT: 10e3,
  API_DEFAULT_CODE: 200,
  API_DEFAULT_HEADERS: { 'Content-Type': 'text/plain' },

  LOG_EVENTS: {
    BUCKET_ERROR: 'bucket/error',

    DDOC_INIT: 'ddoc/init',
    DDOC_ERROR: 'ddoc/error',

    API_START: 'api/start',
    API_STOP: 'api/stop',
    API_ERROR: 'api/error',
    API_SAVE: 'api/save',
    API_SESSION_ERROR: 'api/sessionError',
    API_REQUEST_ERROR: 'api/requestError',
    API_REQUEST_REJECT: 'api/requestReject',
    API_HANDLER_LOG: 'api/handlerLog',
    API_HANDLER_ERROR: 'api/handlerError',
    API_ROUTE_ERROR: 'api/routeError',
    API_LOG: 'api/log',
  }
};
