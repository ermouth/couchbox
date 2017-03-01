const cluster = require('cluster');

if (cluster.isMaster) {
  // init master
  require('./workers/sandbox')(cluster);
} else {
  const { Constants: { WORKER_TYPE_BUCKET, WORKER_TYPE_API, WORKER_TYPE_SOCKET, WORKER_TYPE_PROXY } } = require('./utils/worker');
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
        require('./workers/bucket')(cluster, workerProps);
        break;
      case WORKER_TYPE_SOCKET:
        require('./workers/socket')(cluster, workerProps);
        break;
      case WORKER_TYPE_API:
        require('./workers/api')(cluster, workerProps);
        break;
      case WORKER_TYPE_PROXY:
        require('./workers/proxy')(cluster, workerProps);
        break;
      default:
        process.exit();
    }
  } else {
    throw new Error('No worker props');
  }
}
