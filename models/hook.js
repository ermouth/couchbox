const Promise = require('bluebird');
const crypto = require('crypto');
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
    let md5sum = crypto.createHash('md5');
    md5sum.update(JSON.stringify(props));
    const sum = md5sum.digest('hex');
    md5sum = null;
    if (this.md5sum === sum) return null;
    this.md5sum = sum;

    this.mode = props.mode || 'transitive';
    this.timeout = props.timeout || 10e3;
    this.since = props.since || 'now';
    this.attachments = props.attachments || false;
    this.conflicts = props.conflicts || false;

    if (props.lambda) {

      const lambdaScope = {};

      let script;
      try {
        script = new vm.Script(`
          result = new Promise(function (resolve, reject) {
            return (${props.lambda}).bind(lambdaScope)(change, doc);
          });
        `);
      } catch(e) {
        log(e);
      }

      this.lambda = (change, doc) => {
        const boxScope = Object.assign({}, libContext, {
          lambdaScope,
          change, doc,
          result: null
        });
        const context = new vm.createContext(boxScope);
        script.runInContext(context);
        return boxScope.result;
      };
    } else {
      this.lambda = function(){ return; };
    }
  }

  constructor(props = {}) {
    this.onProps(props);
  }

  getHash() {
    return this.md5sum;
  }

  run(change, doc) {
    return this.lambda(change, doc).timeout(this.timeout);
  }

  end() {
    log('end hook');
  }
}

module.exports = Hook;
