const config = require('../config');

const Promise = require('bluebird');
const lib = require('../lib');
const Logger = require('../utils/log');

const couchdb = require('../couchdb');
const DDoc = require('./ddoc');


function DB(name, ddocs, props = {}) {
  const { conf } = props;
  const logger = new Logger({
    prefix: 'DB '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  const _onProcess = props.onProcess || new Function();
  const _onEnd = props.onEnd || new Function();
  const _onStopFollow = props.onStopFollow || new Function();
  const _onClose = props.onClose || new Function();

  const db = couchdb.connect(name);
  const _ddocs = {};
  let _ddocsKeys = [];

  const state = {
    queue: [],
    activeHooks: 0,
    seq: 0
  };

  let started = false;
  let feed;

  function isStarted() {
    return !!started;
  }
  function hasFeed() {
    return feed && !feed.dead;
  }
  function hasTasks() {
    return !!state.queue.length;
  }
  function hasProcesses() {
    return !!state.activeHooks;
  }

  function init(since = 'now') {
    log('Init');
    feed = db.follow({ since, include_docs: true });
    return Promise.all(Object.keys(ddocs).map(_ddocMap))
        .catch(_onDDocsError)
        .then(_onDDocsReady)
  }

  const close = function _close(callback) {
    if (hasFeed()) {
      log('Stop feed');
      feed.stop();
      _onStopFollow(state.seq);
    }
    if (hasTasks() || hasProcesses()) {
      setTimeout(() => { _close(callback); }, 100);
    } else {
      started = false;
      log('Close');
      _onClose(state.seq);
      if (callback) callback();
    }
  };

  function _ddocMap(ddocKey) {
    _ddocs[ddocKey] = new DDoc(db, ddocKey, ddocs[ddocKey], { logger, conf });
    return _ddocs[ddocKey].init();
  }

  function _onDDocsError(error) {
    log({ error });
  }
  function _onDDocsReady(ddocsRes) {
    started = true;
    _ddocsKeys = ddocsRes;
    feed.on('change', _onDocChange);
    feed.follow();
  }

  function _onDocChange(change) {
    state.seq = change.seq;
    if (/_design\//.test(change.id)) {
      return _onDDoc(change);
    } else {
      return _onDoc(change);
    }
  }

  function _onDDoc(change) {
    log('Stop on ddoc change');
    _onEnd(state.seq);
    close();
  }

  function _onDoc(change) {
    state.queue.push(change);
    _processQueue();
  }

  function _processQueue() {
    if (hasTasks()) _processChange(state.queue.shift());
  }

  function _processChange(change) {
    _ddocsKeys.map(ddocKey => _ddocs[ddocKey].filter(change)).forEach(hooks =>
      hooks.forEach(hook => {
        state.activeHooks++;
        hook.run(change)
            .catch(_onHookError)
            .then(_onHookResult);
      })
    );
  }

  function _onHookError(error) {
    log({ error });
  }

  function _onHookResult(result) {
    state.activeHooks--;
    if (result && result.code === 200) {

    }
    log('Hooks: '+ state.activeHooks);
  }

  return {
    init, close,
    isStarted, hasFeed, hasTasks, hasProcesses
  };
}

module.exports = DB;
