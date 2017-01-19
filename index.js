const cluster = require('cluster');

if (cluster.isMaster) {
  // init master
  require('./master')(cluster);
} else {

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
      case 'db':
        require('./workerDB')(cluster, workerProps);
        break;
      default:
        process.exit();
    }
  } else {
    throw new Error('No worker props');
  }
}
