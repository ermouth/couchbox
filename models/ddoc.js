const Promise = require('bluebird');
const lib = require('../lib');
const log = lib.log;

const Filter = require('./filter');
const Hook = require('./hook');

class DDoc {
  constructor(db, name, props = []) {
    this.db = db;
    this.name = name;
    this.props = props;

    this.hooks = {};
    this.filters = {};
    this.filtersIndex = [];
  }

  update() {
    return new Promise((resolve, reject) => {
      this.db.get(`_design/${this.name}`, (err, body) => {
        if (err) {
          log(err);
          return reject(err);
        }
        if (this._rev === body._rev) {
          return reject(err);
        }

        if (body.filters) {
          this.filtersIndex = Object.keys(body.filters);
          this.filtersIndex.forEach(filterKey => {
            this.filters[filterKey] = new Filter(filterKey, body.filters[filterKey]);
          });
        }

        if (body.hooks) {
          Object.keys(body.hooks).forEach(filterKey => {
            if (this.filters[filterKey]) {
              const oldHook = this.hooks[filterKey];
              const hook = new Hook(body.hooks[filterKey]);
              if (oldHook) {
                if (oldHook.getHash() === hook.getHash()) return null;
                oldHook.end();
              }
              this.hooks[filterKey] = hook;
            }
          });
        }

        return resolve(true);
      });
    });
  }

  stop() {
    log(`Stop ddoc: ${this.name}`);
    return new Promise((resolve, reject) => {
      // TODO: stop process
      return resolve(true);
    });
  };

  onChange(change) {
    const filterHooks = this.filtersIndex.filter(filterKey => this.filters[filterKey].filter(change));
    return filterHooks.map(hookKey => this.hooks[hookKey].run(change));
  }
}

module.exports = DDoc;
