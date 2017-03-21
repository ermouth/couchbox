const cluster = require('cluster');

if (cluster.isMaster) {
  // init master
  require('./workers/sandbox')(cluster);
} else {
  const { Constants: {
    WORKER_TYPE_BUCKET, WORKER_TYPE_API, WORKER_TYPE_SOCKET, WORKER_TYPE_PROXY, WORKER_TYPE_REDIS_COMMANDER
  } } = require('./utils/worker');
  // init props
  let workerProps;
  try {
    workerProps = JSON.parse(process.env.workerProps);
  } catch(e) {
    throw new Error('Error parse worker props');
  }

  // init worker
  if (workerProps) {
    switch (workerProps.forkType) {
      case WORKER_TYPE_BUCKET:
        return require('./workers/bucket')(cluster, workerProps);
      case WORKER_TYPE_SOCKET:
        return require('./workers/socket')(cluster, workerProps);
      case WORKER_TYPE_API:
        return require('./workers/api')(cluster, workerProps);
      case WORKER_TYPE_PROXY:
        return require('./workers/proxy')(cluster, workerProps);
      case WORKER_TYPE_REDIS_COMMANDER:
        return require('./workers/redis-commander')(cluster, workerProps);
      default:
        process.exit();
    }
  } else {
    throw new Error('No worker props');
  }
}
