const Promise = require('bluebird');
const crypto = require('crypto');
const lib = require('../lib');

class Filter {
  onProps(props = {}) {
    let md5sum = crypto.createHash('md5');
    md5sum.update(this.name + JSON.stringify(props));
    const sum = md5sum.digest('hex');
    md5sum = null;
    if (this.md5sum === sum) return null;
    this.md5sum = sum;

    this.lambda = lib.makeFunc(props.lambda);
  }

  constructor(name, props = {}) {
    this.name = name;
    this.onProps(props);
  }

  filter(change, doc) {
    return !!this.lambda(change, doc);
  }

  getHash() {
    return this.md5sum;
  }
}

module.exports = Filter;
