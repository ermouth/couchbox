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
    BUCKET_FEED: 'bucket/feed',
    BUCKET_FEED_STOP: 'bucket/feedStop',
    BUCKET_CHANGES: 'bucket/changes',
    BUCKET_STOP: 'bucket/stop',
    BUCKET_CLOSE: 'bucket/close',
    BUCKET_ERROR: 'bucket/error',
    BUCKET_DDOC_ERROR: 'bucket/ddocError',
    BUCKET_LAMBDA_ERROR: 'bucket/lambdaError',
    DDOC_INIT: 'ddoc/init',

    FILTER_ERROR: 'filter/error',

    CHANGE_ERROR: 'change/error',

    HOOK_START: 'hook/start',
    HOOK_END: 'hook/end',
    HOOK_RESULT: 'hook/result',
    HOOK_SKIP: 'hook/skip',
    HOOK_SAVE: 'hook/save',
    HOOK_LOG: 'hook/log',
    HOOK_ERROR: 'hook/error'
  }
};
