// if (!('toJSON' in Error.prototype)) {
//   Object.defineProperty(Error.prototype, 'toJSON', {
//     value: function () {
//       const json = {};
//
//       Object.getOwnPropertyNames(this).forEach(function (key) {
//
//         if (key === 'error') {
//           if (Object.isFunction(this.error.toJSON)) json.error = this.error.toJSON();
//           json.error = this.error.toString();
//         } else {
//           json[key] = this[key];
//         }
//
//       }, this);
//
//       return json;
//     },
//     configurable: true,
//     writable: true
//   });
// }

class LocaleError extends Error {
  constructor(message, error, ext) {
    let locales = {};

    // String
    if (Object.isString(message)) {
      locales['EN'] = message;

    // Object
    } else if (Object.isObject(message)) {
      Object.keys(message).forEach(locale => {
        if (LocaleError.checkLocale(locale)) locales[locale] = message[locale];
      });

    // LocaleError
    } else if (message instanceof LocaleError) {
      locales = message.locales;

    // Error
    } else if (message instanceof Error) {
      if (!error) error = message;
      locales['EN'] = error.message;
    }

    // locales
    if (Object.keys(locales).length === 0) {
      locales['EN'] = 'Error';
    }

    // super
    super(locales['EN'] || locales[Object.keys(locales)[0]]);
    const self = this;

    // extend
    if (ext && Object.isObject(ext)) {
      Object.keys(ext).forEach(key => {
        if (key !== 'message' && key !== 'error' && key !== 'locales') self[key] = ext[key];
      });
    }

    // self props
    self.locales = locales;
    if (error) self.error = error;
  }

  toString(locale = 'EN') {
    if (locale in this.locales) {
      switch (locale) {
        case 'RU': return this.locales[locale];
        case 'EN': return this.locales[locale];
      }
    }
    return this.message;
  }

  static checkLocale(locale) {
    return Object.isString(locale) && locale.length >= 2 && locale.length <= 3;
  }
}

class TimeoutError extends Error {
  constructor(error) {
    super('gateway_timeout');
    this.code = 504;
    this.reason = error.message;
    this.error = error;
  }
}

class RejectHandlerError extends Error {
  constructor(error) {
    const message = 'Reject handler execution' + (error && error.message ? ': '+ error.message : '');
    super(message);
    this.code = 500;
    this.reason = message;
    if (error) this.error = error;
  }
}


// HttpError

const CODES = {
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

class HttpError extends LocaleError {
  constructor(code = 400, reason, error, ext) {
    if (Object.isString(reason)) reason = { EN: reason };
    if (!reason || !Object.isObject(reason)) reason = { EN: CODES[code] || 'Bad request' };
    super(reason, error, ext);
    this.code = code;
  }
}


module.exports = {
  LocaleError,
  TimeoutError,
  RejectHandlerError,
  HttpError
};