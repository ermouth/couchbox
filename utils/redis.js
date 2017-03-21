const redis = require('redis');
const config = require('../config');

const REDIS_IP = config.get('redis.ip');
const REDIS_PORT = config.get('redis.port');
const REDIS_PASSWORD = config.get('redis.password');

// Redis client
const client = redis.createClient({
  host: REDIS_IP,
  port: REDIS_PORT,
  password: REDIS_PASSWORD || null
});

module.exports = client;
