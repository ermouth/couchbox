require('sugar');
const lib = require('./lib');
const Logger = require('./utils/log');
const couchdb = require('./couchdb');
const config = require('./config');


module.exports = function initMaster(cluster) {
  const logger = new Logger({ prefix: 'Master '+ process.pid });
  const log = logger.getLog();
  log('Started');

  const sendMessage = (pid, msg, data) => workers.has(pid) && workers.get(pid).fork.send({ msg, data });

  const workers = new Map();
  const dbs = new Map();

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
  };
  let configHash;

  function loadConfig() {
    couchdb.loadConfig().then(newConf => {
      if (isClosing) return null;
      let needToUpdate = false;
      Object.keys(newConf).forEach(confKey => {
        needToUpdate = configMap[confKey] && configMap[confKey](newConf[confKey]) || needToUpdate;
      });
      if (needToUpdate) {
        log('Updated hooks config');
        configHash = lib.hash(['couchdb', 'hooks'].map(cfg => config.get(cfg)));
        updateWorkers();
      }
      if (!isClosing) configUpdateTimeout = setTimeout(loadConfig, config.get('system.configTimeout'));
    });
  }
  function updateWorkers() {
    log('Update workers');

    const dbsTmp = {};

    Object.keys(hooksConfig).forEach((dbdocKey) => {
      const dbdoc = dbdocKey.split(/\\/);
      const db = dbdoc[0];
      const ddoc = dbdoc[1];
      if (!dbsTmp[db]) dbsTmp[db] = { ddocs: {}, configHash };
      dbsTmp[db].ddocs[ddoc] = hooksConfig[dbdocKey];
    });

    for (let db of dbs.keys()) dbs.delete(db);

    Object.keys(dbsTmp).forEach(db => {
      const db_val = dbsTmp[db];
      if (!db_val || !Object.keys(db_val.ddocs).length) return null;
      db_val.ddocsHash = lib.hash(db_val.ddocs);
      dbs.set(db, db_val);
    });

    workers.forEach(worker => {
      if (worker.configHash !== configHash) return stopWorker(worker);
      const { db } = worker;
      if (!dbs.has(db) || dbs.get(db).ddocsHash !== worker.ddocsHash) return stopWorker(worker);
    });

    for (let db of dbs.keys()) if (!getWorkersByDBandFeed(db).length) startWorker(db);
  }

  function startWorker(db, seq) {
    if (isClosing || !dbs.has(db)) return null;

    const { ddocs, ddocsHash } = dbs.get(db);
    const workerProps = JSON.stringify({ forkType: 'db', db, seq, ddocs });

    const fork = cluster.fork(Object.assign(config.toEnv(), { workerProps }));
    const { pid } = fork.process;
    setWorker({ pid, db, seq, fork, configHash, ddocsHash, feed: false });

    fork.on('exit', onWorkerExit.fill(pid, db));
    fork.on('message', onWorkerMessage.fill(pid, db));
  }

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
  };
  const onWorkerExit = (pid, dbName) => removeWorker(pid);
  const onWorkerInit = (pid, dbName, data = {}) => {
    const { seq } = data;
    if (seq > 0) setWorkerProp(pid, 'seq', +seq);
  };
  const onWorkerStartFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', true);
  };
  const onWorkerStopFeed = (pid, dbName) => {
    setWorkerProp(pid, 'feed', false);
    startWorker(dbName);
  };
  const onOldWorker = (dbName, data = {}) => {
    const seq = +data.seq;
    if (seq > 0) {
      if (getWorkerByDBandSeq(dbName, seq).length) log('Worker '+ seq +' already started');
      else startWorker(dbName, seq);
    }
  };

  const setWorker = (worker) => {
    if (worker && worker.pid) {
      workers.set(worker.pid, worker);
      return worker;
    }
  };
  const setWorkerProp = (pid, prop, val) => {
    if (workers.has(pid)) {
      const worker = workers.get(pid);
      worker[prop] = val;
      workers.set(pid, worker);
    }
  };

  const getWorkersByDB = (dbName) => Array.from(workers.values()).filter(worker => worker.db === dbName);
  const getWorkersByDBandFeed = (dbName) => getWorkersByDB().filter(worker => worker.feed === true);
  const getWorkerByDBandSeq = (dbName, seq) => getWorkersByDB(dbName).filter(worker => worker.seq === seq);
  const removeWorker = (pid) => workers.has(pid) ? workers.delete(pid) : null;
  const stopWorker = (worker) => sendMessage(worker.pid, 'close');

  function onClose() {
    log('Close');
    isClosing = true;
    clearTimeout(configUpdateTimeout);

    for (let pid of workers.keys()) sendMessage(pid, 'close');

    const onLog = (error) => {
      logger.goOffline();
      if (error) log({ message:'Error save log', error });
    };

    logger.saveForced()
      .catch(onLog)
      .then(onLog);
  }

  // detect exit
  process.on('SIGINT', onClose);
  process.on('exit', () => { log('Closed'); });

  // init
  loadConfig();
};
