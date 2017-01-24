const Promise = require('bluebird');
const atob = require('atob');
const btoa = require('btoa');

module.exports.lambdaGlobals = {
  Error, SyntaxError, TypeError,
  Object, Array, Function, RegExp, String, Boolean,
  Number, NaN, Infinity,
  Float32Array, Float64Array, Int32Array, Int16Array, Int8Array,Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray,
  Map, Set, Proxy, Symbol, WeakMap, WeakSet,
  Buffer, atob, btoa,
  setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate,
  Math, JSON, Promise, isArray: Object.isArray, toJSON: JSON.stringify
};

module.exports.availableGlobals = Object.keys(module.exports.lambdaGlobals).concat(['resolve', 'reject', 'log']);
