require('sugar');
const Promise = require('bluebird');
const redis = require('redis');
const config = require('../config');

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

const REDIS_IP = config.get('redis.ip');
const REDIS_PORT = config.get('redis.port');
const REDIS_PASSWORD = config.get('redis.password');

// Redis client
const redisClient = redis.createClient({
  host: REDIS_IP,
  port: REDIS_PORT,
  password: REDIS_PASSWORD || null
});


function Plugin(method, conf, log) {
  const name = '_' + (method || 'redis');

  function redis_plugin(ref) {
    return redisClient;
  }

  function make({ ref, ctx }) {
    return redis_plugin.call(ctx, ref);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;
