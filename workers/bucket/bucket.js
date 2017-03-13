const Promise = require('bluebird');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const redisClient = require('../../utils/redis');
const couchdb = require('../../utils/couchdb');
const saveResults = require('../../utils/resultsSaver');
const config = require('../../config');
const DDoc = require('./ddoc');


const DEBUG = config.get('debug.enabled');

const {
  BUCKET_WORKER_TYPE_ACTUAL, BUCKET_WORKER_TYPE_OLD,
  CHECK_PROCESSES_TIMEOUT,
  CHANGE_DOC_ID, CHANGE_DOC_REV, CHANGE_DOC_HOOKS,
  LOG_EVENTS: {
    BUCKET_CHANGES, BUCKET_FEED, BUCKET_FEED_STOP,
    BUCKET_STOP, BUCKET_CLOSE, BUCKET_ERROR,
    DDOC_ERROR,
    HOOK_START, HOOK_SAVE, HOOK_RESULT, HOOK_SKIP, HOOK_ERROR
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

  const bucketStateKey = 'couchbox_bucket_'+ name;
  const workerStatePrefix = bucketStateKey +'_worker_';

  const ddocs = [];
  const ddocs_index = {}; // ddocs id=>index in ddocs
  let worker_seq = +(props.seq || 0); // worker sequence - by latest ddoc seq
  let last_seq = 0; // sequence of last doc in queue
  let max_seq = 0; // max sequence - if worker is old then worker close on change with this sequence
  let ddocsInfo = [];
  let feed;
  let worker_type = BUCKET_WORKER_TYPE_ACTUAL;

  let inProcess = {}; // changes in process
  const queue = []; // changes queue
  const hookProcesses = new Map(); // hooks promises
  const changesStackThrottle = 3; // max parallel changes
  let changesCounter = 0; // in process changes counter

  const hasFeed = () => !!feed && !feed.dead; // return true if worker has feed and feed is alive
  const hasTasks = () => queue.length > 0; // return true if queue has tasks or worker has working processes
  const isRunning = () => hasFeed() || hasTasks() || changesCounter > 0;

  const setInProcess = (change, hook) => {
    const { seq, doc: { _id, _rev } } = change;
    if (seq in inProcess) {
      if (!~inProcess[seq][CHANGE_DOC_HOOKS].indexOf(hook)) inProcess[seq][CHANGE_DOC_HOOKS].push(hook);
    } else {
      inProcess[seq] = [];
      inProcess[seq][CHANGE_DOC_ID] = _id;
      inProcess[seq][CHANGE_DOC_REV] = _rev;
      inProcess[seq][CHANGE_DOC_HOOKS] = [ hook ];
    }
  }; // add change with hooks list in process list
  const setOutProcess = (change, hook) => {
    const { seq } = change;
    if (seq in inProcess) {
      inProcess[seq][CHANGE_DOC_HOOKS] = inProcess[seq][CHANGE_DOC_HOOKS].remove(hook);
      if (inProcess[seq][CHANGE_DOC_HOOKS].length === 0) delete inProcess[seq];
    }
  }; // remove hook from process list by change, if hook is last in change - remove change from processes

  const defBucketState= [];
  const getBucketState = () => new Promise((resolve, reject) => {
    redisClient.get(bucketStateKey, (error, data) => {
      if (error) {
        log({
          message: 'Error on load local bucket state: '+ bucketStateKey,
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      resolve(data ? JSON.parse(data) : defBucketState);
    });
  });
  const setBucketState = (closing) => {
    if (worker_seq === 0) return Promise.resolve();
    return getBucketState().then((state = []) => new Promise((resolve, reject) => {
      if (!!~state.indexOf(worker_seq)) {
        if (closing && worker_type === BUCKET_WORKER_TYPE_OLD && Object.keys(inProcess).length === 0) {
          state = state.remove(worker_seq);
        } else {
          return resolve(state);
        }
      } else {
        state = state.add(worker_seq).sort((a, b) => b - a);
      }
      redisClient.set(bucketStateKey, JSON.stringify(state), (error) => {
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
    }));
  };

  const defWorkerState = {};
  const getWorkerState = () => new Promise((resolve, reject) => {
    if (worker_seq === 0) return Promise.resolve(defWorkerState);
    let workerStateKey = workerStatePrefix + worker_seq;

    redisClient.get(workerStateKey, (error, data) => {
      if (error) {
        log({
          message: 'Error on load local worker state: '+ workerStateKey,
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      resolve(data ? JSON.parse(data) : defWorkerState);
    });
  });

  let workerStateSaving = false;
  let workerStateFutureSaving = false;
  const setWorkerState = (closing, lazy = false) => new Promise((resolve0, reject) => {
    const state = getWorkerInfo();
    if (worker_seq === 0) return resolve0(state);
    if (lazy && workerStateSaving) {
      workerStateFutureSaving = true;
      return Promise.resolve(state);
    }
    workerStateSaving = true;

    let workerStateKey = workerStatePrefix + worker_seq;
    const resolve = () => {
      workerStateSaving = false;
      if (lazy && workerStateFutureSaving) {
        setWorkerState(closing).then((state) => {
          workerStateFutureSaving = false;
          resolve0(state);
        });
      } else {
        resolve0(state);
      }
    };

    if (closing && worker_type === BUCKET_WORKER_TYPE_OLD && Object.keys(inProcess).length === 0) {
      redisClient.del(workerStateKey, (error) => {
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
    } else {
      redisClient.set(workerStateKey, JSON.stringify(state), (error) => {
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
    }
  });

  const setWorkerInfo = (worker, type) => {
    last_seq = worker.last_seq;
    inProcess = worker.inProcess;
    worker_type = type;
  }; // set worker info loaded from state
  const getWorkerInfo = () => ({
    ddocs: ddocsInfo,
    last_seq,
    inProcess
  }); // generate Object with worker state

  const init = () => {
    getBucketState() // load state
      .then(initDDocs) // init ddocs from state or latest in db
      .then(onInitDDocs) // call _onInit
      .then(startInProcessChanges) // start old changes from loaded state
      .then(subscribeChanges) // if worker old - start load changes else subscribe on changes feed
      .catch(onInitError) // catch errors on initialisation
      .then(processQueue); // start process queue
  }; // init bucket-worker
  const onInitError = (error) => {
    log({
      message: 'Error on init db: '+ name,
      event: BUCKET_ERROR,
      error
    });
    close();
  }; // catch errors on initialisation

  const subscribeChanges = () => worker_type === BUCKET_WORKER_TYPE_OLD ? startChanges() : startFeed();

  const initDDocs = (workers) => {
    if (worker_seq > 0 && !(workers && workers.length > 0 && !!~workers.indexOf(worker_seq))) {
      return Promise.reject(new Error('No db watcher by seq: '+ worker_seq));
    }

    if (worker_seq > 0) {
      const workerIndex = workers.indexOf(worker_seq);
      if (workerIndex > 0) {
        max_seq = workers[workerIndex - 1];
        return getWorkerState().then(workerState => {
          setWorkerInfo(workerState, BUCKET_WORKER_TYPE_OLD);
          return Promise.all(workerState.ddocs.map(initDDoc));
        });
      }
    }

    // Init latest worker
    return Promise.all(Object.keys(props.ddocs)
      .map(key => initDDoc({ name: key, methods: props.ddocs[key] })))
      .then(() => {
        let workerIndex = -1;
        workers.forEach((workerSeq, index) => {
          if (worker_seq === workerSeq) workerIndex = index;
          else _onOldWorker({ seq: workerSeq });
        });
        if (workerIndex >= 0) {
          return getWorkerState().then(workerState => setWorkerInfo(workerState, BUCKET_WORKER_TYPE_ACTUAL));
        }
      })
      .then(() => last_seq = last_seq || (worker_seq ? worker_seq : 'now'));
  };
  const initDDoc = (data) => new Promise(resolve => {
    const { name, rev } = data;
    const methods = Object.isArray(data.methods)
      ? data.methods
      : Object.isString(data.methods)
        ? data.methods.split(/\s+/g).compact(true).unique()
        : [];
    const ddoc = new DDoc(db, props.name, { name, rev, methods, logger });

    ddoc.init()
      .then(data => {
        if (worker_seq < data.seq) worker_seq = data.seq;
        ddocs.push(ddoc);
      })
      .catch(error => {
        log({
          message: 'Error on init ddoc: '+ name,
          event: DDOC_ERROR,
          error
        });
      })
      .finally(resolve);
  }); // create & load ddoc
  const onInitDDocs = () => {
    ddocsInfo = ddocs.map((ddoc, index) => {
      ddocs_index[ddoc.name] = index;
      return ddoc.getInfo();
    });
    _onInit({ seq: worker_seq, type: worker_type });
    return setBucketState().then(setWorkerState);
  }; // then all ddocs started call _onInit

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
        while (i--) if ((change = changes.results[i]) && change.seq < max_seq) onChange(change);
      }
      resolve();
    });
  }); // load changes since last_seq with limit (max_seq - last_seq) and skip changes with seq greater then max_seq => push changes in queue
  const startInProcessChanges = () => Promise.each(Object.keys(inProcess).sort((a, b) => a - b), addProcessToQueue); // sort old processes and call addProcessToQueue
  const addProcessToQueue = (processSeq) => new Promise((resolve, reject) => {
    const [ id, rev ]= inProcess[processSeq];
    db.get(id, { rev }, (error, doc) => {
      if (error) return reject(error);
      onChange(newChange(processSeq, id, rev, doc));
      return resolve();
    });
  }); // load old process document and push it to queue
  const newChange = (seq, id, rev, doc) => ({ seq, id, doc, changes: [ { rev } ] }); // make queue change item from process

  // start feed from last_seq
  const startFeed = () => {
    log({
      message: 'Start feed '+ worker_seq +' since: '+ last_seq,
      event: BUCKET_FEED
    });
    feed = db.follow({ since: last_seq, include_docs: true });
    feed.on('change', change => onChange(change, true));
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
  const onChange = (change, processNow = false) => {
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

    const hooks = [];
    let i = 0, i_max;
    let hook;

    // Document
    if (seq in inProcess) {
      // Old change
      const hooksInProcess = inProcess[seq][CHANGE_DOC_HOOKS];
      if ((i_max = hooksInProcess.length) > 0) {
        // load hooks for old change
        let ddoc, ddocKey, hookKey;
        while (i < i_max) {
          [ddocKey, hookKey] = hooksInProcess[i++].split('/');
          if (ddocs_index[ddocKey] >= 0 && (ddoc = ddocs[ddocs_index[ddocKey]]) && (hook = ddoc.getHook(hookKey))) {
            hooks.push(hook);
          }
        }
      } else {
        // clean empty change
        delete inProcess[seq];
      }
    } else {
      // New change
      if (!last_seq < seq) last_seq = seq;
      if ((i_max = ddocs.length) > 0) {
        let ddocHooks, k, k_max;
        while (i < i_max) {
          ddocHooks = ddocs[i++].filter(change);
          if (k_max = ddocHooks.length) {
            k = 0;
            while (k < k_max) if (hook = ddocHooks[k++]) {
              hooks.push(hook);
              setInProcess(change, hook.name);
            }
          }
        }
      }
    }

    if (hooks.length) {
      queue.push([change, hooks]);
      if (processNow) processQueue();
    }
  };

  // load & remove first task from queue, if doc is ddoc -> run onDDoc else run onDoc
  const processQueue = () => {
    if (queue.length === 0) return onEndQueue();
    if (changesCounter < changesStackThrottle) {
      const [change, hooks] = queue.shift();
      if (change && hooks) {
        changesCounter++;
        Promise.each(hooks, hook => startHook(change, hook)).then(() => {
          changesCounter--;
          processQueue();
        });
      }
    }
  };

  const addProcess = ({ id, seq }, name, hook) => {
    const sequences = hookProcesses.get(id) || new Map();
    const processes = sequences.has(seq) ? sequences.get(seq) : new Map();
    processes.set(name, hook);
    sequences.set(seq, processes);
    hookProcesses.set(id, sequences);
    return hook;
  };
  const removeProcess = ({ id, seq }, hookName) => {
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
  const getPreviousProcess = ({ id, seq }, hookName) => {
    const sequences = hookProcesses.get(id);
    if (!(sequences && sequences.size > 0)) return [];
    let processes, hook, last;
    for (let proc_seq of sequences.keys()) {
      if (proc_seq < seq && (processes = sequences.get(proc_seq)) && (hook = processes.get(hookName))) last = hook;
      else break;
    }
    return last;
  };
  const hasFutureProcess = ({ id, seq }, hookName) => {
    const sequences = hookProcesses.get(id);
    if (sequences && sequences.size > 0) {
      let processes;
      for (let proc_seq of sequences.keys()) {
        if (proc_seq > seq && (processes = sequences.get(proc_seq)) && processes.has(hookName)) return true;
      }
    }
    return false;
  };

  // start hook on change
  const startHook = (change, hook) => {
    const hookName = hook.name;
    const hook_run_chain = ['hook-run', hookName, 'seq-'+ change.seq];
    DEBUG && logger.performance.start(Date.now(), hook_run_chain);

    const hookPromise = () => {
      if (hook.mode === 'transitive' && hasFutureProcess(change, hookName)) {
        log({
          message: 'Skip hook: '+ hookName,
          ref: change.id,
          event: HOOK_SKIP
        });
        return Promise.resolve();
      }

      log({
        message: 'Start hook: '+ hookName,
        ref: change.id,
        event: HOOK_START
      });

      return hook.handler(Object.clone(change.doc, true)) // run hook with cloned doc
        .then((result = {}) => {
          const { message, docs } = result;
          if (Object.isString(message)) {
            log({
              message: 'Hook result: '+ hookName +' = '+ message,
              code: result.code,
              ref: change.id,
              event: HOOK_RESULT
            });
          }
          if (Object.isArray(docs) && docs.length > 0) { // check hook results
            return saveResults(db, docs).then(() => log({
              message: 'Saved hook results: '+ hookName,
              ref: change.id,
              event: HOOK_SAVE
            }));
          }
        })
        .catch(error => log({
          message: 'Hook error: '+ hookName,
          ref: change.id,
          event: HOOK_ERROR,
          error: lib.errorBeautify(error)
        }));
    };

    let hookProcess;
    // dependencies for transitive or sequential mode
    if (hook.mode === 'transitive' || hook.mode === 'sequential') {
      const previous = getPreviousProcess(change, hookName);
      if (previous) hookProcess = addProcess(change, hookName, previous.then(hookPromise));
    }
    // if parallel or empty dependencies
    if (!hookProcess) hookProcess = addProcess(change, hookName, hookPromise());

    return hookProcess.then(() => {
      // in final remove hook-change from processes
      removeProcess(change, hookName);
      setOutProcess(change, hookName);
      // update bucket-worker state
      setWorkerState(false, true);
      DEBUG && logger.performance.end(Date.now(), hook_run_chain);
    });
  };

  const close = () => {
    stopFeed(); // previously stop feed
    queue.length = 0;
    if (isRunning()) return setTimeout(close, CHECK_PROCESSES_TIMEOUT); // if worker has tasks wait
    log({
      message: 'Close',
      event: BUCKET_CLOSE
    });
    setBucketState(true).then(() => setWorkerState(true)).then(() => _onClose(worker_seq));
  }; // start close if bucket-worker and call _onClose

  return { init, close, isRunning };
}

module.exports = Bucket;
