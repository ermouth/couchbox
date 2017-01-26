require('sugar');
const lib = require('./lib');
const Logger = require('./utils/log');
const couchdb = require('./couchdb');
const config = require('./config');

const {
  LOG_EVENT_LOG_ERROR,
  LOG_EVENT_SANDBOX_START, LOG_EVENT_SANDBOX_CONFIG, LOG_EVENT_SANDBOX_CLOSE, LOG_EVENT_SANDBOX_CLOSED
} = require('./constants/logEvents');

const { WORKER_TYPE_BUCKET, WORKER_TYPE_SOCKET } = require('./constants/worker');

const { BUCKET_WORKER_TYPE_ACTUAL, BUCKET_WORKER_TYPE_OLD } = require('./constants/bucket');
const WORKER_WAIT_TIMEOUT = 500;

// Master worker
module.exports = function initMaster(cluster) {
  const logger = new Logger({ prefix: 'Master '+ process.pid });
  const log = logger.getLog();
  log({
    message: 'Started',
    event: LOG_EVENT_SANDBOX_START
  });

  const workers = new Map(); // map of current workers
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
      setWorker(worker);
    }
  }; // update prop in worker state

  let isClosing = false;

  const sendMessage = (pid, msg, data) => workers.has(pid) && workers.get(pid).fork.send({ msg, data });
  function onClose() {
    if (isClosing) return null;
    log({ message: 'Close', event: LOG_EVENT_SANDBOX_CLOSE });
    isClosing = true;
    clearTimeout(configUpdateTimeout); // stop config update

    for (let pid of workers.keys()) sendMessage(pid, 'close'); // send close for all workers

    logger.saveForced() // start save log forced
      .catch(error => log({ message: 'Close', event: LOG_EVENT_LOG_ERROR, error }))
      .finally(() => {
        logger.goOffline();
      });
  } // on close master
  process.on('SIGINT', onClose); // on close command
  process.on('exit', () => { log({ message: 'Closed', event: LOG_EVENT_SANDBOX_CLOSED }); }); // on master closed

  const dbs = new Map(); // map of current dbs params
  let hooksConfig = {};

  // Config
  const configMap = {
    'couchbox': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;
      let field;

      field = 'couchbox.nodename';
      const nodename = config.parse(field, conf.nodename);
      if (config.check(field, nodename) && config.get(field) !== nodename) {
        needToUpdate = true;
        config.set(field, nodename);
      }

      field = 'socket.enabled';
      const socket = config.parse(field, conf.socket);
      if (config.check(field, socket) && config.get(field) !== socket) {
        needToUpdate = true;
        config.set(field, socket);
      }

      field = 'socket.port';
      const socket_port = config.parse(field, conf.socket_port);
      if (config.check(field, socket_port) && config.get(field) !== socket) {
        needToUpdate = true;
        config.set(field, socket_port);
      }

      field = 'socket.count';
      const socket_count = config.parse(field, conf.socket_count);
      if (config.check(field, socket_count) && config.get(field) !== socket_count) {
        needToUpdate = true;
        config.set(field, socket_count);
      }

      return needToUpdate;
    },
    'hooks': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;
      Object.keys(conf).forEach(dbKey => {
        if (!needToUpdate && hooksConfig[dbKey] !== conf[dbKey]) needToUpdate = true;
      });
      if (needToUpdate) {
        hooksConfig = conf;
      }
      return needToUpdate;
    },
    'couchdb': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;
      let field;

      field = 'hooks.timeout';
      const processTimeout = config.parse(field, conf.os_process_timeout);
      if (config.check(field, processTimeout) && config.get(field) !== processTimeout) {
        needToUpdate = true;
        config.set(field, processTimeout);
      }

      return needToUpdate;
    },
    'couch_httpd_auth':  (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      let needToUpdate = false;
      let field;

      field = 'couchdb.secret';
      const secret = config.parse(field, conf.secret);
      if (config.check(field, secret) && config.get(field) !== secret) {
        needToUpdate = true;
        config.set(field, secret);
      }

      return needToUpdate;
    }
  }; // map for couchdb config
  let configUpdateTimeout;

  let configBucketHash; // hash of bucket workers config
  let configSocketHash; // hash of socket workers config

  const loadConfig = () => couchdb.loadConfig().then(newConf => {
    if (isClosing) return null;
    let needToUpdate = false;
    Object.keys(newConf).forEach(confKey => {
      needToUpdate = configMap[confKey] && configMap[confKey](newConf[confKey]) || needToUpdate;
    });
    if (needToUpdate) { // if one or more from changes updated
      log({
        message: 'Updated hooks config',
        event: LOG_EVENT_SANDBOX_CONFIG
      });
      configBucketHash = lib.hashMD5(['couchbox', 'couchdb', 'hooks', 'redis'].map(config.get)); // update configBucketHash by critical fields
      configSocketHash = lib.hashMD5(['couchbox', 'socket'].map(config.get)); // update configBucketHash by critical fields
      updateBucketWorkers(); // start update bucket workers
      // updateSocketWorkers();
    }
    if (!isClosing) configUpdateTimeout = setTimeout(loadConfig, config.get('system.configTimeout')); // start timeout on next config update if worker is running
  }); // load and process couchdb config


  function updateBucketWorkers() {
    const dbsTmp = {};
    const dbs_keys = [];

    Object.keys(hooksConfig).forEach((dbdocKey) => {
      const dbdoc = dbdocKey.split(/\\/);
      const db = dbdoc[0];
      const ddoc = dbdoc[1];
      if (!dbsTmp[db]) dbsTmp[db] = { ddocs: {}, configHash: configBucketHash };
      dbsTmp[db].ddocs[ddoc] = hooksConfig[dbdocKey];
    }); // make temp dbs

    Object.keys(dbsTmp).forEach(db_key => {
      const db_ddocs = dbsTmp[db_key] && dbsTmp[db_key].ddocs ? dbsTmp[db_key].ddocs : null;
      if (db_ddocs && Object.keys(db_ddocs).length) {
        dbsTmp[db_key].ddocsHash = lib.hashMD5(db_ddocs); // set hash of ddocs config
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
        stopBucketWorkersByDb(db_key);
      } else if (!oldDB) { // start new worker
        dbs.set(db_key, newDB);
        startWorkerBucket(db_key);
      } else if (oldDB.configHash !== newDB.configHash || oldDB.ddocsHash !== newDB.ddocsHash) { // restart worker
        dbs.delete(db_key);
        stopBucketWorkersByDb(db_key);
        dbs.set(db_key, newDB);
        startWorkerBucket(db_key);
      }
    });
  }

  function updateSocketWorkers() {
    const socketAvailable = config.get('socket.enabled');
    if (!socketAvailable) return stopSocketWorkers();

    const aliveWorkers = [];
    getSocketWorkers().forEach(worker => {
      if (socketWorkerIsDead(worker)) {}
      else if (worker.configHash !== configSocketHash) {}
      else aliveWorkers.push(worker);
    });

    const needToStart = config.get('socket.count') - aliveWorkers.length;
    if (needToStart === 0) return null;
    else if (needToStart > 0) (needToStart).times(startWorkerSocket);
    else {
      console.log();
      console.log('need to close', needToStart);
      console.log();
    }
  }

  // Workers manipulations

  const getWorkers = () => Array.from(workers.values());
  const removeWorker = (pid) => workers.has(pid) ? workers.delete(pid) : null; // remove worker by pid
  const stopWorker = (worker) => sendMessage(worker.pid, 'close'); // send close to worker


  // Bucket workers manipulations

  const bucketWorkerHasFeed = (worker) => worker.seq >= 0 && worker.type === BUCKET_WORKER_TYPE_ACTUAL && worker.feed === true; // filter worker with feed
  const bucketWorkerIsReady = (worker) => worker.seq >= 0 && (worker.type === BUCKET_WORKER_TYPE_OLD || (worker.type === BUCKET_WORKER_TYPE_ACTUAL && worker.feed === true)); // filter initialised workers
  const bucketWorkerNotReady = (worker) => !bucketWorkerIsReady(worker); // filter not initialised workers

  const getBucketWorkers = () => getWorkers().filter(({ forkType }) => forkType === WORKER_TYPE_BUCKET);
  const getBucketWorkersByDb = (dbName) => getBucketWorkers().filter(({ db }) => db === dbName); // return workers by db
  const getBucketWorkersByDbFeed = (dbName) => getBucketWorkersByDb(dbName).filter(bucketWorkerHasFeed); // return workers by db who has feed
  const getBucketWorkerByDbSeq = (dbName, seq) => seq >= 0 ? getBucketWorkersByDb(dbName).filter(worker => worker.seq === seq) : []; // return workers by db and seq
  const getBucketStartingWorkerByDb = (dbName) => getBucketWorkersByDb(dbName).filter(bucketWorkerNotReady); // return workers by db and seq
  const stopBucketWorkersByDb = (dbName) => getBucketWorkersByDb(dbName).forEach(stopWorker); // stop workers by db

  const onBucketWorkerInit = (pid, dbName, data = {}) => {
    const { seq, type } = data;
    setWorkerProp(pid, 'type', type);
    if (seq >= 0) setWorkerProp(pid, 'seq', +seq);
  }; // when worker started - update worker seq
  const onBucketWorkerStartFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', true);
  }; // when worker subscribed on feed - update workers meta
  const onBucketWorkerStopFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', false);
    setWorkerProp(pid, 'type', BUCKET_WORKER_TYPE_OLD);
    startWorkerBucket(dbName);
  }; // when worker unsubscribed from feed - update workers meta and try to start new
  const onBucketWorkerOld = (dbName, data = {}) => {
    const seq = +data.seq;
    if (seq > 0) { // if worker has seq
      if (getBucketWorkerByDbSeq(dbName, seq).length) { /** log('Worker '+ seq +' already started'); */ }
      else startWorkerBucket(dbName, seq); // if master has no worker with seq - try to start old worker
    }
  }; // when detected old worker
  const onWorkerExit = (pid, dbName, message, code) => {
    // detect if worker killed - start new worker
    if (!message && code === 'SIGKILL' && workers.has(pid)) { // if worker crashed
      const { seq } = workers.get(pid);
      removeWorker(pid);
      if (seq > 0) startWorkerBucket(dbName, seq); // try restart worker
    } else { // if worker closed gracefully
      removeWorker(pid);
    }
  }; // when worker closed

  function startWorkerBucket(db, seq) {
    if ( // don't start worker if
      isClosing // master closing
      || !dbs.has(db) // in dbs no worker db
      || (seq > 0
          ? getBucketWorkerByDbSeq(db, seq).length > 0 // seq and worker already exist
          : getBucketWorkersByDbFeed(db).length > 0 // no seq && exist one or more workers with feed by db
      )
    ) return null;

    if (!seq && getBucketStartingWorkerByDb(db).length > 0) {
      // if we have not initialised workers who can has feed and current worker can has feed - wait not initialised workers
      return setTimeout(startWorkerBucket.fill(db, seq), WORKER_WAIT_TIMEOUT);
    }

    const { ddocs, ddocsHash, configHash } = dbs.get(db);
    const forkType = WORKER_TYPE_BUCKET;
    const workerProps = JSON.stringify({ forkType, db, seq, ddocs });
    const fork = cluster.fork(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({ pid, fork, forkType, db, seq, ddocsHash, configHash, feed: false });

    fork.on('exit', onWorkerExit.fill(pid, db));
    fork.on('message', message => {
      switch (message.msg) {
        case 'init':
          onBucketWorkerInit(pid, db, message.data);
          break;
        case 'startFeed':
          onBucketWorkerStartFeed(pid, db);
          break;
        case 'stopFeed':
          onBucketWorkerStopFeed(pid, db);
          break;
        case 'oldWorker':
          onBucketWorkerOld(db, message.data);
          break;
        default:
          break;
      }
    });
  } // worker stater


  // Socket workers manipulations

  const socketWorkerIsDead = (worker) => worker.init === false;
  const getSocketWorkers = () => getWorkers().filter(({ forkType }) => forkType === WORKER_TYPE_SOCKET);
  const stopSocketWorkers = () => getSocketWorkers().forEach(stopWorker); // stop all socket workers

  function startWorkerSocket() {
    const configHash = configSocketHash;
    const forkType = WORKER_TYPE_SOCKET;
    const workerProps = JSON.stringify({ forkType });
    const fork = cluster.fork(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({
      pid, fork, forkType, configHash,
      init: false
    });

    fork.on('exit', () => removeWorker(pid));
    fork.on('message', message => {
      switch (message.msg) {
        case 'init':
          setWorkerProp(pid, 'init', true);
          break;
        default:
          break;
      }
    });

  } // worker stater

  // Init
  loadConfig();
};
