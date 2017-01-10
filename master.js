const config = require('./config');
const lib = require('./lib');
const Logger = require('./utils/log');
const couchdb = require('./couchdb');

require('sugar');

module.exports = function initMaster(cluster) {
  const logger = new Logger({
    prefix: 'Master '+ process.pid
  });
  const log = logger.getLog();

  log('started');


  // detect exit
  process.on('SIGINT', onClose);
  process.on('exit', () => {
    log('close');
  });

  let isClosing = false;
  const processes = {};
  const dbs = {};
  let hooksConfig = {};

  function getConfig() {
    couchdb.auth()
      .then(() => {
        return couchdb.loadConfig().then(onConfig);
      })
      .catch(error => {
        log({ error });
      });
  }

  function onConfig(newConfig) {
    let needToUpdate = false;
    Object.keys(newConfig.hooks).forEach(dbKey => {
      if(hooksConfig[dbKey] !== newConfig.hooks[dbKey]) needToUpdate = true;
    });
    if (!needToUpdate) return null;
    log('Update hooks config');
    hooksConfig = newConfig.hooks;
    updateWorkers();
  };

  function updateWorkers() {
    log('Update hooks config');
    Object.keys(hooksConfig).forEach((dbdocKey) => {
      const dbdoc = dbdocKey.split(/\\/);
      const db = dbdoc[0];
      const ddoc = dbdoc[1];
      if (!dbs[db]) dbs[db] = { ddocs: {}, processes: [] };
      dbs[db].ddocs[ddoc] = hooksConfig[dbdocKey].split(/s+/);
    });

    Object.keys(dbs).forEach(db => {
      startFork(db, dbs[db].ddocs);
    });
  }

  function startFork(db, ddocs, since = 'now') {
    if (isClosing) return null;
    const fork = cluster.fork({ workerProps: JSON.stringify({ forkType: 'db', db, ddocs, since })});
    const { pid } = fork.process;
    processes[pid] = fork;
    dbs[db].processes.push(pid);
    fork.on('message', (message) => {
      const { msg, data } = message;
      switch (msg) {
        case 'closing':
          startFork(db, data && data.seq > 0 ? data.seq : 'now');
          break;
        case 'close':
          break;
        default:
          break;
      }
    });
    fork.on('exit', () => {
      stopFork(db, pid);
    });
  }

  function stopFork(db, pid) {
    if (!dbs[db]) return null;
    dbs[db].processes = dbs[db].processes.remove(pid);
    delete processes[pid];
  }

  function onClose() {
    isClosing = true;
    Object.keys(processes).forEach(pid => {
      processes[pid].send('close');
    });
  }

  getConfig();
};
