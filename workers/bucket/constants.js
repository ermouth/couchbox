module.exports = {
  BUCKET_WORKER_TYPE_OLD: 0,
  BUCKET_WORKER_TYPE_ACTUAL: 1,

  BUCKET_DDOC_CONTEXT_DENY: {
    'language': true,
    'filters': true,
    'hooks': true,
    'api': true
  },

  CHECK_PROCESSES_TIMEOUT: 120,
  CHANGE_DOC_ID: 0,
  CHANGE_DOC_REV: 1,
  CHANGE_DOC_HOOKS: 1,

  LOG_EVENTS: {
    BUCKET_FEED: 'bucket/feed',
    BUCKET_FEED_STOP: 'bucket/feedStop',
    BUCKET_CHANGES: 'bucket/changes',
    BUCKET_STOP: 'bucket/stop',
    BUCKET_CLOSE: 'bucket/close',
    BUCKET_ERROR: 'bucket/error',

    DDOC_INIT: 'ddoc/init',
    DDOC_ERROR: 'ddoc/error',

    FILTER_ERROR: 'filter/error',

    HOOK_START: 'hook/start',
    HOOK_RESULT: 'hook/result',
    HOOK_SAVE: 'hook/save',
    HOOK_LOG: 'hook/log',
    HOOK_ERROR: 'hook/error',
  }
};
