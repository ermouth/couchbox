require('sugar');
const lib = require('./lib');
const Logger = require('./utils/log');
const couchdb = require('./couchdb');
const config = require('./config');

// Master worker
module.exports = function initMaster(cluster) {
  const logger = new Logger({ prefix: 'Master '+ process.pid });
  const log = logger.getLog();
  log('Started');

  const sendMessage = (pid, msg, data) => workers.has(pid) && workers.get(pid).fork.send({ msg, data });

  const workers = new Map(); // map of current workers
  const dbs = new Map(); // map of current dbs params

  let hooksConfig = {};
  let isClosing = false;
  let configUpdateTimeout;

  const configMap = {
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
        log('Updated hooks config');
        configHash = lib.hash(['redis', 'couchdb', 'hooks'].map(cfg => config.get(cfg))); // update configHash by critical fields
        updateWorkers(); // start update workers
      }
      if (!isClosing) configUpdateTimeout = setTimeout(loadConfig, config.get('system.configTimeout')); // start timeout on next config update if worker is running
    });
  } // load and process couchdb config
  function updateWorkers() {
    log('Update workers');
    const dbsTmp = {};
    Object.keys(hooksConfig).forEach((dbdocKey) => {
      const dbdoc = dbdocKey.split(/\\/);
      const db = dbdoc[0];
      const ddoc = dbdoc[1];
      if (!dbsTmp[db]) dbsTmp[db] = { ddocs: {}, configHash };
      dbsTmp[db].ddocs[ddoc] = hooksConfig[dbdocKey];
    }); // make temp dbs

    for (let db of dbs.keys()) dbs.delete(db); // clean all old dbs

    Object.keys(dbsTmp).forEach(db => {
      const db_val = dbsTmp[db];
      if (!db_val || !Object.keys(db_val.ddocs).length) return null;
      db_val.ddocsHash = lib.hash(db_val.ddocs); // set hash of ddocs config
      dbs.set(db, db_val);
    }); // if db config in dbsTmp is good push it in to dbs

    workers.forEach(worker => {
      if (worker.configHash !== configHash) return stopWorker(worker); // if worker has bad config -> stop worker
      const { db } = worker;
      if (!dbs.has(db) || dbs.get(db).ddocsHash !== worker.ddocsHash) return stopWorker(worker); // if no worker db in dbs or worker has bad ddocsHash -> stop worker
    }); // check workers

    for (let db of dbs.keys()) startWorker(db); // try to start all workers
  }

  function startWorker(db, seq) {
    if ( // don't start worker if
      isClosing // master closing
      || !dbs.has(db) // in dbs no worker db
      || getWorkersByDBandFeed(db).length // exist one or more workers with by db
    ) return null;

    const { ddocs, ddocsHash } = dbs.get(db);
    const workerProps = JSON.stringify({ forkType: 'db', db, seq, ddocs });
    const fork = cluster.fork(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;

    fork.on('exit', onWorkerExit.fill(pid, db));
    fork.on('message', onWorkerMessage.fill(pid, db));

    setWorker({ pid, db, seq, fork, configHash, ddocsHash, feed: false });
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
    const { seq } = data;
    if (seq > 0) setWorkerProp(pid, 'seq', +seq);
  }; // when worker started - update worker seq
  const onWorkerStartFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', true);
  }; // when worker subscribed on feed - update workers meta
  const onWorkerStopFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', false);
    startWorker(dbName);
  }; // when worker unsubscribed from feed - update workers meta and try to start new
  const onOldWorker = (dbName, data = {}) => {
    const seq = +data.seq;
    if (seq > 0) { // if worker has seq
      if (getWorkerByDBandSeq(dbName, seq).length) log('Worker '+ seq +' already started');
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

  const getWorkersByDB = (dbName) => Array.from(workers.values()).filter(worker => worker.db === dbName); // return workers by db
  const getWorkersByDBandFeed = (dbName) => getWorkersByDB().filter(worker => worker.feed === true); // return workers by db who has feed
  const getWorkerByDBandSeq = (dbName, seq) => getWorkersByDB(dbName).filter(worker => worker.seq === seq); // return workers by db and seq
  const removeWorker = (pid) => workers.has(pid) ? workers.delete(pid) : null; // remove worker by pid
  const stopWorker = (worker) => sendMessage(worker.pid, 'close'); // send close to worker

  function onClose() {
    log('Close');
    isClosing = true;
    clearTimeout(configUpdateTimeout); // stop config update

    for (let pid of workers.keys()) sendMessage(pid, 'close'); // send close for all workers

    const onLog = (error) => { // on log saved
      logger.goOffline(); // disconnect log from db
      if (error) log({ message:'Error save log', error });
    };

    logger.saveForced() // start save log forced
      .catch(onLog)
      .then(onLog);
  } // on close master

  // detect exit
  process.on('SIGINT', onClose); // on close command
  process.on('exit', () => { log('Closed'); }); // on master closed

  // init
  loadConfig();
};
