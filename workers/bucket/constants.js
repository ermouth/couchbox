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

  LOG_EVENTS: {
    BUILD_ERROR: 'build/error',

    BUCKET_FEED: 'bucket/feed',
    BUCKET_FEED_STOP: 'bucket/feedStop',
    BUCKET_CHANGES: 'bucket/changes',
    BUCKET_STOP: 'bucket/stop',
    BUCKET_CLOSE: 'bucket/close',
    BUCKET_ERROR: 'bucket/error',

    DDOC_INIT: 'ddoc/init',

    FILTER_ERROR: 'filter/error',

    CHANGE_ERROR: 'change/error',

    HOOK_START: 'hook/start',
    HOOK_RESULT: 'hook/result',
    HOOK_SKIP: 'hook/skip',
    HOOK_SAVE: 'hook/save',
    HOOK_LOG: 'hook/log',
    HOOK_ERROR: 'hook/error'
  }
};
