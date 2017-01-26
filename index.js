const cluster = require('cluster');

if (cluster.isMaster) {
  // init master
  require('./master')(cluster);
} else {
  const { WORKER_TYPE_BUCKET, WORKER_TYPE_API, WORKER_TYPE_SOCKET } = require('./constants/worker');
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
        require('./workerBucket')(cluster, workerProps);
        break;
      case WORKER_TYPE_SOCKET:
        require('./workerSocket')(cluster, workerProps);
        break;
      case WORKER_TYPE_API:
        require('./workerApi')(cluster, workerProps);
        break;
      default:
        process.exit();
    }
  } else {
    throw new Error('No worker props');
  }
}
