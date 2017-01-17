const config = require('./config');
const lib = require('./lib');
const Logger = require('./utils/log');
const couchdb = require('./couchdb');

require('sugar');


module.exports = function initMaster(cluster) {
  const logger = new Logger({ prefix: 'Master '+ process.pid });
  const log = logger.getLog();
  log('Started');

  // detect exit
  process.on('SIGINT', onClose);
  process.on('exit', () => { log('Closed'); });

  // send message to worker
  function sendMessage(pid, msg, data) {
    processes[pid].send({ msg, data });
  }


  let isClosing = false;
  let configUpdateTimeout;
  const processes = {};
  const dbs = {};
  const dbProcesses = {};
  const dbWorkers = {};
  const couchConfig = {
    hookTimeout: config.system.hookTimeout,
    hooks: {}
  };
  const workerConf = {
    hookTimeout: couchConfig.hookTimeout
  };

  function loadConfig() {
    couchdb.loadConfig().then(onConfig);
  }

  function onConfig(newConfig) {
    let needToUpdate = false;
    Object.keys(newConfig.hooks).forEach(dbKey => {
      if (couchConfig.hooks[dbKey] !== newConfig.hooks[dbKey]) needToUpdate = true;
    });
    if (newConfig.couchdb && newConfig.couchdb.os_process_timeout && +newConfig.couchdb.os_process_timeout !== couchConfig.hookTimeout) {
      needToUpdate = true;
    }
    if (needToUpdate) {
      log('Update hooks config');
      couchConfig.hooks = newConfig.hooks;
      couchConfig.hookTimeout = +newConfig.couchdb.os_process_timeout;
      if (workerConf.hookTimeout !== couchConfig.hookTimeout) {
        workerConf.hookTimeout = couchConfig.hookTimeout;
      }
      updateWorkers();
    }
    if (!isClosing) configUpdateTimeout = setTimeout(loadConfig, config.system.configTimeout);
  }

  function updateWorkers() {
    log('Update workers');
    const dbsTmp = {};
    Object.keys(couchConfig.hooks).forEach((dbdocKey) => {
      const dbdoc = dbdocKey.split(/\\/);
      const db = dbdoc[0];
      const ddoc = dbdoc[1];
      if (!dbsTmp[db]) dbsTmp[db] = { ddocs: {}, processes: [], process: null };
      dbsTmp[db].ddocs[ddoc] = couchConfig.hooks[dbdocKey];
    });

    Object.keys(dbs).forEach((db) => {
      if (!dbsTmp[db]) {
        stopFork(db);
        delete dbs[db];
      }
    });

    Object.keys(dbsTmp).forEach((db) => {
      const hash = lib.hash([workerConf, dbsTmp[db].ddocs]);
      dbsTmp[db].hash = hash;
      if (!dbs[db]) {
        dbs[db] = dbsTmp[db];
        startFork(db);
      } else if (dbs[db].hash !== hash) {
        stopFork(db);
        dbs[db] = dbsTmp[db];
        startFork(db);
      }
    });
  }

  function onForkExit(db, pid) {
    if (dbProcesses[db]) {
      dbProcesses[db] = dbProcesses[db].remove(pid);
      if (!dbProcesses[db].length) delete dbProcesses[db];
    }
    if (processes[pid]) delete processes[pid];
  }

  function startFork(db, seq) {
    if (isClosing) return null;
    if (!dbs[db]) return null;

    const ddocs = dbs[db].ddocs;
    if (!ddocs || !Object.keys(ddocs).length) return null;

    const workerProps = {
      forkType: 'db',
      db, ddocs, seq,
      conf: workerConf
    };

    const fork = cluster.fork({ workerProps: JSON.stringify(workerProps)});
    const { pid } = fork.process;
    let worker_seq;

    // Set process
    processes[pid] = fork;
    if (!dbProcesses[db]) dbProcesses[db] = [];
    dbProcesses[db].push(pid);

    fork.on('message', (message) => {
      const { msg } = message;
      switch (msg) {
        case 'init':
          worker_seq = message.data;
          setWorker();
          break;
        case 'stopFeed':
          startFork(db);
          break;
        case 'oldWorker':
          const oldWorkerSeq = message.data;
          if (checkWorker(oldWorkerSeq)) {
            log('Worker '+ oldWorkerSeq +' already started');
          } else {
            startFork(db, oldWorkerSeq);
          }
          break;
        default:
          break;
      }
    });

    fork.on('exit', () => {
      onForkExit(db, pid);
      if (dbWorkers[db]) {
        if (dbWorkers[db][worker_seq]) delete dbWorkers[db][worker_seq];
        if (!Object.keys(dbWorkers[db]).length) delete dbWorkers[db];
      }
    });

    const setWorker = () => {
      if (!worker_seq) return null;
      if (!dbWorkers.hasOwnProperty(db)) dbWorkers[db] = {};
      dbWorkers[db][worker_seq] = pid;
    };

    const checkWorker = (worker_seq) => dbWorkers.hasOwnProperty(db) && dbWorkers[db][worker_seq];
  }

  function stopFork(db) {
    dbProcesses[db].forEach(pid => {
      sendMessage(pid, 'close');
    });
  }

  function onClose() {
    log('Close');
    isClosing = true;
    clearTimeout(configUpdateTimeout);
    Object.keys(processes).forEach(pid => {
      sendMessage(pid, 'close');
    });
    const onLog = (error) => {
      logger.goOffline();
      if (error) log({ error });
    };
    logger.saveForced()
      .catch(onLog)
      .then(onLog);
  }

  loadConfig();
};
