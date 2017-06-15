

class LocaleError extends Error {
  constructor(message, error) {
    const locales = {};

    if (Object.isString(message)) {
      const locale = message.split(' ', 1)[0];
      if (LocaleError.checkLocale(locale)) {
        locales[locale] = message.substr(locale.length + 1);
      }
    } else if (Object.isObject(message)) {
      Object.keys(message).forEach(locale => {
        if (LocaleError.checkLocale(locale)) locales[locale] = message[locale];
      });
    } else if (message instanceof LocaleError) {
      return message;
    } else if (message instanceof Error) {
      if (!error) error = message;
      locales['EN'] = error.message;
    }

    if (Object.keys(locales).length === 0) {
      locales['EN'] = 'Bad Error';
    }

    super(locales['EN'] || locales[Object.keys(locales)[0]]);
    this.locales = locales;
    if (error) this.error = error;
  }

  toString(locale = 'EN') {
    if (locale in this.locales) {
      switch (locale) {
        case 'RU': return 'Ошибка "'+ this.locales[locale] +'"';
        case 'EN': return 'Error "'+ this.locales[locale] +'"';
      }
    }
    return 'Error "'+ this.message +'"';
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
  constructor(code = 400, reason, error) {
    if (Object.isString(reason)) reason = { EN: reason };
    if (!reason || !Object.isObject(reason)) reason = { EN: CODES[code] || 'Bad request' };
    super(reason);
    this.code = code;
    if (error) this.error = error;
  }
}


module.exports = {
  LocaleError,
  TimeoutError,
  RejectHandlerError,
  HttpError
};