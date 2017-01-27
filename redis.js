const redis = require('redis');
const config = require('./config');

const REDIS_IP = config.get('redis.ip');
const REDIS_PORT = config.get('redis.port');

// Redis client
const client = redis.createClient({
  host: REDIS_IP,
  port: REDIS_PORT
});

module.exports = client;
