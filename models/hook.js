const Promise = require('bluebird');
const vm = require('vm');
const sugar = require('sugar');
const lib = require('../lib');
const log = lib.log;

const libContext = {
  Promise, setTimeout,
  log,
  isArray: Array.isArray
};

class Hook {
  onProps(props = {}) {
    const sum = lib.hash(props);
    if (this.md5sum === sum) return null;
    this.md5sum = sum;

    this.mode = props.mode || 'transitive';
    this.timeout = props.timeout || 10e3;
    this.since = props.since || 'now';
    this.attachments = props.attachments || false;
    this.conflicts = props.conflicts || false;

    this.compileLambda(props.lambda);
  }

  compileLambda(lambdaSrc) {
    if (lambdaSrc) {
      try {
        this.script = new vm.Script(`
          result = new Promise(function (resolve, reject) {
            return (${lambdaSrc}).call(lambdaScope, change);
          });
        `);
      } catch(e) {
        this.script = null;
        log(e);
      }
    }

    if (!this.script) {
      this.lambda = new Function();
      return null;
    }

    const lambdaScope = {};

    this.lambda = (change) => {
      const boxScope = Object.assign({}, libContext, {
        lambdaScope,
        change,
        result: null
      });
      const context = new vm.createContext(boxScope);
      this.script.runInContext(context);
      return boxScope.result;
    };
  }

  constructor(props = {}) {
    this.onProps(props);
  }

  getHash() {
    return this.md5sum;
  }

  run(change) {
    return this.lambda(change).timeout(this.timeout);
  }

  end() {
    log('end hook');
  }
}

module.exports = Hook;
