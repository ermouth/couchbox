const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');
const couchdb = require('../couchdb');
const DDoc = require('./ddoc');
const config = require('../config');


const CHECK_PROCESSES_TIMEOUT = 120;
const CHANGE_DOC_ID = 0;
const CHANGE_DOC_REV = 1;
const CHANGE_DOC_HOOKS = 2;


function DB(name, props = {}) {
  const logger = new Logger({ prefix: 'DB '+ name, logger: props.logger });
  const log = logger.getLog();

  const _onOldWorker = props.onOldWorker || new Function();
  const _onStartFeed = props.onStartFeed || new Function();
  const _onStopFeed = props.onStopFeed || new Function();
  const _onInit = props.onInit || new Function();
  const _onClose = props.onClose || new Function();

  const db = couchdb.connectDB(name);
  const dbDocId = '_local/' + name;
  let dbDocRev;

  const ddocs = [];
  const queue = [];
  let inProcess = {};
  let worker_seq = +(props.seq || 0);
  let last_seq = 0;
  let max_seq = 0;
  let ddocsInfo;
  let feed;
  let worker_type = 'actual';

  const hasFeed = () => !!feed && !feed.dead;
  const hasTasks = () => queue.length > 0 || Object.keys(inProcess).length > 0;
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
  };
  const setOutProcess = (change, hook) => {
    const { seq } = change;
    if (inProcess.hasOwnProperty(seq)) {
      inProcess[seq][CHANGE_DOC_HOOKS] = inProcess[seq][CHANGE_DOC_HOOKS].remove(hook);
      if (!inProcess[seq][CHANGE_DOC_HOOKS].length) delete inProcess[seq];
    }
  };

  const setWorkerInfo = (worker, type) => {
    last_seq = worker.last_seq;
    inProcess = worker.inProcess;
    worker_type = type;
  };
  const getWorkerInfo = () => ({
    ddocs: ddocsInfo,
    last_seq,
    inProcess
  });
  const getDBState = () => new Promise((resolve, reject) => {
    db.get(dbDocId, function(error, body) {
      if (error && error.message !== 'missing') {
        log({ message: 'Error on load local bucket state: '+ dbDocId, error });
        return reject(error);
      }
      if (body && body._rev) {
        dbDocRev = body._rev;
        return resolve(body && body.data ? lib.parseJSON(body.data) : {});
      }
      resolve({});
    });
  });
  const updateDBState = (closing) => new Promise((resolve, reject) => getDBState().then(state => {
    if (closing && worker_type === 'old') {
      delete state[worker_seq];
    } else {
      state[worker_seq] = getWorkerInfo();
    }

    const newData = dbDocRev
      ? { _id: dbDocId, _rev: dbDocRev, data: JSON.stringify(state) }
      : { _id: dbDocId, data: JSON.stringify(state) };

    db.insert(newData, function(error, body) {
      if (error || body.ok !== true) {
        if (error && error.message === 'Document update conflict.') {
          return updateDBState();
        }
        log({ message: 'Error on save bucket state', error });
        reject(error);
      } else {
        dbDocRev = body.rev;
        resolve(body);
      }
    });
  }));

  const init = () => {
    getDBState()
      .then(initDDocs)
      .then(onInitDDocs)
      .then(startInProcessChanges)
      .then(() => worker_type === 'old' ? startChanges() : startFeed())
      .catch(onInitError)
      .then(processQueue);
  };
  const onInitError = (error) => {
    log({ message: 'Error on init db: '+ name, error });
    close();
  };

  const initDDocs = (state) => {
    if (worker_seq > 0 && !state[worker_seq]) return Promise.reject(new Error('No db watcher by seq: '+ worker_seq));

    const workers = Object.keys(state).sort((a,b) => a - b).reverse().map(seq => +seq);

    if (worker_seq) {
      const workerIndex = workers.indexOf(worker_seq);
      // Init exist worker
      if (workerIndex > 0) {
        max_seq = workers[workerIndex - 1];
        const worker = state[worker_seq];
        setWorkerInfo(worker, 'old');
        return Promise.all(worker.ddocs.map(initDDoc));
      }
    }

    // Init latest worker
    return Promise.all(Object.keys(props.ddocs).map(key => initDDoc({ name: key, methods: props.ddocs[key] })))
      .then((sequences) => {
        worker_seq = sequences.sort((a,b)=>b-a)[0];
        workers.forEach((workerSeq) => {
          if (worker_seq === workerSeq) setWorkerInfo(state[workerSeq], 'actual');
          else _onOldWorker({ seq: workerSeq });
        });
        if (!last_seq) last_seq = worker_seq;
      });
  };
  const initDDoc = (data) => {
    const { name, rev, methods } = data;
    const ddoc = new DDoc(db, { name, rev, methods, logger });
    ddocs.push(ddoc);
    return ddoc.init();
  };
  const onInitDDocs = () => {
    ddocsInfo = ddocs.map(ddoc => ddoc.getInfo());
    _onInit({ seq: worker_seq });
    return updateDBState();
  };

  const startChanges = () => new Promise((resolve, reject) => {
    log('Start changes since '+ last_seq +' between: '+ max_seq);
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
  });
  const startInProcessChanges = () => Promise.all(Object.keys(inProcess).sort((a, b) => a - b).map(addProcessToQueue));
  const addProcessToQueue = (processSeq) => new Promise((resolve, reject) => {
    const id = inProcess[processSeq][CHANGE_DOC_ID];
    const rev = inProcess[processSeq][CHANGE_DOC_REV];
    db.get(id, { rev }, (error, doc) => {
      if (error) return reject(error);
      queue.push(newChange(processSeq, id, rev, doc));
      return resolve();
    });
  });

  const startFeed = () => {
    log('Start feed '+ worker_seq +' since: '+ last_seq);
    feed = db.follow({ since: last_seq, include_docs: true });
    feed.on('change', onChange);
    feed.follow();
    _onStartFeed();
  };
  const stopFeed = () => {
    if (hasFeed()) {
      log('Stop feed');
      feed.stop();
      _onStopFeed();
    }
  };

  const onEndQueue = () => !hasFeed() && close();

  const newChange = (seq, id, rev, doc) => ({ seq, id, doc, changes: [ { rev } ] });
  const onChange = (change) => {
    queue.push(change);
    return processQueue();
  };
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

  const onDDoc = (change) => {
    const ddocName = change.id.split('/')[1];
    if (ddocName && ddocs.length && ddocs.filter(ddoc => ddoc.name === ddocName).length) {
      log('Stop on ddoc change: '+ ddocName);
      worker_type = 'old';
      close();
    }
  };
  const onDoc = (change) => {
    const { seq } = change;
    if (inProcess[seq]) {
      return onOldChange(inProcess[seq][CHANGE_DOC_HOOKS], change);
    } else {
      return onNewChange(change);
    }
  };
  const onNewChange = (change) => {
    const { seq } = change;

    if (!last_seq < seq) last_seq = change.seq;

    const hooksAll = ddocs.map(ddoc => ddoc.filter(change)).reduce((a,b) => a.concat(b));
    if (!hooksAll.length) return updateDBState();

    hooksAll.forEach(hook => setInProcess(change, hook.name));
    return updateDBState().then(() => Promise.all(hooksAll.map(startHook.fill(change))));
  };
  const onOldChange = (hooksNames, change) => {
    const hooksAll = [];
    const ddocksO = {};
    ddocsInfo.forEach((ddoc, index) => {
      ddocksO[ddoc.name] = index;
    });

    hooksNames.map(hookNameFull => {
      const hookName = hookNameFull.split('/');
      const ddoc = ddocksO[hookName[0]] ? ddocs[ddocksO[hookName[0]]] : null;
      if (ddoc) {
        const hook = ddoc.getHook(hookName[1]);
        if (hook && hook.isGood()) hooksAll.push(hook);
      }
    });

    if (!hooksAll.length) return Promise.reject(new Error('Bad hooks'));
    return Promise.all(hooksAll.map(startHook.fill(change)));
  };

  const startHook = (change, hook) => {
    log('Start hook: ' + hook.name);
    return hook.run(change)
      .then(onHook.fill(hook.name, change))
      .catch(onHookError.fill(hook.name, change))
      .finally(() => {
        setOutProcess(change, hook.name);
        return updateDBState();
      });
  };
  const onHook = (hookName, change, result) => {
    if (result && result.code === 200 && result.docs) {
      if (!result.docs.length) {
        log('Empty hook results: ' + hookName);
        return Promise.resolve();
      } else {
        return saveResults(result.docs).then(() => {
          log('Saved hook result: ' + hookName);
        });
      }
    }
    return Promise.reject(new Error('Bad hook result'));
  };
  const onHookError = (hookName, change, error) => {
    log({ message: 'Hook error: '+ hookName, error });
  };

  const saveResults = (docs) => {
    if (docs && docs.length) return saveBatch(docs.shift()).then(() => saveResults(docs));
    return Promise.resolve();
  };
  const saveBatch = (toSave) => {
    if (Object.isObject(toSave)) return saveDoc(toSave);
    else if (Object.isArray(toSave)) return Promise.all(toSave.map(doc => saveDoc(doc)));
    else return Promise.reject(new Error('Bad results: ('+ JSON.stringify(toSave) +')'));
  };
  const saveDoc = (doc) => {
    if (!doc) return Promise.reject(new Error('Bad document'));
    let docDB = db;
    if (doc._db) {
      docDB = couchdb.connectDB(doc._db);
      delete doc['_db'];
    }
    return getOldDoc(docDB, doc).then(oldDoc => updateDoc(docDB, oldDoc, doc));
  };
  const getOldDoc = (docDB, doc) => new Promise((resolve, reject) => {
    const id = doc._id;
    const rev = doc._rev;
    if (!id && !rev) return resolve();
    docDB.get(id, rev ? { rev } : {}, (error, result) => {
      if (error) {
        if (error.error === 'not_found' && !rev) return resolve();
        return reject(error);
      }
      return resolve(result);
    });
  });
  const updateDoc = (docDB, oldDoc, newDoc) => new Promise((resolve, reject) => {
    if (oldDoc) newDoc._rev = oldDoc._rev;
    docDB.insert(newDoc, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    })
  });

  const close = () => {
    stopFeed();
    if (isRunning()) return setTimeout(close, CHECK_PROCESSES_TIMEOUT);
    log('Close');
    updateDBState(true).then(() => {
      _onClose(worker_seq);
    });
  };

  init();
  return { close, isRunning };
}

module.exports = DB;
