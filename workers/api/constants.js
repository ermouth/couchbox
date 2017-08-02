const config = require('../../config');

const NODE_NAME = config.get('couchbox.nodename');

const API_FALLBACK_URL = Object.isString(config.get('api.fallback')) ? config.get('api.fallback') : undefined;
const SESSION_TTL = config.get('user.session') * 1e3; // to ms

const CORS = config.get('cors.enabled') === true;
const CORS_CREDENTIALS = config.get('cors.credentials') === true;
const CORS_ORIGINS = {}; config.get('cors.origins').forEach(host => host && (CORS_ORIGINS[host] = true));
const CORS_METHODS = config.get('cors.methods').join(', ');
const CORS_HEADES = config.get('cors.headers').join(', ');

const API_REFERRER_PARSER = (req) => (
  (req && Object.isString(req.peer) && req.peer.length > 0
    ? req.peer
    : '_'
  ) +

  ' ' +

  (req && Object.isObject(req.userCtx) && 'name' in req.userCtx && Object.isString(req.userCtx.name) && req.userCtx.name.length > 0
    ? req.userCtx.name
    : '_'
  ) +

  ' ' +

  (req && Object.isObject(req.headers) && 'user-agent' in req.headers && Object.isString(req.headers['user-agent']) && req.headers['user-agent'].length > 0
    ? req.headers['user-agent']
    : '_'
  )
);

function API_LOG_PARSER(req) {
  return {
    ref: API_REFERRER_PARSER(req),
    url: req && req.raw_path ? req.raw_path.substr(0,200) : null
  };
}

module.exports = {
  NODE_NAME,

  SESSION_TTL,

  CORS,
  CORS_CREDENTIALS,
  CORS_ORIGINS,
  CORS_METHODS,
  CORS_HEADES,

  API_URL_ROOT: '/',
  API_DEFAULT_LOCALE: 'en-US,en;q=0.8',
  API_DEFAULT_TIMEOUT: 10e3,
  API_DEFAULT_CODE: 200,
  API_DEFAULT_HEADERS: { 'Content-Type': 'text/plain' },
  API_DEFAULT_METHODS: ['GET','POST'],
  API_AVAILABLE_METHODS: {
    GET: true,
    POST: true,
    HEAD: true,
    PUT: true,
    DELETE: true
  },
  API_LOG_PARSER,
  API_REFERRER_PARSER,
  API_FALLBACK_URL,

  LOG_EVENTS: {
    BUILD_ERROR: 'build/error',

    BUCKET_ERROR: 'bucket/error',

    DDOC_INIT: 'ddoc/init',

    API_START: 'api/start',
    API_STOP: 'api/stop',
    API_ERROR: 'api/error',
    API_SAVE: 'api/save',
    API_SESSION_ERROR: 'api/sessionError',
    API_REQUEST_ERROR: 'api/requestError',
    API_DDOC_ERROR: 'api/ddocError',
    API_LAMBDA_ERROR: 'api/lambdaError',
    API_REQUEST_REJECT: 'api/requestReject',
    API_ROUTE_ERROR: 'api/routeError',
    API_LOG: 'api/log',
  }
};
