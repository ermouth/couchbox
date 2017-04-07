require('sugar');
const Promise = require('bluebird');
const stow = require('stow');
const RedisBackend = require('stow/backends/redis');
const { notEmpty, isEmpty } = require('../utils/lib');
const redisClient = require('../utils/redis');


function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'cache');
  const isS = Object.isString;
  const isO = Object.isObject;
  const isN = Object.isNumber;

  const cache = stow.createCache(RedisBackend, { client: redisClient });
  const defaultTTL = (conf.ttl|0) | 0;

  const getCache = (key) => new Promise((resolve, reject) => {
    cache.get(key, (error, result) => error ? reject(error) : resolve(result));
  });
  const setCache = (key, data, tags = {}) => new Promise((resolve, reject) => {
    cache.set({ key, data, tags, ttl: defaultTTL }, error => error ? reject(error) : resolve());
  });
  const setQueryCache = ({ key, data, tags = {}, ttl = defaultTTL }) => new Promise((resolve, reject) => {
    cache.set({ key, data, tags, ttl }, error => error ? reject(error) : resolve());
  });
  const invalidateCache = (tags = {}) => new Promise((resolve, reject) => {
    cache.invalidate(tags, error => error ? reject(error) : resolve());
  });
  const clearCache = (key) => new Promise((resolve, reject) => {
    cache.clear(key, error => error ? reject(error) : resolve());
  });

  function cache_method() {
    // Get cache by key
    if (arguments.length === 1 && isS(arguments[0])) return getCache(arguments[0]);
    // Query node-stow
    if (arguments.length === 1 && isO(arguments[0])) {
      const { key, data, ttl, tags } = arguments[0];
      if (isS(key) && (isEmpty(tags) || isO(tags)) && (isEmpty(ttl) || (isN(ttl) && ttl > 0))) return setQueryCache({ key, data, ttl, tags });
    }

    const key = isS(arguments[0]) ? arguments[0] : null;
    const data = arguments[1] || null;
    const tags = isO(arguments[2]) ? arguments[2] : null;

    if (notEmpty(data)) {
      if (notEmpty(key)) return setCache(key, data, tags);
    } else {
      const tasks = [];
      if (notEmpty(key)) tasks.push(clearCache(key));
      if (notEmpty(tags)) tasks.push(invalidateCache(tags));
      if (tasks.length > 0) return Promise.all(tasks);
    }
    return Promise.reject(new Error('Bad arguments'))
  }

  return new Promise(resolve => {

    function make(env) {
      const { ctx } = env;
      return cache_method.bind(ctx);
    }

    resolve({ name, make });
  });
}

module.exports = Plugin;