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

class SendingError extends Error {
  constructor(error) {
    super('Error on send result');
    this.code = 500;
    this.reason = error.message;
    this.error = error;
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

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.code = 404;
    this.reason = 'missing'
  }
}

class EmptyRequestError extends Error {
  constructor(message) {
    super(message || 'Empty request');
    this.code = 500;
  }
}

class BadRequestError extends Error {
  constructor(error) {
    const message = 'Bad request' + (error && error.message ? ': "'+ error.message +'"' : '');
    super(message);
    this.code = 500;
    this.reason = message;
    if (error) this.error = error;
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

class BadReferrerError extends Error {
  constructor(message) {
    super(message || 'Referrer not valid');
    this.code = 500;
  }
}

module.exports = {
  LocaleError,
  NotFoundError,
  SendingError,
  TimeoutError,
  EmptyRequestError,
  BadRequestError,
  BadReferrerError,
  RejectHandlerError
};