const Promise = require('bluebird');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
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
  const dbDocId = '_local/' + name;
  let dbDocRev;

  const ddocs = [];
  const ddocksO = {}; // ddocs id=>index in ddocs
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
      inProcess[seq][CHANGE_DOC_HOOKS].push(hook);
      inProcess[seq][CHANGE_DOC_HOOKS] = inProcess[seq][CHANGE_DOC_HOOKS].unique();
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
  const getDBState = () => new Promise((resolve, reject) => {
    db.get(dbDocId, function(error, body) {
      if (error && error.message !== 'missing') {
        log({
          message: 'Error on load local bucket state: '+ dbDocId,
          event: BUCKET_ERROR,
          error
        });
        return reject(error);
      }
      if (body && body._rev) {
        dbDocRev = body._rev;
        return resolve(body && body.data ? lib.parseJSON(body.data) || {} : {});
      }
      resolve({});
    });
  }); // load db state from _local/{bucket} document

  const updateDBState = (closing) => new Promise((resolve, reject) => getDBState().then(state => {
    if (worker_seq === 0) return resolve(); // if no one ddoc - not save state
    if (closing && worker_type === BUCKET_WORKER_TYPE_OLD) { // if gracefully close old worker - remove it from db state
      delete state[worker_seq];
    } else {
      state[worker_seq] = getWorkerInfo();
    }

    const newData = dbDocRev
      ? { _id: dbDocId, _rev: dbDocRev, data: JSON.stringify(state) }
      : { _id: dbDocId, data: JSON.stringify(state) };

    db.insert(newData, function(error, body) {
      if (error || body.ok !== true) {
        if (error && error.message === 'Document update conflict.') return updateDBState().then(resolve);
        log({
          message: 'Error on save bucket state',
          event: BUCKET_ERROR,
          error
        });
        reject(error);
      } else {
        dbDocRev = body.rev;
        resolve(body);
      }
    });
  }));// patching _local/{bucket} with worker state
  const updateDBStateLazy = updateDBState.debounce(200);

  const init = () => {
    getDBState() // load state
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

  const initDDocs = (state) => {
    if (worker_seq > 0 && !state[worker_seq]) return Promise.reject(new Error('No db watcher by seq: '+ worker_seq));

    const workers = Object.keys(state).sort((a, b) => a - b).reverse().map(seq => +seq);

    if (worker_seq) {
      // search worker in state
      const workerIndex = workers.indexOf(worker_seq);
      // Init exist worker
      if (workerIndex > 0) {
        max_seq = workers[workerIndex - 1];
        const worker = state[worker_seq];
        setWorkerInfo(worker, BUCKET_WORKER_TYPE_OLD);
        return Promise.all(worker.ddocs.map(initDDoc));
      }
    }

    // Init latest worker
    return Promise.all(Object.keys(props.ddocs)
      .map(key => initDDoc({ name: key, methods: props.ddocs[key] })))
      .then(() => {
        workers.forEach((workerSeq) => {
          if (worker_seq === workerSeq) setWorkerInfo(state[workerSeq], BUCKET_WORKER_TYPE_ACTUAL);
          else _onOldWorker({ seq: workerSeq });
        });
        if (!last_seq) {
          last_seq = worker_seq ? worker_seq : 'now';
        }
        return Promise.resolve();
      });
  };
  const initDDoc = (data) => new Promise(resolve => {
    const { name, rev } = data;
    const methods = Object.isArray(data.methods) ? data.methods
      : Object.isString(data.methods) ? data.methods.split(/\s+/g).compact(true).unique() : [];
    const ddoc = new DDoc(db, props.name, { name, rev, methods, logger });
    ddoc.init()
      .then(data => {
        if (worker_seq < data.seq) worker_seq = data.seq;
        ddocs.push(ddoc);
        return Promise.resolve();
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
      ddocksO[ddoc.name] = index;
      return ddoc.getInfo();
    });
    _onInit({ seq: worker_seq, type: worker_type });
    return updateDBState();
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
        changes.results.forEach(change => change && change.seq < max_seq && onChange(change, false));
      }
      resolve();
    });
  }); // load changes since last_seq with limit (max_seq - last_seq) and skip changes with seq greater then max_seq => push changes in queue
  const startInProcessChanges = () => Promise.each(Object.keys(inProcess).sort((a, b) => a - b), addProcessToQueue); // sort old processes and call addProcessToQueue
  const addProcessToQueue = (processSeq) => new Promise((resolve, reject) => {
    const procItem = inProcess[processSeq];
    const id = procItem[CHANGE_DOC_ID];
    const rev = procItem[CHANGE_DOC_REV];
    db.get(id, { rev }, (error, doc) => {
      if (error) return reject(error);
      onChange(newChange(processSeq, id, rev, doc), false);
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

    // Document
    const hooksInProcess = inProcess[seq] ? inProcess[seq][CHANGE_DOC_HOOKS] : [];
    const hooks = [];
    let i = 0, i_max = hooksInProcess.length, hook;
    if (hooksInProcess.length) {
      // old processes
      let ddoc, hookName;
      while (i < i_max) {
        hookName = hooksInProcess[i++].split('/');
        if (ddocksO[hookName[0]] >= 0 && (ddoc = ddocs[ddocksO[hookName[0]]]) && (hook = ddoc.getHook(hookName[1]))) {
          hooks.push(hook);
        }
      }
    } else {
      // change without old processes
      if (!last_seq < seq) last_seq = seq;
      i_max = ddocs.length;
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
      updateDBStateLazy();
    }
    if (hooks.length) {
      queue.push([change, hooks]);
      if (processNow) processQueue();
    }
  };

  // load & remove first task from queue, if doc is ddoc -> run onDDoc else run onDoc
  const processQueue = () => {
    if (queue.length === 0) return onEndQueue();
    if (changesCounter > changesStackThrottle) return Promise.resolve();
    onQueueChange(queue.shift());
  };

  const onQueueChange = ([change, hooks]) => {
    if (!change || !hooks.length) return Promise.resolve();
    changesCounter++;
    Promise.each(hooks, hook => startHook(change, hook)).then(() => {
      changesCounter--;
      processQueue();
    });
  };

  const addProcess = ({ id, seq }, name, hook) => {
    const sequences = hookProcesses.get(id) || new Map();
    const processes = sequences.has(seq) ? sequences.get(seq) : new Map();
    processes.set(name, hook);
    sequences.set(seq, processes);
    hookProcesses.set(id, sequences);
    return hook;
  };
  const removeProcess = (change, hookName) => {
    const sequences = hookProcesses.get(change.id);
    if (sequences) {
      const processes = sequences.get(change.seq);
      if (processes && processes.has(hookName)) {
        if (processes.size === 1) {
          if (sequences.size === 1) hookProcesses.delete(change.id);
          else sequences.delete(change.seq);
        }
        else processes.delete(hookName);
      }
    }
  };
  const getDownProcesses = (change, hookName) => {
    const sequences = hookProcesses.get(change.id);
    if (!(sequences && sequences.size > 0)) return [];
    const res = [];
    let processes, hook;
    for (let seq of sequences.keys()) {
      if (seq < change.seq && (processes = sequences.get(seq)) && (hook = processes.get(hookName))) res.push(hook);
    }
    return res;
  };
  const hasFutureProcess = (change, hookName) => {
    const sequences = hookProcesses.get(change.id);
    if (sequences && sequences.size > 0) {
      let processes;
      for (let seq of sequences.keys()) {
        if (seq > change.seq && (processes = sequences.get(seq)) && processes.has(hookName)) return true;
      }
    }
    return false;
  };

  // start hook on change
  const startHook = (change, hook) => {
    const hook_run_chain = ['hook-run', hook.name, 'seq-'+ change.seq];
    DEBUG && logger.performance.start(Date.now(), hook_run_chain);
    const hookPromise = () => new Promise((resolve) => {
      const hookKey = '"'+ hook.name +'"'; // + ' doc: ' + change.id + (change.doc && change.doc._rev ? ':'+change.doc._rev : '');

      const doneHook = (logEvent) => {
        if (logEvent) log(logEvent);
        // in final remove hook-change from processes and update bucket-worker state
        setOutProcess(change, hook.name);
        updateDBStateLazy();
        // clean hook processes
        removeProcess(change, hook.name);
        DEBUG && logger.performance.end(Date.now(), hook_run_chain);
        resolve();
      };

      if (hook.mode === 'transitive' && hasFutureProcess(change, hook.name)) {
        return doneHook({
          message: 'Skip hook: '+ hookKey,
          ref: change.id,
          event: HOOK_SKIP
        });
      }

      log({
        message: 'Start hook: '+ hookKey,
        ref: change.id,
        event: HOOK_START
      });

      hook.handler(Object.clone(change.doc, true)) // run hook with cloned doc
        .then((result = {}) => {
          const { message, docs } = result;
          if (Object.isString(message)) {
            log({
              message: 'Hook result: '+ hookKey +' = '+ message,
              code: result.code,
              ref: change.id,
              event: HOOK_RESULT
            });
          }
          if (Object.isArray(docs) && docs.length) { // check hook results
            return saveResults(db, docs).then(() => doneHook({
              message: 'Saved hook results: '+ hookKey,
              ref: change.id,
              event: HOOK_SAVE
            }));
          } else {
            return doneHook(); // empty results
          }
        })
        .catch(error => doneHook({
          message: 'Hook error: ' + hookKey,
          ref: change.id,
          event: HOOK_ERROR,
          error: lib.errorBeautify(error)
        }))
    });

    // dependencies for transitive or sequential mode
    if (hook.mode === 'transitive' || hook.mode === 'sequential') {
      const dependencies = getDownProcesses(change, hook.name);
      if (dependencies && dependencies.length) return addProcess(change, hook.name, dependencies.last().then(hookPromise));
    }
    // if parallel or empty dependencies
    return addProcess(change, hook.name, hookPromise());
  };

  const close = () => {
    stopFeed(); // previously stop feed
    queue.length = 0;
    if (isRunning()) return setTimeout(close, CHECK_PROCESSES_TIMEOUT); // if worker has tasks wait
    log({
      message: 'Close',
      event: BUCKET_CLOSE
    });
    updateDBState(true).then(() => _onClose(worker_seq));
  }; // start close if bucket-worker and call _onClose

  return { init, close, isRunning };
}

module.exports = Bucket;
