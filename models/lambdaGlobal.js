const Promise = require('bluebird');
const atob = require('atob');
const btoa = require('btoa');

const nodeGlobals = {
  Buffer,
  setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate
};
const couchGlobals = {
  atob, btoa,
  isArray: Object.isArray,
  toJSON: JSON.stringify,
};
const customGlobals = {
  Promise
};

const lambdaGlobals = Object.assign({}, nodeGlobals, couchGlobals, customGlobals);

const availableGlobals = Object.assign({}, lambdaGlobals, {
  undefined,
  Error, SyntaxError, TypeError, ReferenceError,
  Object, Array, Function, RegExp, String, Boolean, Date,
  Number, NaN, Infinity, isNaN, isFinite,
  Float32Array, Float64Array, Int32Array, Int16Array, Int8Array,Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray,
  Map, Set, Proxy, Symbol, WeakMap, WeakSet,
  Buffer,
  Math, JSON,
  decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, unescape, parseInt, parseFloat
});

const availableInLambda = ['require', 'log', 'arguments', 'resolve', 'reject'];
const lambdaAvailable = Object.keys(availableGlobals).concat(availableInLambda);

module.exports = {
  lambdaGlobals,
  lambdaAvailable
};
