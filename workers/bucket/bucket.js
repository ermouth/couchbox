const Promise = require('bluebird');
const lib = require('../../utils/lib');
const Logger = require('../../utils/logger');
const couchdb = require('../../utils/couchdb');
const saveResults = require('../../utils/resultsSaver');
const config = require('../../config');
const DDoc = require('./ddoc');


const CHECK_PROCESSES_TIMEOUT = 120;
const CHANGE_DOC_ID = 0;
const CHANGE_DOC_REV = 1;
const CHANGE_DOC_HOOKS = 2;

const {
  LOG_EVENT_BUCKET_FEED, LOG_EVENT_BUCKET_FEED_STOP, LOG_EVENT_BUCKET_CHANGES, LOG_EVENT_BUCKET_CLOSE, LOG_EVENT_BUCKET_ERROR,
  LOG_EVENT_BUCKET_DDOC_STOP, LOG_EVENT_DDOC_ERROR,
  LOG_EVENT_HOOK_START, LOG_EVENT_HOOK_RESULT, LOG_EVENT_HOOK_SAVE, LOG_EVENT_HOOK_ERROR
} = require('../../constants/logEvents');

const { BUCKET_WORKER_TYPE_ACTUAL, BUCKET_WORKER_TYPE_OLD } = require('./constants');

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
    if (inProcess.hasOwnProperty(seq)) {
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
    if (inProcess.hasOwnProperty(seq)) {
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
          event: LOG_EVENT_BUCKET_ERROR,
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
          event: LOG_EVENT_BUCKET_ERROR,
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
      event: LOG_EVENT_BUCKET_ERROR,
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
    const ddoc = new DDoc(db, { name, rev, methods, logger });
    ddoc.init()
      .then(data => {
        if (worker_seq < data.seq) worker_seq = data.seq;
        ddocs.push(ddoc);
        return Promise.resolve();
      })
      .catch(error => {
        log({
          message: 'Error on init ddoc: '+ name,
          event: LOG_EVENT_DDOC_ERROR,
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
      event: LOG_EVENT_BUCKET_CHANGES
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
  const startInProcessChanges = () => Promise.all(Object.keys(inProcess).sort((a, b) => a - b).map(addProcessToQueue)); // sort old processes and call addProcessToQueue
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

  const startFeed = () => {
    log({
      message: 'Start feed '+ worker_seq +' since: '+ last_seq,
      event: LOG_EVENT_BUCKET_FEED
    });
    feed = db.follow({ since: last_seq, include_docs: true });
    feed.on('change', onChange);
    feed.follow();
    _onStartFeed();
  }; // start feed from last_seq
  const stopFeed = () => {
    if (hasFeed()) {
      log({
        message: 'Stop feed',
        event: LOG_EVENT_BUCKET_FEED_STOP
      });
      feed.stop();
      _onStopFeed();
    }
  }; // stop feed and call _onStopFeed

  const onEndQueue = () => !hasFeed() && close(); // call after process last item in queue and start close if no feed

  const onChange = (change) => {
    queue.push(change);
    return processQueue();
  }; // on change event push it to queue and run process queue
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
  }; // load & remove first task from queue, if doc is ddoc -> run onDDoc else run onDoc

  const onDDoc = (change) => {
    const ddocName = change.id.split('/')[1];
    if (ddocName && props.ddocs[ddocName]) {
      log({
        message: 'Stop on ddoc change: '+ ddocName,
        event: LOG_EVENT_BUCKET_DDOC_STOP
      });
      worker_type = BUCKET_WORKER_TYPE_OLD;
      return close();
    } else {
      return processQueue();
    }
  }; // if ddoc included in current bucket start closing worker else process next task
  const onDoc = (change) => {
    const { seq } = change;
    if (inProcess[seq]) {
      return onOldChange(inProcess[seq][CHANGE_DOC_HOOKS], change);
    } else {
      return onNewChange(change);
    }
  };  // check if change is old (in processes from state) run onOldChange else run onNewChange
  const onNewChange = (change) => {
    const { seq } = change;

    if (!last_seq < seq) last_seq = change.seq;

    const hooksAll = ddocs.map(ddoc => ddoc.filter(change)).reduce((a,b) => a.concat(b));
    if (!hooksAll.length) return updateDBState();

    hooksAll.forEach(hook => setInProcess(change, hook.name));
    return updateDBState().then(() => Promise.all(hooksAll.map(startHook.fill(change))));
  }; // filter hooks by doc, push they in process list, update bucket-worker state and run
  const onOldChange = (hooksNames, change) => {
    const hooksAll = [];

    hooksNames.map(hookNameFull => {
      const hookName = hookNameFull.split('/');
      const ddoc = ddocksO[hookName[0]] >= 0 ? ddocs[ddocksO[hookName[0]]] : null;
      if (ddoc) {
        const hook = ddoc.getHook(hookName[1]);
        if (hook && hook.isGood) hooksAll.push(hook);
      }
    });

    return hooksAll.length
      ? Promise.all(hooksAll.map(startHook.fill(change)))
      : Promise.reject(new Error('Bad hooks'));
  }; // start not completed hooks from process for change

  const startHook = (change, hook) => new Promise((resolve) => {
    log({
      message: 'Start hook: ' + hook.name,
      ref: change.id,
      event: LOG_EVENT_HOOK_START
    });
    hook.run(change) // run hook
      .then(onHook.fill(hook.name, change)) // if ok run onHook
      .catch(onHookError.fill(hook.name, change)) // else run onHookError
      .finally(() => {
        setOutProcess(change, hook.name);
        updateDBState().then(resolve);
      }); // in final remove hook-change from processes and update bucket-worker state
  }); // start hook on change
  const onHook = (hookName, change, result) => {
    log({
      message: result.message || result.docs,
      code: result.code,
      ref: change.id,
      event: LOG_EVENT_HOOK_RESULT
    });
    if (result && result.code === 200 && result.docs) { // check hook results
      if (result.docs.length) {
        return saveResults(db, result.docs).then(() => { // save results
          log({
            message: 'Saved hook results: ' + hookName,
            ref: change.id,
            event: LOG_EVENT_HOOK_SAVE
          });
          return Promise.resolve();
        });
      }
      return Promise.resolve(); // empty results
    }
    return Promise.reject(new Error('Bad hook result')); // bad results
  }; // then hook done
  const onHookError = (hookName, change, error) => {
    log({
      message: 'Hook error: ' + hookName,
      ref: change.id,
      event: LOG_EVENT_HOOK_ERROR,
      error: lib.errorBeautify(error)
    });
    return Promise.resolve();
  }; // log hook error

  const close = () => {
    stopFeed(); // previously stop feed
    if (isRunning()) return setTimeout(close, CHECK_PROCESSES_TIMEOUT); // if worker has tasks wait
    log({
      message: 'Close',
      event: LOG_EVENT_BUCKET_CLOSE
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
