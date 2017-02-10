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

class BadReferrerError extends Error {
  constructor(message) {
    super(message || 'Referrer not valid');
    this.code = 500;
  }
}

module.exports = {
  NotFoundError,
  SendingError,
  TimeoutError,
  EmptyRequestError,
  BadReferrerError
};