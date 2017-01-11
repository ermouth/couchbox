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
  process.on('exit', () => { log('Close'); });

  // send message to worker
  function sendMessage(pid, msg, data) {
    processes[pid].send({ msg, data });
  }


  let isClosing = false;
  let configUpdateTimeout;
  const processes = {};
  const dbs = {};
  const dbProcesses = {};
  const couchConfig = {
    hookTimeout: config.system.hookTimeout,
    hooks: {}
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
      updateWorkers();
    }
    if (!isClosing) configUpdateTimeout = setTimeout(() => { loadConfig(); }, config.system.cofigUpdateTimeout);
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
      const hash = lib.hash(dbsTmp[db].ddocs);
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


  function onForkEnd(db, pid, data) {
    startFork(db);
  }
  function onForkExit(db, pid) {
    if (dbProcesses[db]) {
      dbProcesses[db] = dbProcesses[db].remove(pid);
      if (!dbProcesses[db].length) delete dbProcesses[db];
    }
    if (processes[pid]) delete processes[pid];
  }


  function startFork(db) {
    if (isClosing) return null;
    if (!dbs[db]) return null;

    const ddocs = dbs[db].ddocs;
    const hash = dbs[db].hash;
    if (!ddocs || !Object.keys(ddocs).length) return null;

    const fork = cluster.fork({ workerProps: JSON.stringify({
      forkType: 'db',
      db, ddocs,
      conf: {
        hookTimeout: couchConfig.hookTimeout
      }
    })});

    const { pid } = fork.process;
    processes[pid] = fork;
    if (!dbProcesses[db]) dbProcesses[db] = [];
    dbProcesses[db].push(pid);

    fork.on('message', (message) => {
      const { msg, data } = message;
      switch (msg) {
        case 'end':
          onForkEnd(db, pid, data);
          break;
        case 'close':
          break;
        case 'process':
          break;
        default:
          break;
      }
    });

    fork.on('exit', () => {
      onForkExit(db, pid);
    });
  }

  function stopFork(db) {
    dbProcesses[db].forEach(pid => {
      sendMessage(pid, 'close');
    });
  }

  function onClose() {
    isClosing = true;
    clearTimeout(configUpdateTimeout);
    Object.keys(processes).forEach(pid => {
      sendMessage(pid, 'close');
    });
  }

  loadConfig();
};
