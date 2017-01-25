require('sugar');
const lib = require('./lib');
const Logger = require('./utils/log');
const couchdb = require('./couchdb');
const config = require('./config');


const WORKER_TYPE_ACTUAL = 'actual';
const WORKER_TYPE_OLD = 'old';

// Master worker
module.exports = function initMaster(cluster) {
  const logger = new Logger({ prefix: 'Master '+ process.pid });
  const log = logger.getLog();
  log({ message: 'Started', event: 'sandbox/start' });

  const sendMessage = (pid, msg, data) => workers.has(pid) && workers.get(pid).fork.send({ msg, data });

  const workers = new Map(); // map of current workers
  const dbs = new Map(); // map of current dbs params

  let hooksConfig = {};
  let isClosing = false;
  let configUpdateTimeout;

  const configMap = {
    'couchbox': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;
      const { nodename } = conf;
      if (nodename && nodename.length > 0 && config.get('couchbox.nodename') !== nodename) {
        needToUpdate = true;
        config.set('couchbox.nodename', nodename);
      }
      return needToUpdate;
    },
    'hooks': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;
      Object.keys(conf).forEach(dbKey => {
        if (!needToUpdate && hooksConfig[dbKey] !== conf[dbKey]) needToUpdate = true;
      });
      if (needToUpdate) hooksConfig = conf;
      return needToUpdate;
    },
    'couchdb': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;

      const processTimeout = +conf.os_process_timeout;
      if (processTimeout && processTimeout > 0 && config.get('hooks.timeout') !== processTimeout) {
        needToUpdate = true;
        config.set('hooks.timeout', processTimeout);
      }

      return needToUpdate;
    },
    'couch_httpd_auth':  (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;

      if (config.get('couchdb.secret') !== conf.secret) {
        needToUpdate = true;
        config.set('couchdb.secret', conf.secret);
      }

      return needToUpdate;
    }
  }; // map for couchdb config
  let configHash; // hash of config

  function loadConfig() {
    couchdb.loadConfig().then(newConf => {
      if (isClosing) return null;
      let needToUpdate = false;
      Object.keys(newConf).forEach(confKey => {
        needToUpdate = configMap[confKey] && configMap[confKey](newConf[confKey]) || needToUpdate;
      });
      if (needToUpdate) { // if one or more from changes updated
        log({ message: 'Updated hooks config', event: 'sandbox/configUpdate' });
        configHash = lib.hash(['couchbox', 'couchdb', 'hooks', 'redis'].map(cfg => config.get(cfg))); // update configHash by critical fields
        updateWorkers(); // start update workers
      }
      if (!isClosing) configUpdateTimeout = setTimeout(loadConfig, config.get('system.configTimeout')); // start timeout on next config update if worker is running
    });
  } // load and process couchdb config
  function updateWorkers() {
    const dbsTmp = {};
    const dbs_keys = [];

    Object.keys(hooksConfig).forEach((dbdocKey) => {
      const dbdoc = dbdocKey.split(/\\/);
      const db = dbdoc[0];
      const ddoc = dbdoc[1];
      if (!dbsTmp[db]) dbsTmp[db] = { ddocs: {}, configHash };
      dbsTmp[db].ddocs[ddoc] = hooksConfig[dbdocKey];
    }); // make temp dbs

    Object.keys(dbsTmp).forEach(db_key => {
      const db_ddocs = dbsTmp[db_key] && dbsTmp[db_key].ddocs ? dbsTmp[db_key].ddocs : null;
      if (db_ddocs && Object.keys(db_ddocs).length) {
        dbsTmp[db_key].ddocsHash = lib.hash(db_ddocs); // set hash of ddocs config
        dbs_keys.push(db_key);
      }
      else dbsTmp[db_key] = null;
    });
    for (let db_key of dbs.keys()) if (!dbsTmp[db_key]) dbs_keys.push(db_key);

    dbs_keys.forEach(db_key => {
      const oldDB = dbs.get(db_key);
      const newDB = dbsTmp[db_key];
      if (!newDB) { // stop db workers
        dbs.delete(db_key);
        stopWorkersByDb(db_key);
      } else if (!oldDB) { // start new worker
        dbs.set(db_key, newDB);
        startWorker(db_key);
      } else if (oldDB.configHash !== newDB.configHash || oldDB.ddocsHash !== newDB.ddocsHash) { // restart worker
        dbs.delete(db_key);
        stopWorkersByDb(db_key);
        dbs.set(db_key, newDB);
        startWorker(db_key);
      }
    });
  }

  function startWorker(db, seq) {
    if ( // don't start worker if
      isClosing // master closing
      || !dbs.has(db) // in dbs no worker db
      || (seq > 0
        ? getWorkerByDbSeq(db, seq).length > 0 // seq and worker already exist
        : getWorkersByDbFeed(db).length > 0 // no seq && exist one or more workers with by db
      )
    ) return null;

    if (!seq && getStartingWorkerByDb(db).length > 0) {
      // if we have not initialised workers who can has feed and current worker can has feed - wait not initialised workers
      return setTimeout(startWorker.fill(db, seq), 500);
    }

    const { ddocs, ddocsHash } = dbs.get(db);
    const workerProps = JSON.stringify({ forkType: 'db', db, seq, ddocs });
    const fork = cluster.fork(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({ pid, db, seq, fork, configHash, ddocsHash, feed: false });

    fork.on('exit', onWorkerExit.fill(pid, db));
    fork.on('message', onWorkerMessage.fill(pid, db));
  } // worker stater

  const onWorkerMessage = (pid, db, message) => {
    switch (message.msg) {
      case 'init':
        onWorkerInit(pid, db, message.data);
        break;
      case 'startFeed':
        onWorkerStartFeed(pid, db);
        break;
      case 'stopFeed':
        onWorkerStopFeed(pid, db);
        break;
      case 'oldWorker':
        onOldWorker(db, message.data);
        break;
      default:
        break;
    }
  }; // workers listener
  const onWorkerExit = (pid, dbName, message, code) => {
    // detect if worker killed - start new worker
    if (!message && code === 'SIGKILL' && workers.has(pid)) { // if worker crashed
      const { seq } = workers.get(pid);
      removeWorker(pid);
      if (seq > 0) startWorker(dbName, seq); // try restart worker
    } else { // if worker closed gracefully
      removeWorker(pid);
    }
  }; // when worker closed
  const onWorkerInit = (pid, dbName, data = {}) => {
    const { seq, type } = data;
    setWorkerProp(pid, 'type', type);
    if (seq >= 0) setWorkerProp(pid, 'seq', +seq);
  }; // when worker started - update worker seq
  const onWorkerStartFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', true);
  }; // when worker subscribed on feed - update workers meta
  const onWorkerStopFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', false);
    setWorkerProp(pid, 'type', WORKER_TYPE_OLD);
    startWorker(dbName);
  }; // when worker unsubscribed from feed - update workers meta and try to start new
  const onOldWorker = (dbName, data = {}) => {
    const seq = +data.seq;
    if (seq > 0) { // if worker has seq
      if (getWorkerByDbSeq(dbName, seq).length) { /** log('Worker '+ seq +' already started'); */ }
      else startWorker(dbName, seq); // if master has no worker with seq - try to start old worker
    }
  }; // when detected old worker

  const setWorker = (worker) => {
    if (worker && worker.pid) {
      workers.set(worker.pid, worker);
      return worker;
    }
  }; // set worker state
  const setWorkerProp = (pid, prop, val) => {
    if (workers.has(pid)) {
      const worker = workers.get(pid);
      worker[prop] = val;
      workers.set(pid, worker);
    }
  }; // update prop in worker state

  const workerHasFeed = (worker) => worker.seq >= 0 && worker.type === WORKER_TYPE_ACTUAL && worker.feed === true;
  const workerIsReady = (worker) => worker.seq >= 0 && (worker.type === WORKER_TYPE_OLD || (worker.type === WORKER_TYPE_ACTUAL && worker.feed === true));
  const workerNotReady = (worker) => !workerIsReady(worker);
  const getWorkersByDb = (dbName) => Array.from(workers.values()).filter(worker => worker.db === dbName); // return workers by db
  const getWorkersByDbFeed = (dbName) => getWorkersByDb(dbName).filter(workerHasFeed); // return workers by db who has feed
  const getWorkerByDbSeq = (dbName, seq) => seq >= 0 ? getWorkersByDb(dbName).filter(worker => worker.seq === seq) : []; // return workers by db and seq
  const getStartingWorkerByDb = (dbName) => getWorkersByDb(dbName).filter(workerNotReady); // return workers by db and seq
  const removeWorker = (pid) => workers.has(pid) ? workers.delete(pid) : null; // remove worker by pid
  const stopWorker = (worker) => sendMessage(worker.pid, 'close'); // send close to worker
  const stopWorkersByDb = (dbName) => getWorkersByDb(dbName).forEach(stopWorker);

  function onClose() {
    log({ message: 'Close', event: 'sandbox/close' });
    isClosing = true;
    clearTimeout(configUpdateTimeout); // stop config update

    for (let pid of workers.keys()) sendMessage(pid, 'close'); // send close for all workers

    const onLog = (error) => { // on log saved
      logger.goOffline(); // disconnect log from db
      if (error) log({ message: 'Close', event: 'sandbox/logError', error });
    };

    logger.saveForced() // start save log forced
      .catch(onLog)
      .then(onLog);
  } // on close master

  // detect exit
  process.on('SIGINT', onClose); // on close command
  process.on('exit', () => { log({ message: 'Closed', event: 'sandbox/closed' }); }); // on master closed

  // init
  loadConfig();
};
