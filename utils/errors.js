const HTTP_CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'not_allowed',
  408: 'request_timeout',
  409: 'conflict',
  429: 'too_many_requests',
  500: 'internal_server_error',
  501: 'not_implemented',
  503: 'service_unavailable',
  504: 'gateway_timeout',
  509: 'bandwidth_quota_exceeded'
};


class TimeoutError extends Error {
  constructor(error) {
    super('gateway_timeout');
    this.code = 504;
    this.reason = error.message;
    this.error = error;
  }
}

class HttpError extends Error {
  constructor(code = 500, reason, error) {
    super(reason ? Object.isString(reason) ? reason : reason.toString() : 'Handler rejection');
    this.code = +code;
    if (error) this.error = error;
  }
}

module.exports = {
  HTTP_CODES,
  TimeoutError,
  HttpError
};
