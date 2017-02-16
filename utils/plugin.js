require('sugar');
const util = require('util');
const Promise = require('bluebird');
const { EventEmitter } = require('events');

class Plugin extends Promise {
  constructor(executor) {
    super(executor);
  }

  then(onFulfilled, onRejected) {
    return super.then(onFulfilled, onRejected);
  }
}

util.inherits(Plugin, EventEmitter);

module.exports = Plugin;
