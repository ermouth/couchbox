const Promise = require('bluebird');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const redisClient = require('../../utils/redis');
const couchdb = require('../../utils/couchdb');
const saveResults = require('../../utils/resultsSaver');
const config = require('../../config');
const DDoc = require('./ddoc');


const DEBUG = config.get('debug.enabled');
const CHANGE_PROPS_SEPARATOR = '*';
const MAX_PARALLEL_CHANGES = config.get('couchbox.max_parallel_changes');

const {
  BUCKET_WORKER_TYPE_ACTUAL, BUCKET_WORKER_TYPE_OLD,
  CHECK_PROCESSES_TIMEOUT,
  LOG_EVENTS: {
    BUCKET_CHANGES, BUCKET_FEED, BUCKET_FEED_STOP,
    BUCKET_STOP, BUCKET_CLOSE, BUCKET_ERROR,
    DDOC_ERROR,
    HOOK_START, HOOK_SAVE, HOOK_RESULT, HOOK_SKIP, HOOK_ERROR, CHANGE_ERROR
  }
} = require('./constants');

function Bucket(props = {}) {
  const name = props.name;
  const logger = new Logger({ prefix: 'Bucket '+ name, logger: props.logger });
  const log = logger.getLog();


  const _onOldWorker = props.onOldWorker || function(){}; // Call when current worker is latest and detect in state (_local/bucket) old workers
  const _onStartFeed = props.onStartFeed || function(){}; // Call when start follow feed changes
  const _onStopFeed = props.onStopFeed || function(){}; // Call when stop follow feed changes
  const _onInit = props.onInit || function(){}; // Call on init all ddocs
  const _onClose = props.onClose || function(){}; // Call on closing

  const db = couchdb.connectBucket(name);

  const _ddocs = [];
  const _filters = new Map();
  const _hooks = new Map();

  const sequencesQueue = [];
  const sequencesHooks = new Map();
  const hookProcesses = new Map(); // hooks promises

  let worker_seq = +(props.seq || 0); // worker sequence - by latest ddoc seq
  let last_seq = 0; // sequence of last doc in queue
  let max_seq = 0; // max sequence - if worker is old then worker close on change with this sequence
  let feed;
  let worker_type = BUCKET_WORKER_TYPE_ACTUAL;

  let changesCounter = 0; // in process changes counter

  const hasFeed = () => !!feed && !feed.dead; // return true if worker has feed and feed is alive
  const hasTasks = () => sequencesQueue.length > 0; // return true if queue has tasks or worker has working processes
  const isRunning = () => hasFeed() || hasTasks() || changesCounter > 0;

  const stateKey_bucket = 'COUCHBOX:BUCKET:'+ name;
  const stateKey_worker = () => stateKey_bucket +':WORKER:'+ worker_seq;
  const stateKey_ddocs = () => stateKey_worker() + ':DDOCS';
  const stateKey_last_seq = () => stateKey_worker() + ':LAST';
  const stateKey_changes = () => stateKey_worker() + ':CHANGES';
  const stateKey_change_hooks = (seq) => stateKey_worker() + ':SEQ:' + seq;

  const getBucketState = () => new Promise((resolve, reject) => {
    redisClient.get(stateKey_bucket, (error, data) => {
      if (error) {
        log({
          message: 'Error on load local bucket state: '+ stateKey_bucket,
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      resolve(data ? JSON.parse(data) : []);
    });
  });
  const updateBucketState = (closing) => {
    if (worker_seq === 0) return Promise.resolve();
    return getBucketState().then((state = []) => {
      if (!!~state.indexOf(worker_seq)) {
        if (closing && worker_type === BUCKET_WORKER_TYPE_OLD && sequencesQueue.length === 0) {
          state = state.remove(worker_seq);
        }
        else return state;
      }
      else state = state.add(worker_seq).sort((a, b) => b - a);
      return setBucketState(state);
    });
  };
  const setBucketState = (state) => new Promise((resolve, reject) => {
    redisClient.set(stateKey_bucket, JSON.stringify(state), (error) => {
      if (error) {
        log({
          message: 'Error on save bucket state',
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      resolve(state);
    });
  });

  const getWorkerState = () => new Promise((resolve, reject) => {
    if (worker_seq === 0) return Promise.resolve({});
    redisClient.multi([
      ['get', stateKey_ddocs()],
      ['get', stateKey_last_seq()],
      ['smembers', stateKey_changes()]
    ]).exec((error, [ ddocs_state, last_seq_state = 0, sequences = [] ]) => {
      if (error) {
        log({
          message: 'Error on load local worker state',
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      if (!ddocs_state) return resolve([]);

      try {
        ddocs_state = JSON.parse(ddocs_state);
      } catch (error) {
        log({
          message: 'Error on parse local worker state',
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }

      if (last_seq_state = +last_seq_state || 0) {
        last_seq = last_seq_state;
      }

      if (!(sequences && sequences.length > 0)) return resolve(ddocs_state);

      sequences = sequences.map(str => str.split(CHANGE_PROPS_SEPARATOR)).sort((a, b) => a[0] - b[0]);

      redisClient.multi(sequences.map(([seq]) => ['smembers', stateKey_change_hooks(seq)])).exec((error, results) => {
        if (error) {
          log({
            message: 'Error load local worker state sequences',
            event: BUCKET_ERROR,
            error
          });
          return reject(error);
        }
        for (let i = 0, max = results.length; i < max; i++) {
          const change = sequences[i];
          const hooks = new Set();
          results[i].sort().forEach(hookKey => hooks.add(hookKey));
          sequencesQueue.push(change);
          sequencesHooks.set(change[0], hooks);
        }
        resolve(ddocs_state);
      });
    });
  });
  const updateWorkerState = (closing) => {
    if (worker_seq === 0) return Promise.resolve();
    if (closing && worker_type === BUCKET_WORKER_TYPE_OLD && sequencesQueue.length === 0) {
      return Promise.all([
        unsetLastSeqState(),
        unsetDDocsState()
      ]);
    } else {
      return Promise.all([
        setLastSeqState(last_seq),
        setDDocsState()
      ]);
    }
  };

  const setDDocsState = () => new Promise((resolve, reject) => {
    redisClient.set(stateKey_ddocs(), JSON.stringify(_ddocs), (error) => {
      if (error) {
        log({
          message: 'Error on save worker state',
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      resolve();
    });
  });
  const unsetDDocsState = () => new Promise((resolve, reject) => {
    redisClient.del(stateKey_ddocs(), (error) => {
      if (error) {
        log({
          message: 'Error on remove old worker state',
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      resolve();
    });
  });

  const setLastSeqState = (newSeq) => new Promise((resolve, reject) => {
    if (!(newSeq && last_seq < newSeq)) return resolve();
    last_seq = newSeq;
    redisClient.set(stateKey_last_seq(), last_seq, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
  const unsetLastSeqState = () => new Promise((resolve, reject) => {
    redisClient.del(stateKey_last_seq(), (error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  const setChangeState = (seq, id, rev) => new Promise((resolve, reject) => {
    redisClient.sadd(stateKey_changes(), [seq, id, rev].join(CHANGE_PROPS_SEPARATOR), (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
  const unsetChangeState = (seq, id, rev) => new Promise((resolve, reject) => {
    redisClient.srem(stateKey_changes(), [seq, id, rev].join(CHANGE_PROPS_SEPARATOR), (error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  const setChangeHooksState = (seq, hook) => new Promise((resolve, reject) => {
    redisClient.sadd(stateKey_change_hooks(seq), hook, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
  const unsetChangeHooksState = (seq, hook) => new Promise((resolve, reject) => {
    redisClient.srem(stateKey_change_hooks(seq), hook, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });


  const addProcess = (seq, id, rev, hookName, hookPromise) => {
    const sequences = hookProcesses.get(id) || new Map();
    const processes = sequences.has(seq) ? sequences.get(seq) : new Map();
    processes.set(hookName, hookPromise);
    sequences.set(seq, processes);
    hookProcesses.set(id, sequences);
    return hookPromise
      .catch(error => log({
        message: 'Hook error: '+ hookName,
        ref: id,
        event: HOOK_ERROR,
        error: lib.errorBeautify(error)
      }))
      .then(() => setOutProcess(seq, id, rev, hookName));
  };
  const removeProcess = (id, seq, hookName) => {
    const sequences = hookProcesses.get(id);
    if (sequences) {
      const processes = sequences.get(seq);
      if (processes && processes.has(hookName)) {
        if (processes.size === 1) {
          if (sequences.size === 1) hookProcesses.delete(id);
          else sequences.delete(seq);
        }
        else processes.delete(hookName);
      }
    }
  };
  const getPreviousProcess = (id, seq, hookName) => {
    const sequences = hookProcesses.get(id);
    if (!(sequences && sequences.size > 0)) return [];
    let processes, hook, last;
    for (let proc_seq of sequences.keys()) {
      if (proc_seq < seq && (processes = sequences.get(proc_seq)) && (hook = processes.get(hookName))) last = hook;
      else break;
    }
    return last;
  };
  const hasFutureProcess = (id, seq, hookName) => {
    const sequences = hookProcesses.get(id);
    if (sequences && sequences.size > 0) {
      let processes;
      for (let proc_seq of sequences.keys()) {
        if (proc_seq > seq && (processes = sequences.get(proc_seq)) && processes.has(hookName)) return true;
      }
    }
    return false;
  };

  // add change with hooks list in process list
  const setInProcess = (change, hookName) => {
    const { seq, doc } = change;
    const { _id, _rev } = doc;

    let hooks = sequencesHooks.get(seq);
    if (hooks) {
      if (hookName in hooks) {
        return Promise.resolve();
      } else {
        hooks.add(hookName);
        sequencesHooks.set(seq, hooks);
        return setChangeHooksState(seq, hookName);
      }
    }

    hooks = new Set();
    hooks.add(hookName);
    sequencesHooks.set(seq, hooks);
    sequencesQueue.push([seq, _id, _rev, doc]);

    return Promise.all([
      setChangeHooksState(seq, hookName),
      setChangeState(seq, _id, _rev)
    ]);
  };
  // remove hook from process list by change, if hook is last in change - remove change from processes
  const setOutProcess = (seq, id, rev, hookName) => {
    removeProcess(id, seq, hookName);
    const hooks = sequencesHooks.get(seq);
    if (hooks && hooks.has(hookName)) {
      hooks.delete(hookName);
      if (hooks.size === 0) {
        sequencesHooks.delete(seq);
        return Promise.all([
          unsetChangeHooksState(seq, hookName),
          unsetChangeState(seq, id, rev)
        ]);
      }
      sequencesHooks.set(seq, hooks);
      return unsetChangeHooksState(seq, hookName);
    }
    return Promise.resolve();
  };


  // init bucket-worker
  const init = () => {
    getBucketState() // load state
      .then(initDDocs) // init ddocs from state or latest in db
      .then(onInitDDocs) // call _onInit
      // .then(startInProcessChanges) // start old changes from loaded state
      .then(subscribeChanges) // if worker old - start load changes else subscribe on changes feed
      .catch(onInitError) // catch errors on initialisation
      .then(processQueue); // start process queue
  };
  // catch errors on initialisation
  const onInitError = (error) => {
    log({
      message: 'Error on init db: '+ name,
      event: BUCKET_ERROR,
      error
    });
    close();
  };

  const initDDocs = (workers) => {
    if (worker_seq > 0 && !(workers && workers.length > 0 && !!~workers.indexOf(worker_seq))) {
      return Promise.reject(new Error('No db watcher by seq: '+ worker_seq));
    }

    if (worker_seq > 0) {
      const workerIndex = workers.indexOf(worker_seq);
      if (workerIndex > 0) {
        max_seq = workers[workerIndex - 1];
        return getWorkerState().then(ddocs_state => {
          worker_type = BUCKET_WORKER_TYPE_OLD;
          return Promise.map(ddocs_state, initDDoc);
        });
      }
    }

    // Init latest worker
    return Promise.map(Object.keys(props.ddocs), (key) => initDDoc({ name: key, methods: props.ddocs[key] }))
      .then(() => {
        let workerIndex = -1;
        workers.forEach((workerSeq, index) => {
          if (worker_seq === workerSeq) workerIndex = index;
          else _onOldWorker({ seq: workerSeq });
        });
        if (workerIndex >= 0) {
          return getWorkerState().then(() => worker_type = BUCKET_WORKER_TYPE_ACTUAL);
        }
      })
      .then(() => last_seq = last_seq || (worker_seq ? worker_seq : 'now'));
  };
  const initDDoc = (data) => {
    const { name, rev } = data;
    const methods = Object.isArray(data.methods)
      ? data.methods
      : Object.isString(data.methods)
        ? data.methods.split(/\s+/g).compact(true).unique()
        : [];
    return DDoc(db, props.name, { name, rev, methods, logger })
      .then(({ seq, rev, handlers }) => {
        if (worker_seq < seq) worker_seq = seq;
        _ddocs.push({ name, rev, methods });

        handlers.forEach(({ key, filter, hook }) => {
          key = name +'/'+ key;
          _filters.set(key, filter);
          _hooks.set(key, hook);
        });
      })
      .catch(error => {
        log({
          message: 'Error on init ddoc: '+ name,
          event: DDOC_ERROR,
          error
        });
      });
  };
  const onInitDDocs = () => {
    _onInit({ seq: worker_seq, type: worker_type });
    return Promise.all([
      updateBucketState(),
      updateWorkerState()
    ]);
  };

  // start load not in process changes
  const subscribeChanges = () => worker_type === BUCKET_WORKER_TYPE_OLD ? startChanges() : startFeed();
  // load changes between last_seq and max_seq
  const startChanges = () => new Promise((resolve, reject) => {
    log({
      message: 'Start changes since '+ last_seq +' between: '+ max_seq,
      event: BUCKET_CHANGES
    });
    const limit = max_seq - worker_seq;
    db.changes({ since: last_seq, limit, include_docs: true }, (error, changes) => {
      if (error) return reject(error);
      if (changes && changes.results) {
        let i = changes.results.length, change;
        while (i--) if ((change = changes.results[i]) && change.seq < max_seq) {
          onChange(change, false);
        }
      }
      resolve();
    });
  }); // load changes since last_seq with limit (max_seq - last_seq) and skip changes with seq greater then max_seq => push changes in queue
  // start feed from last_seq
  const startFeed = () => {
    log({
      message: 'Start feed '+ worker_seq +' since: '+ last_seq,
      event: BUCKET_FEED
    });
    feed = db.follow({ since: last_seq, include_docs: true });
    feed.on('change', onChange);
    feed.follow();
    _onStartFeed();
  };
  // stop feed and call _onStopFeed
  const stopFeed = () => {
    if (hasFeed()) {
      log({
        message: 'Stop feed',
        event: BUCKET_FEED_STOP
      });
      feed.stop();
      _onStopFeed();
    }
  };

  // call after process last item in queue and start close if no feed
  const onEndQueue = () => {
    if (!hasFeed()) close();
  };
  // on change event push it to queue and run process queue
  const onChange = (change, processNow = true) => {
    const { seq, id } = change;

    // Design document
    if (/_design\//.test(id)) {
      const name = id.substring(id.indexOf('/') + 1);
      if (name && props.ddocs[name]) {
        log({
          message: 'Stop on ddoc change: '+ name,
          event: BUCKET_STOP
        });
        worker_type = BUCKET_WORKER_TYPE_OLD;
        return close();
      }
      return processNow ? processQueue() : null;
    }

    // already in queue
    if (sequencesHooks.has(seq)) return null;

    const tasks = [ setLastSeqState(+seq) ];
    for (let [hookKey, filter] of _filters) {
      if (filter(change.doc)) tasks.push(setInProcess(change, hookKey));
    }
    return Promise.all(tasks).then(() => processNow && processQueue());
  };
  // load & remove first task from queue, if doc is ddoc -> run onDDoc else run onDoc
  const processQueue = () => {
    // no changes in queue
    if (sequencesQueue.length === 0) return onEndQueue();
    // parallel changes limit
    if (changesCounter > MAX_PARALLEL_CHANGES) return null;

    const [seq, id, rev, doc] = sequencesQueue.shift();

    changesCounter++;
    (doc ? Promise.resolve(doc) : loadDoc(id, rev))
      .then(doc => {
        const hooksKeys = sequencesHooks.get(seq);
        if (hooksKeys && hooksKeys.size > 0) return Promise.mapSeries(hooksKeys, (hookKey) => startHook(seq, id, rev, doc, hookKey));
        return Promise.resolve();
      })
      .catch(error => {
        log({
          message: 'Change hooks error: '+ seq,
          ref: id,
          event: CHANGE_ERROR,
          error: lib.errorBeautify(error)
        });
      })
      .then(() => {
        changesCounter--;
        processQueue();
      });
  };

  const loadDoc = (id, rev) => new Promise((resolve, reject) => {
    db.get(id, { rev }, (error, doc) => {
      if (error) return reject(error);
      return resolve(doc);
    });
  });

  // start hook on change
  const startHook = (seq, id, rev, doc, hookKey) => {
    const hook = _hooks.get(hookKey);

    const hookPromise = () => {
      if (hook.mode === 'transitive' && hasFutureProcess(id, seq, hookKey)) {
        log({
          message: 'Skip hook: '+ hookKey,
          ref: id,
          event: HOOK_SKIP
        });
        return Promise.resolve();
      }

      log({
        message: 'Start hook: '+ hookKey,
        ref: id,
        event: HOOK_START
      });

      // run hook with cloned doc
      return hook.handler(Object.clone(doc, true)).then((result = {}) => {
        const { message, docs } = result;
        if (Object.isString(message)) {
          log({
            message: 'Hook result: '+ hookKey +' = '+ message,
            code: result.code,
            ref: id,
            event: HOOK_RESULT
          });
        }
        if (Object.isArray(docs) && docs.length > 0) { // check hook results
          return saveResults(db, docs).then(() => log({
            message: 'Saved hook results: '+ hookKey,
            ref: id,
            event: HOOK_SAVE
          }));
        }
      });
    };

    // dependencies for transitive or sequential mode
    if (hook.mode === 'transitive' || hook.mode === 'sequential') {
      const previous = getPreviousProcess(id, seq, hookKey);
      if (previous) return addProcess(seq, id, rev, hookKey, previous.then(hookPromise));
    }
    // if parallel or empty dependencies
    return addProcess(seq, id, rev, hookKey, hookPromise());
  };

  let _closing = false;
  const close = () => {
    stopFeed(); // previously stop feed
    sequencesQueue.length = 0;
    sequencesHooks.clear();
    if (isRunning()) return setTimeout(close, CHECK_PROCESSES_TIMEOUT); // if worker has tasks wait
    if (_closing) return null;
    _closing = true;
    log({
      message: 'Close',
      event: BUCKET_CLOSE
    });
    Promise.all([
      updateBucketState(true),
      updateWorkerState(true)
    ]).then(() => _onClose(worker_seq));
  }; // start close if bucket-worker and call _onClose

  return { init, close, isRunning };
}

module.exports = Bucket;
