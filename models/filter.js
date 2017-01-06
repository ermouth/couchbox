const Promise = require('bluebird');
const lib = require('../lib');

class Filter {
  onProps(props = {}) {
    const sum = lib.hash(props);
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
