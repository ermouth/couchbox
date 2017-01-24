const redis = require('redis');
const config = require('./config');

const REDIS_IP = config.get('redis.ip');
const REDIS_PORT = config.get('redis.port');

// Redis client
module.exports = redis.createClient({
  host: REDIS_IP,
  port: REDIS_PORT
});
