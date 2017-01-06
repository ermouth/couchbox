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

const availableGlobals = Object.keys(libContext).concat(['resolve', 'reject']);

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

    this.isGood = !!this.compileLambda(props.lambda);
  }

  compileLambda(lambdaSrc) {
    const lambdaScope = {};

    if (lambdaSrc) {
      if (lib.validateGlobals(lambdaSrc, { available: availableGlobals.concat(Object.keys(lambdaScope)) })) {
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
      } else {
        this.script = null;
        log('Bad globals');
      }
    }

    if (!this.script) {
      this.lambda = (change) => {
        return new Promise(function(resolve, reject) { return resolve(); });
      };
      return null;
    }

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
    return true;
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
