module.exports = {
  // Old and bad splitter
  // COUCHDB_KEY_SPLITTER: /!|\\|\|/,

  COUCHDB_KEY_SPLITTER: '!',

  LOG_EVENTS: {
    SANDBOX_START: 'sandbox/start',
    SANDBOX_CLOSE: 'sandbox/close',
    SANDBOX_CLOSED: 'sandbox/closed',

    SANDBOX_ERROR: 'sandbox/error',
    SANDBOX_CONFIG_ERROR: 'config/error',
  }
};
