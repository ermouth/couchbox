const Promise = require('bluebird');
const couchdb = require('../couchdb');
const DDoc = require('./ddoc');
const lib = require('../lib');
const log = lib.log;

class DB {
  constructor(name) {
    this.name = name;
    this.ddocs = {};
    this.ddocsIndex = [];

    this.changesQueue = [];
    this.changesTask = null;
    this.inProcess = false;

    const db = this.db = couchdb.use(name);
    const feed = db.follow({ since: 'now', include_docs: true });
    feed.on('change', this.onChange.bind(this));
    feed.follow();
  }

  onChange(change) {
    this.changesQueue.push(change);
    this.processQueue();
  }

  onDdocResults(ddocKey, results) {
    return new Promise((resolve, reject) => {
      log(`Ddoc results: ${ddocKey}`);
      log(results);
      // TODO: proccess results
      resolve(results);
    });
  }

  processDesign(change) {
    const ddocKey = change.id.split('/')[1];

    if (!change.doc) {
      // Stop and remove exiting ddoc
      log(`Remove ddoc: ${ddocKey}`);
      this.stopDDoc(ddocKey)
        .catch(stopErr => {
          if (stopErr) log(stopErr);
          this.onProcess();
        })
        .then(stopRes => {
          if (stopRes) log(`Good stop ddoc: ${ddocKey}`);
          this.onProcess();
        });
    }
    else if (this.existDDoc(ddocKey)) {
      // Update exiting ddoc
      log(`Update ddoc: ${ddocKey}`);
      this.ddocs[ddocKey].stop().then(stopRes => {
          return this.ddocs[ddocKey].update();
        })
        .catch(updateErr => {
          if (updateErr) log(updateErr);
          this.onProcess();
        })
        .then(updateRes => {
          if (updateRes) log(`Good update ddoc: ${ddocKey}`);
          this.onProcess();
        });
    } else {
      // Create new ddoc
      log(`Add ddoc: ${ddocKey}`);
      this.addDDoc(ddocKey)
        .catch(createErr => {
          if (createErr) log(createErr);
          this.onProcess();
        })
        .then(createRes => {
          if (createRes) log(`Good create ddoc: ${ddocKey}`);
          this.onProcess();
        });
    }
  }

  processDoc(change) {
    log('On doc change');
    Promise.all(this.ddocsIndex.map(ddocKey =>
      Promise.all(this.ddocs[ddocKey].onChange(change)).then(results => this.onDdocResults(ddocKey, results))
    ))
      .catch(processErr => {
        if (processErr) log('Error doc change');
        this.onProcess();
      })
      .then(processRes => {
        if (processRes) log('Result doc change');
        this.onProcess();
      });
  }

  processQueue() {
    log(`On processQueue`);
    if (this.inProcess) return null;
    const change = this.changesTask = this.changesQueue.shift();
    if (!change) return null;
    this.inProcess = true;

    if (/_design\//.test(change.id)) {
      return this.processDesign(change);
    } else {
      return this.processDoc(change);
    }
  }

  onProcess(change) {
    log(`End process`);
    this.inProcess = false;
    this.processQueue();
  }

  existDDoc(ddocKey) {
    return !!this.ddocs[ddocKey];
  }
  createDDoc(ddocKey, props = []) {
    this.ddocs[ddocKey] = new DDoc(this.db, ddocKey, props);
    this.ddocsIndex.push(ddocKey);
    return this.ddocs[ddocKey].update();
  }
  stopDDoc(ddocKey) {
    if (!this.ddocs[ddocKey]) return null;
    return this.ddocs[ddocKey].stop().then(stopRes => {
      log(`Good stop ddoc: ${ddocKey}`);
      const ddocIndex = this.ddocsIndex.indexOf(ddocKey);
      if (!!~ddocIndex) {
        this.ddocsIndex = this.ddocsIndex.slice(0, ddocIndex).concat(this.ddocsIndex.slice(ddocIndex + 1));
        this.ddocs[ddocKey] = null;
      }
      return Promise.resolve(true);
    })
  }
  addDDoc(ddocKey, props = []) {
    if (this.existDDoc(ddocKey)) {
      return this.stopDDoc(ddocKey).then(() => {
        return this.createDDoc(ddocKey, props);
      });
    }
    return this.createDDoc(ddocKey, props);
  }
}

module.exports = DB;
