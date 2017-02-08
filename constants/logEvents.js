module.exports = {
  LOG_EVENT_LOG_ERROR: 'log/error',

  LOG_EVENT_SANDBOX_START: 'sandbox/start',
  LOG_EVENT_SANDBOX_CONFIG_BUCKET: 'sandbox/configBucket',
  LOG_EVENT_SANDBOX_CONFIG_HOOKS: 'sandbox/configHooks',
  LOG_EVENT_SANDBOX_CONFIG_API: 'sandbox/configApi',
  LOG_EVENT_SANDBOX_CONFIG_ENDPOINTS: 'sandbox/configEndpoints',
  LOG_EVENT_SANDBOX_CONFIG_SOCKET: 'sandbox/configSocket',
  LOG_EVENT_SANDBOX_CLOSE: 'sandbox/close',
  LOG_EVENT_SANDBOX_CLOSED: 'sandbox/closed',

  LOG_EVENT_WORKER_START: 'worker/start',
  LOG_EVENT_WORKER_CLOSE: 'worker/close',
  LOG_EVENT_WORKER_CLOSED: 'worker/closed',
  LOG_EVENT_WORKER_EXIT: 'worker/exit',
  LOG_EVENT_WORKER_ERROR: 'worker/error',

  LOG_EVENT_SOCKET_START: 'socket/start',
  LOG_EVENT_SOCKET_STOP: 'socket/stop',
  LOG_EVENT_SOCKET_ERROR: 'socket/error',

  LOG_EVENT_API_START: 'api/start',
  LOG_EVENT_API_STOP: 'api/stop',
  LOG_EVENT_API_ERROR: 'api/error',
  LOG_EVENT_API_SAVE: 'api/save',
  LOG_EVENT_API_SESSION_ERROR: 'api/sessionError',
  LOG_EVENT_API_REQUEST_ERROR: 'api/requestError',
  LOG_EVENT_API_REQUEST_REJECT: 'api/requestReject',
  LOG_EVENT_API_HANDLER_LOG: 'api/handlerLog',
  LOG_EVENT_API_HANDLER_ERROR: 'api/handlerError',
  LOG_EVENT_API_ROUTE_ERROR: 'api/routeError',

  LOG_EVENT_BUCKET_FEED: 'bucket/feed',
  LOG_EVENT_BUCKET_FEED_STOP: 'bucket/feedStop',
  LOG_EVENT_BUCKET_CHANGES: 'bucket/changes',
  LOG_EVENT_BUCKET_DDOC_STOP: 'bucket/ddocStop',
  LOG_EVENT_BUCKET_CLOSE: 'bucket/close',
  LOG_EVENT_BUCKET_ERROR: 'bucket/error',

  LOG_EVENT_DDOC_INIT: 'ddoc/init',
  LOG_EVENT_DDOC_ERROR: 'ddoc/error',

  LOG_EVENT_FILTER_ERROR: 'filter/error',

  LOG_EVENT_HOOK_START: 'hook/start',
  LOG_EVENT_HOOK_RESULT: 'hook/result',
  LOG_EVENT_HOOK_SAVE: 'hook/save',
  LOG_EVENT_HOOK_LOG: 'hook/message',
  LOG_EVENT_HOOK_ERROR: 'hook/error',

  LOG_EVENT_TASK_SMS: 'task/sms',
  LOG_EVENT_TASK_SMS_ERROR: 'task/smsError',
};