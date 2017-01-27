const Promise = require('bluebird');
const atob = require('atob');
const btoa = require('btoa');

module.exports.lambdaGlobals = {
  Error, SyntaxError, TypeError, ReferenceError,
  Object, Array, Function, RegExp, String, Boolean, Date,
  Number, NaN, Infinity, isNaN, isFinite,
  Float32Array, Float64Array, Int32Array, Int16Array, Int8Array,Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray,
  Map, Set, Proxy, Symbol, WeakMap, WeakSet,
  Buffer, atob, btoa,
  setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate,
  Math, JSON, Promise, isArray: Object.isArray, toJSON: JSON.stringify,
  decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, unescape, parseInt, parseFloat
};

module.exports.availableGlobals = Object.keys(module.exports.lambdaGlobals).concat(['require', 'log', 'resolve', 'reject']);
