/*
* Couchbox, query server extension for CouchDB, v 0.1
* Worker farm hypervisor
* ---------
* (c) 2017 ftescht, ermouth
*/

require('sugar');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const couchdb = require('../../utils/couchdb');
const config = require('../../config');

const apiConfigValidator = require('../api/configValidator');
const socketConfigValidator = require('../socket/configValidator');
const proxyConfigValidator = require('../proxy/configValidator');
const redisCommanderConfigValidator = require('../redis-commander/configValidator');

const DEBUG = config.get('debug');

// Log events constants
const { LOG_ERROR } = Logger.LOG_EVENTS;
const { CONFIG_API, CONFIG_BUCKET, CONFIG_SOCKET, CONFIG_PROXY, CONFIG_REDIS_COMMANDER, CONFIG_ENDPOINTS, CONFIG_HOOKS } = config.LOG_EVENTS;
const { SANDBOX_START, SANDBOX_CLOSE, SANDBOX_CLOSED, SANDBOX_ERROR, SANDBOX_CONFIG_ERROR } = require('./constants').LOG_EVENTS;

// Worker constants
const { WORKER_TYPE_BUCKET, WORKER_TYPE_SOCKET, WORKER_TYPE_API, WORKER_TYPE_PROXY, WORKER_TYPE_REDIS_COMMANDER, WORKER_WAIT_TIMEOUT } = require('../../utils/worker').Constants;
// Bucket monitor constants
const { BUCKET_WORKER_TYPE_ACTUAL, BUCKET_WORKER_TYPE_OLD } = require('../bucket/constants');
// REST API worker specific constants
const { API_DEFAULT_TIMEOUT } = require('../api/constants');

// Config keys
const {
  CONFIG_COUCHBOX,
  CONFIG_COUCHBOX_PLUGINS,
  CONFIG_COUCHBOX_API,
  CONFIG_COUCHBOX_HOOKS
} = config.Constants;


// Master worker
module.exports = function initMaster(cluster) {
  const logger = new Logger({ prefix: 'Sandbox' });
  const log = logger.getLog();

  // map of current workers
  const workers = new Map();
  // set worker state
  const setWorker = (worker) => {
    if (worker && worker.pid) {
      workers.set(worker.pid, worker);
      return worker;
    }
  };
  // update prop in worker state
  const setWorkerProp = (pid, prop, val) => {
    if (workers.has(pid)) {
      const worker = workers.get(pid);
      worker[prop] = val;
      setWorker(worker);
    }
  };
  // update props in worker state
  const setWorkerProps = (pid, data = {}) => {
    if (workers.has(pid)) {
      const worker = workers.get(pid);
      Object.keys(data).forEach(prop => {
        worker[prop] = data[prop];
      });
      setWorker(worker);
    }
  };

  let isClosing = false;

  // send message to worker
  const sendMessage = (pid, msg, data) => {
    const worker = workers.get(pid);
    if (worker && worker.fork) {
      switch (worker.fork.state) {
        case 'online':
        case 'listening':
          worker.fork.send({ msg, data });
          break;
        default:
          break;
      }
    }
  };
  // called on SIGINT, SIGTERM worker signals
  function onClose() {
    if (isClosing) return null;
    isClosing = true;
    log({ message: 'Close', event: SANDBOX_CLOSE });
    clearTimeout(configUpdateTimeout); // stop config update

    for (let pid of workers.keys()) sendMessage(pid, 'exit'); // send close for all workers

    logger.save(true) // start save log forced
      .catch(error => log({ message: 'Close error: "'+ error.message +'"', event: LOG_ERROR, error }))
      .finally(logger.offline);
  }

  // Init proc signals listeners
  process.on('unhandledRejection', (error) => {
    log({
      message: 'Sandbox unhandled unhandled error',
      event: SANDBOX_ERROR,
      error,
      type: 'fatal'
    });
  });
  process.on('uncaughtException', (error) => {
    log({
      message: 'Sandbox unhandled error',
      event: SANDBOX_ERROR,
      error,
      type: 'fatal'
    });
  });
  process.on('SIGINT', onClose); // on close command
  process.on('SIGTERM', onClose);
  process.on('exit', () => log({ message: 'Closed', event: SANDBOX_CLOSED })); // on master closed


  // Config, maps CouchDB config vars
  // to internal config stash
  const configMap = {
    [CONFIG_COUCHBOX]: (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      onConfigFields(conf, [
        ['couchbox.nodename', 'nodename'],
        ['couchbox.nodes', 'nodes'],
        ['couchbox.max_parallel_changes', 'max_parallel_changes'],
        ['couchbox.cold_start', 'cold_start'],
        ['couchbox.mail', 'mail'],
        ['logger.db', 'log_db'],
        ['logger.dbSave', 'log_dbSave'],
        ['logger.bulkSize', 'log_bulkSize'],


        ['redis.ip', 'redis_ip'],
        ['redis.port', 'redis_port'],
        ['redis.password', 'redis_password'],
        ['redis.redis_commander', 'redis_commander'],

        ['api', 'api'],
        ['socket', 'socket'],
        ['proxy', 'proxy'],

        ['debug', 'debug']
      ]);
    },
    'cors': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      onConfigFields(conf, [
        ['cors.credentials', 'credentials'],
        ['cors.headers', 'headers'],
        ['cors.methods', 'methods'],
        ['cors.origins', 'origins'],
      ]);
    },
    'httpd': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      onConfigFields(conf, [
        ['cors.enabled', 'enable_cors'],
      ]);
    },
    'couchdb': (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      onConfigFields(conf, [
        ['process.timeout', 'os_process_timeout']
      ]);
    },
    'couch_httpd_auth':  (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      onConfigFields(conf, [
        ['couchdb.secret', 'secret'],
        ['user.session', 'timeout']
      ]);
    },

    // master config extension, not for workers
    [CONFIG_COUCHBOX_HOOKS]: (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      hooks = conf;
    },
    [CONFIG_COUCHBOX_API]: (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      endpoints = conf;
    },
    [CONFIG_COUCHBOX_PLUGINS]: (conf = {}) => {
      if (!Object.isObject(conf)) return null;
      Object.keys(conf).forEach(key => { config.patch('plugins', key, conf[key]); });
    }
  }; // map for couchdb config

  // parses config map
  const onConfigFields = (conf, params) => params.forEach(onConfigField.fill(conf));
  const onConfigField = (conf, param) => {
    const field = param[0];
    const fieldNode = param[1];
    const value = config.parse(field, conf[fieldNode]);
    if (config.check(field, value) && config.get(field) !== value) {
      config.set(field, value);
    }
  };
  let configUpdateTimeout;


  const dbs = new Map(); // map of current dbs params
  let hooks = {}; let hooksHash;
  let endpoints = {}; let endpointsHash;

  let configBucketHash; // hash of bucket workers config
  let configApiHash; // hash of api workers config
  let configSocketHash; // hash of socket worker config
  let configProxyHash; // hash of proxy worker config
  let configRedisCommanderHash; // hash of redis-commander worker config

  // Loads config, called repeatedly for monitoring
  // CouchDB cfg changes, and at the end of worker start sequence
  const loadConfig = () => {
    if (isClosing) return null;
    couchdb.loadConfig()
      .catch(error => {
        log({
          message: 'Error on load config',
          event: SANDBOX_CONFIG_ERROR,
          error,
          type: 'fatal'
        });
        onClose();
      })
      .then(onConfig);
  }; // load and process couchdb config

  const onConfig = (newConf) => {
    // if worker is not running - don't update config and start config update timeout
    if (isClosing) return null;

    // Map config
    Object.keys(newConf).forEach(confKey => configMap[confKey] && configMap[confKey](newConf[confKey]));

    const defaults = ['couchbox', 'logger', 'debug'];

    // Check redis-commander config
    const newConfigRedisCommanderHash = lib.sdbmCode(defaults.concat(['redis']).map(config.get)); // update configSocketHash by critical fields
    if (newConfigRedisCommanderHash !== configRedisCommanderHash) {
      configRedisCommanderHash = newConfigRedisCommanderHash;
      log({
        message: 'Updated redis-commander worker config',
        event: CONFIG_REDIS_COMMANDER
      });
      updateRedisCommanderWorkers();
    }


    // Check socket config
    const newConfigSocketHash = lib.sdbmCode(defaults.concat(['redis', 'socket']).map(config.get)); // update configSocketHash by critical fields
    if (newConfigSocketHash !== configSocketHash) {
      log({
        message: 'Updated socket worker config',
        event: CONFIG_SOCKET
      });
      configSocketHash = newConfigSocketHash;
      updateSocketWorkers();
    }


    // Check proxy config
    const newConfigProxyHash = lib.sdbmCode(defaults.concat(['proxy', 'cors', 'api', 'socket']).map(config.get)); // update configSocketHash by critical fields
    if (newConfigProxyHash !== configProxyHash) {
      configProxyHash = newConfigProxyHash;
      log({
        message: 'Updated proxy worker config',
        event: CONFIG_PROXY
      });
      updateProxyWorkers();
    }


    // Check bucket worker and hooks config
    let updateBuckets = false;
    const newConfigBucketHash = lib.sdbmCode(defaults.concat(['couchdb', 'redis', 'plugins', 'hooks']).map(config.get)); // update configBucketHash by critical fields
    if (configBucketHash !== newConfigBucketHash) {
      configBucketHash = newConfigBucketHash;
      updateBuckets = true;
      log({
        message: 'Updated bucket worker config',
        event: CONFIG_BUCKET
      });
    }
    const newHooksHash = lib.sdbmCode(hooks);
    if (hooksHash !== newHooksHash) {
      hooksHash = newHooksHash;
      updateBuckets = true;
      log({
        message: 'Updated hooks config',
        event: CONFIG_HOOKS
      });
    }
    if (updateBuckets) updateBucketWorkers(); // start update bucket workers


    // Check api worker and endpoints config
    let updateApi = false;
    const newConfigApiHash = lib.sdbmCode(defaults.concat(['couchdb', 'redis', 'plugins', 'cors', 'api']).map(config.get)); // update configBucketHash by critical fields
    if (configApiHash !== newConfigApiHash) {
      configApiHash = newConfigApiHash;
      updateApi = true;
      log({
        message: 'Updated api worker config',
        event: CONFIG_API
      });
    }
    const newEndpointsHash = lib.sdbmCode(endpoints);
    if (endpointsHash !== newEndpointsHash) {
      endpointsHash = newEndpointsHash;
      updateApi = true;
      log({
        message: 'Updated endpoints config',
        event: CONFIG_ENDPOINTS
      });
    }
    if (updateApi) updateApiWorkers(); // start update api workers


    // start timeout on next config update if worker is running
    configUpdateTimeout = setTimeout(loadConfig, config.get('system.configTimeout'));
  };

  // On cfg change detects workers|hooks touched by changes
  // and restarts re-instantiate outdated workers
  function updateBucketWorkers() {
    const dbsTmp = {};
    const dbs_keys = [];

    Object.keys(hooks).forEach((dbdocKey) => {
      const dbdoc = dbdocKey.trim().split(/\\|\|/);
      const db = dbdoc[0];
      const ddoc = dbdoc[1];
      if (!dbsTmp[db]) dbsTmp[db] = { ddocs: {}, configHash: configBucketHash };
      dbsTmp[db].ddocs[ddoc] = hooks[dbdocKey];
    }); // make temp dbs

    Object.keys(dbsTmp).forEach(db_key => {
      const db_ddocs = dbsTmp[db_key] && dbsTmp[db_key].ddocs ? dbsTmp[db_key].ddocs : null;
      if (db_ddocs && Object.keys(db_ddocs).length) {
        dbsTmp[db_key].ddocsHash = lib.sdbmCode(db_ddocs); // set hash of ddocs config
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

  // Special case, restarts appropriate workers on socket.io cfg change
  function updateSocketWorkers() {
    if (!socketConfigValidator(config.get('socket'))) return stopSocketWorkers();

    const aliveWorkers = [];
    getSocketWorkers().forEach(worker => {
      if (worker.configHash !== configSocketHash) stopWorker(worker);
      else aliveWorkers.push(worker);
    });

    if (aliveWorkers.length === 0) startWorkerSocket();
    aliveWorkers.length = 0;
  }

  // Special case, restarts appropriate workers on proxy cfg change
  function updateProxyWorkers() {
    if (!proxyConfigValidator(config.get('proxy'))) return stopProxyWorkers();

    const aliveWorkers = [];
    getProxyWorkers().forEach(worker => {
      if (worker.configHash !== configProxyHash) stopWorker(worker);
      else aliveWorkers.push(worker);
    });

    if (aliveWorkers.length === 0) startWorkerProxy();
    aliveWorkers.length = 0;
  }

  // Special case, restarts appropriate workers on redis cfg change
  function updateRedisCommanderWorkers() {
    if (!redisCommanderConfigValidator(config.get('redis.redis_commander'))) return stopRedisCommanderWorkers();

    const aliveWorkers = [];
    getRedisCommanderWorkers().forEach(worker => {
      if (worker.configHash !== configRedisCommanderHash) stopWorker(worker);
      else aliveWorkers.push(worker);
    });

    if (aliveWorkers.length === 0) startWorkerRedisCommander();
    aliveWorkers.length = 0;
  }

  // Special case for REST API worker farm,
  // they all are identical
  function updateApiWorkers() {
    if (!apiConfigValidator(config.get('api'))) return stopApiWorkers();

    const aliveWorkers = {};
    getApiWorkers().forEach(worker => {
      if (worker.configHash !== configApiHash || worker.endpointsHash !== endpointsHash) {
        stopWorker(worker);
        setTimeout(() => {
          if (workers.has(worker.pid)) {
            log('Kill api worker by timeout: '+ worker.pid);
            worker.fork.destroy();
          }
        }, (worker.timeout || API_DEFAULT_TIMEOUT) + config.get('api.restart_delta'));
      }
      else aliveWorkers[worker.port] = true;
    });

    config.get('api.ports').forEach((port) => !aliveWorkers[port] && startWorkerApi(port));
  }

  // Workers manipulations

  const forkWorker = (function (debug) {
    if (!debug) return (props = {}) => cluster.fork(props);
    let debugPort = 0;

    const workerArgv = [];
    process.execArgv.forEach(prop => {
      const [propName, propVal] = prop.split('=');
      if (propName === '--debug-brk' || propName === '--debug') {
        debugPort = +propVal;
      } else {
        workerArgv.push(prop);
      }
    });
    cluster.setupMaster({ execArgv: workerArgv.concat([ '--debug-brk='+ debugPort ]) });

    return (props = {}) => {
      ++debugPort;
      cluster.settings.execArgv = [ '--debug-brk='+ debugPort ].concat(workerArgv);
      return cluster.fork(props);
    };
  })('v8debug' in global && typeof global['v8debug'] === 'object');

  const getWorkers = () => Array.from(workers.values());
  // remove worker by pid
  const removeWorker = (pid) => workers.has(pid) ? workers.delete(pid) : null;
  // send close to worker
  const stopWorker = (worker) => sendMessage(worker.pid, 'close');


  // Bucket workers manipulations

  // filter worker with feed
  const bucketWorkerHasFeed = (worker) => worker.seq >= 0 && worker.type === BUCKET_WORKER_TYPE_ACTUAL && worker.feed === true;
  // filter initialised workers
  const bucketWorkerIsReady = (worker) => worker.seq >= 0 && (worker.type === BUCKET_WORKER_TYPE_OLD || (worker.type === BUCKET_WORKER_TYPE_ACTUAL && worker.feed === true));
  // filter not initialised workers
  const bucketWorkerNotReady = (worker) => !bucketWorkerIsReady(worker);

  const getBucketWorkers = () => getWorkers().filter(({ forkType }) => forkType === WORKER_TYPE_BUCKET);
  // returns bucket workers by bucket
  const getBucketWorkersByDb = (dbName) => getBucketWorkers().filter(({ db }) => db === dbName);
  // returns bucket workers by bucket with changes feed attached
  const getBucketWorkersByDbFeed = (dbName) => getBucketWorkersByDb(dbName).filter(bucketWorkerHasFeed);
  // returns bucket workers by bucket and seq
  const getBucketWorkerByDbSeq = (dbName, seq) => seq >= 0 ? getBucketWorkersByDb(dbName).filter(worker => worker.seq === seq) : [];
  // returns bucket workers by bucket and seq
  const getBucketStartingWorkerByDb = (dbName) => getBucketWorkersByDb(dbName).filter(bucketWorkerNotReady);
  // stops bucket workers by bucket
  const stopBucketWorkersByDb = (dbName) => getBucketWorkersByDb(dbName).forEach(stopWorker);

  // when bucket worker started - update worker seq
  const onBucketWorkerInit = (pid, dbName, data = {}) => {
    const { seq, type } = data;
    if (seq >= 0) {
      setWorkerProps(pid, { type, seq: +seq });
    } else {
      setWorkerProp(pid, 'type', type);
    }
  };
  const onBucketWorkerStartFeed = (pid) => {
    setWorkerProp(pid, 'feed', true);
  }; // when bucket worker subscribed on feed - update worker's meta
  const onBucketWorkerStopFeed = (pid, dbName) => {
    setWorkerProps(pid, {
      feed: false,
      type: BUCKET_WORKER_TYPE_OLD
    });
    setTimeout(startWorkerBucket.fill(dbName), WORKER_WAIT_TIMEOUT);
  }; // when bucket worker unsubscribed from feed - update worker's meta and try to start new
  const onBucketWorkerOld = (dbName, data = {}) => {
    const seq = +data.seq;
    if (seq > 0) { // if worker has seq
      if (getBucketWorkerByDbSeq(dbName, seq).length) { /** log('Worker '+ seq +' already started'); */ }
      else setTimeout(startWorkerBucket.fill(dbName, seq), WORKER_WAIT_TIMEOUT); // if master has no worker with seq - try to start old worker

    }
  }; // when detected old bucket worker
  const onBucketWorkerExit = (pid, dbName, message, code) => {
    // detect if worker killed - start new worker
    if (!message && code === 'SIGKILL' && workers.has(pid)) { // if worker crashed
      const { seq } = workers.get(pid);
      removeWorker(pid);
      if (seq > 0) setTimeout(startWorkerBucket.fill(dbName, seq), WORKER_WAIT_TIMEOUT); // try restart worker
    } else { // if worker closed gracefully
      removeWorker(pid);
    }
  }; // when bucket worker closed

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
    const workerProps = JSON.stringify({ forkType, params: { name:db, seq, ddocs }});
    const fork = forkWorker(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({
      pid, fork, forkType,
      configHash, ddocsHash,
      db, seq,
      feed: false
    });

    fork.on('exit', onBucketWorkerExit.fill(pid, db));
    fork.on('message', message => {
      switch (message.msg) {
        case 'init':
          onBucketWorkerInit(pid, db, message.data);
          break;
        case 'startFeed':
          onBucketWorkerStartFeed(pid);
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
  } // bucket worker stater


  // Proxy workers manipulations

  const getProxyWorkers = () => getWorkers().filter(({ forkType }) => forkType === WORKER_TYPE_PROXY); // return proxy workers
  const stopProxyWorkers = () => getProxyWorkers().forEach(stopWorker); // stop all proxy workers

  function startWorkerProxy() {
    if ( // don't start worker if
      isClosing // master closing
      || !proxyConfigValidator(config.get('proxy')) // proxy turned off
    ) return null;

    const configHash = configProxyHash;
    const forkType = WORKER_TYPE_PROXY;
    const workerProps = JSON.stringify({ forkType, params: {} });

    const fork = forkWorker(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({
      pid, fork, forkType,
      configHash,
      init: false
    });

    fork.on('exit', removeWorker.fill(pid));
    fork.on('message', message => {
      switch (message.msg) {
        case 'init':
          setWorkerProp(pid, 'init', true);
          break;
        default:
          break;
      }
    });

  } // proxy worker stater


  // Redis-Commander workers manipulations

  const getRedisCommanderWorkers = () => getWorkers().filter(({ forkType }) => forkType === WORKER_TYPE_REDIS_COMMANDER); // return proxy workers
  const stopRedisCommanderWorkers = () => getRedisCommanderWorkers().forEach(stopWorker); // stop all proxy workers

  function startWorkerRedisCommander() {
    if ( // don't start worker if
      isClosing // master closing
      || !redisCommanderConfigValidator(config.get('redis.redis_commander')) // proxy turned off
    ) return null;

    const configHash = configRedisCommanderHash;
    const forkType = WORKER_TYPE_REDIS_COMMANDER;
    const workerProps = JSON.stringify({ forkType, params: {} });

    const fork = forkWorker(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({
      pid, fork, forkType,
      configHash,
      init: false
    });

    fork.on('exit', removeWorker.fill(pid));
    fork.on('message', message => {
      switch (message.msg) {
        case 'init':
          setWorkerProp(pid, 'init', true);
          break;
        default:
          break;
      }
    });

  } // redis-commander worker stater


  // Socket workers manipulations

  const getSocketWorkers = () => getWorkers().filter(({ forkType }) => forkType === WORKER_TYPE_SOCKET); // return socket workers
  const stopSocketWorkers = () => getSocketWorkers().forEach(stopWorker); // stop all socket workers

  function startWorkerSocket() {
    if ( // don't start worker if
      isClosing // master closing
      || !socketConfigValidator(config.get('socket')) // socket turned off
    ) return null;

    const configHash = configSocketHash;
    const forkType = WORKER_TYPE_SOCKET;
    const workerProps = JSON.stringify({ forkType, params: {} });

    const fork = forkWorker(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({
      pid, fork, forkType,
      configHash,
      init: false
    });

    fork.on('exit', removeWorker.fill(pid));
    fork.on('message', message => {
      switch (message.msg) {
        case 'init':
          setWorkerProp(pid, 'init', true);
          break;
        default:
          break;
      }
    });

  } // socket worker stater


  // API workers manipulations

  const getApiWorkers = () => getWorkers().filter(({ forkType }) => forkType === WORKER_TYPE_API); // return api workers
  const getApiWorkersByPort = (port) => getApiWorkers().filter((worker) => worker.port === port); // return api workers by port
  const stopApiWorkers = () => getApiWorkers().forEach(stopWorker); // stop all api workers

  function startWorkerApi(port) {
    if ( // don't start worker if
      isClosing // master closing
      || !apiConfigValidator(config.get('api')) // api turned off
      || (!(port && port > 0)) // no port
      || getApiWorkersByPort(port).length > 0 // exist worker with same port
    ) return null;

    const configHash = configApiHash;
    const forkType = WORKER_TYPE_API;
    const workerProps = JSON.stringify({ forkType, params: { endpoints, port } });

    const fork = forkWorker(Object.assign(
      config.toEnv(), // send current config
      { workerProps } // send worker properties
    ));
    const { pid } = fork.process;
    setWorker({
      pid, fork, forkType,
      configHash, endpointsHash,
      port,
      init: false
    });

    fork.on('exit', () => {
      removeWorker(pid);
      config.get('api.ports').forEach((p) => port === p && startWorkerApi(port));
    });
    fork.on('message', ({ msg, data }) => {
      switch (msg) {
        case 'init':
          setWorkerProps(pid, {
            init: true,
            timeout: data && data.timeout ? data.timeout : API_DEFAULT_TIMEOUT
          });
          break;
        default:
          break;
      }
    });

  } // socket worker stater

  // Init
  loadConfig();

  log({
    message: 'Started',
    event: SANDBOX_START
  });
};
