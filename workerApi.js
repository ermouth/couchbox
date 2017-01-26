const Worker = require('./models/worker');

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster);
  const { logger } = worker;
  const log = logger.getLog();
};