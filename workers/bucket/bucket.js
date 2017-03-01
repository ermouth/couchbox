const Promise = require('bluebird');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const couchdb = require('../../utils/couchdb');
const saveResults = require('../../utils/resultsSaver');
const config = require('../../config');
const DDoc = require('./ddoc');


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

function DB(props = {}) {
  const name = props.name;
  const logger = new Logger({ prefix: 'DB '+ name, logger: props.logger });
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
  const queue = []; // changes queue
  let inProcess = {}; // changes in process
  let worker_seq = +(props.seq || 0); // worker sequence - by latest ddoc seq
  let last_seq = 0; // sequence of last doc in queue
  let max_seq = 0; // max sequence - if worker is old then worker close on change with this sequence
  let ddocsInfo = [];
  let feed;
  let worker_type = BUCKET_WORKER_TYPE_ACTUAL;

  const hasFeed = () => !!feed && !feed.dead; // return true if worker has feed and feed is alive
  const hasTasks = () => queue.length > 0 || Object.keys(inProcess).length > 0; // return true if queue has tasks or worker has working processes
  const isRunning = () => hasFeed() || hasTasks();

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
  })); // patching _local/{bucket} with worker state

  const init = () => {
    getDBState() // load state
      .then(initDDocs) // init ddocs from state or latest in db
      .then(onInitDDocs) // call _onInit
      .then(startInProcessChanges) // start old changes from loaded state
      .then(() => worker_type === BUCKET_WORKER_TYPE_OLD ? startChanges() : startFeed()) // if worker old - start load changes else subscribe on changes feed
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
        changes.results.forEach(change => {
          if(change && change.seq < max_seq) queue.push(change);
        });
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
      queue.push(newChange(processSeq, id, rev, doc));
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

  const onEndQueue = () => !hasFeed() && close(); // call after process last item in queue and start close if no feed

  // on change event push it to queue and run process queue
  const onChange = (change) => {
    queue.push(change);
    return processQueue();
  };

  // load & remove first task from queue, if doc is ddoc -> run onDDoc else run onDoc
  const processQueue = () => {
    const change = queue.shift();
    if (change) {
      if (/_design\//.test(change.id)) {
        return onDDoc(change);
      } else {
        return onDoc(change).then(processQueue);
      }
    }
    else onEndQueue();
  };

  // if ddoc included in current bucket start closing worker else process next task
  const onDDoc = (change) => {
    const ddocName = change.id.substring(change.id.indexOf('/') + 1);
    if (ddocName && props.ddocs[ddocName]) {
      log({
        message: 'Stop on ddoc change: '+ ddocName,
        event: BUCKET_STOP
      });
      worker_type = BUCKET_WORKER_TYPE_OLD;
      return close();
    } else {
      return processQueue();
    }
  };

  // check if change is old (in processes from state) run onOldChange else run onNewChange
  const onDoc = (change) => {
    const { seq } = change;
    if (inProcess[seq]) {
      return onOldChange(inProcess[seq][CHANGE_DOC_HOOKS], change);
    } else {
      return onNewChange(change);
    }
  };

  // filter hooks by doc, push they in process list, update bucket-worker state and run
  const onNewChange = (change) => {
    const { seq } = change;

    if (!last_seq < seq) last_seq = change.seq;

    const hooksAll = ddocs.map(ddoc => ddoc.filter(change)).reduce((a,b) => a.concat(b));
    if (!hooksAll.length) return updateDBState();

    hooksAll.forEach(hook => setInProcess(change, hook.name));
    return updateDBState().then(() => Promise.all(hooksAll.map(hook => startHook(change, hook))));
  };

  // start not completed hooks from process for change
  const onOldChange = (hooksNames, change) => {
    const hooksAll = [];

    hooksNames.forEach(hookNameFull => {
      const hookName = hookNameFull.split('/');
      const ddoc = ddocksO[hookName[0]] >= 0 ? ddocs[ddocksO[hookName[0]]] : null;
      if (ddoc) {
        const hook = ddoc.getHook(hookName[1]);
        if (hook) hooksAll.push(hook);
      }
    });

    return hooksAll.length
      ? Promise.all(hooksAll.map(hook => startHook(change, hook)))
      : Promise.reject(new Error('Bad hooks'));
  };

  const hookProcesses = new Map();
  const addProcess = (change, hookName, proc) => {
    const sequences = hookProcesses.get(change.id) || new Map();
    const processes = sequences.get(change.seq) || new Map();
    processes.set(hookName, proc);
    sequences.set(change.seq, processes);
    hookProcesses.set(change.id, sequences);
    return proc.finally(() => {
      removeProcess(change, hookName);
    });
  };
  const removeProcess = (change, hookName) => {
    const sequences = hookProcesses.get(change.id);
    if (sequences) {
      const processes = sequences.get(change.seq);
      if (processes) {
        processes.delete(hookName);
        if (processes.size === 0) {
          sequences.delete(change.seq);
          if (sequences.size === 0) {
            hookProcesses.delete(change.id);
          }
        }
      } else {
        sequences.delete(change.seq);
      }
    } else {
      hookProcesses.delete(change.id);
    }
  };
  const getProcesses = (change, hookName, direction = 'down') => {
    const sequences = hookProcesses.get(change.id);
    const res = [];
    if (sequences && sequences.size) {
      for (let seq of sequences.keys()) {
        if (direction === 'down') {
          if (seq >= change.seq) continue;
        } else {
          if (seq <= change.seq) continue;
        }
        const processes = sequences.get(seq);
        if (processes && processes.size && processes.has(hookName)) {
          res.push(processes.get(hookName));
        }
      }
    }
    return res;
  };

  // start hook on change
  function startHook(change, hook) {
    const hookPromise = () => new Promise((resolve) => {
      const hookKey = '"'+ hook.name +'"'; // + ' doc: ' + change.id + (change.doc && change.doc._rev ? ':'+change.doc._rev : '');
      if (hook.mode === 'transitive') {
        const futures = getProcesses(change, hook.name, 'up');
        if (futures && futures.length) {
          log({
            message: 'Skip hook: '+ hookKey,
            ref: change.id,
            event: HOOK_SKIP
          });
          return resolve();
        }
      }
      log({
        message: 'Start hook: '+ hookKey,
        ref: change.id,
        event: HOOK_START
      });
      hook.handler(Object.clone(change.doc, true)) // run hook with cloned doc
        .then(result => {
          if (!result && (!result.message || !result.docs)) return Promise.reject(new Error('Bad hook result'));
          const { message, docs } = result;
          log({
            message: 'Hook result: '+ hookKey +' = '+ (message || docs),
            code: result.code,
            ref: change.id,
            event: HOOK_RESULT
          });
          if (Object.isArray(docs) && docs.length) { // check hook results
            return saveResults(db, docs).then(() => { // save results
              log({
                message: 'Saved hook results: '+ hookKey,
                ref: change.id,
                event: HOOK_SAVE
              });
              return Promise.resolve();
            });
          }
          return Promise.resolve(); // empty results
        })
        .catch(error => {
          log({
            message: 'Hook error: ' + hook.name,
            ref: change.id,
            event: HOOK_ERROR,
            error: lib.errorBeautify(error)
          });
        })
        .finally(resolve);
    }).then(() => {
      // in final remove hook-change from processes and update bucket-worker state
      setOutProcess(change, hook.name);
      return updateDBState();
    });


    switch (hook.mode) {
      case 'transitive':
      case 'sequential':
        const deps = getProcesses(change, hook.name);
        if (deps && deps.length) {
          return addProcess(change, hook.name, deps.last().then(hookPromise));
        }
      case 'parallel':
      default:
        return addProcess(change, hook.name, hookPromise());
    }
  }

  const close = () => {
    stopFeed(); // previously stop feed
    if (isRunning()) return setTimeout(close, CHECK_PROCESSES_TIMEOUT); // if worker has tasks wait
    log({
      message: 'Close',
      event: BUCKET_CLOSE
    });
    updateDBState(true).then(() => { // on close
      _onClose(worker_seq); // call _onClose
    });
  }; // start close if bucket-worker and call _onClose

  return {
    init, close,
    isRunning
  };
}

module.exports = DB;
