require('sugar');
const Promise = require('bluebird');
const stow = require('stow');
const RedisBackend = require('stow/backends/redis');
const redisClient = require('../utils/redis');
// const config = require('../config');


const cache = stow.createCache(RedisBackend, { client: redisClient });

const getCache = (key) => new Promise((resolve, reject) => {
  cache.get(key, (error, result) => error ? reject(error) : resolve(result));
});
const setCache = (key, data, tags = {}) => new Promise((resolve, reject) => {
  cache.set(key, data, tags, error => error ? reject(error) : resolve());
});
const invalidateCache = (tags = {}) => new Promise((resolve, reject) => {
  cache.invalidate(tags, error => error ? reject(error) : resolve());
});
const clearCache = (key) => new Promise((resolve, reject) => {
  cache.clear(key, error => error ? reject(error) : resolve());
});


module.exports = function () {
  let key, tags, data;

  if (Object.isString(arguments[0])) key = arguments[0];
  else if (Object.isObject(arguments[0]) && !arguments[1] && !arguments[2]) tags = arguments[0];

  // No arguments or bad sequence
  if (!key && !tags) return Promise.reject(new Error('Bad arguments'));

  // Invalidate by tags
  if (tags) return invalidateCache(tags);

  if (arguments[1] !== undefined || Object.isObject(arguments[2])) {
    // Set or clean cache by key & tags
    data = arguments[1] || null;
    tags = arguments[2];

    if (data === null) {
      // If no data start clearing cache
      return Promise.all([
        // Clear cache by key
        clearCache(key),
        // Invalidate cache by tags if tags set
        Object.isObject(tags) ? invalidateCache(tags) : null
      ].compact(true));
    } else {
      // If no data start update cache
      return setCache(key, data, tags);
    }
  }

  // Get cache by key
  return getCache(key);
};