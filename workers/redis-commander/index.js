const lib = require('../../utils/lib');
const Worker = require('../../utils/worker');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const configValidator = require('./configValidator');
const config = require('../../config');

const { WORKER_HANDLE_EXIT, WORKER_HANDLE_UNHANDLED_ERROR } = Worker.Constants;
const { WORKER_START, WORKER_EXIT, WORKER_ERROR } = Worker.LOG_EVENTS;

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'Redis-Commader worker' });
  const { logger } = worker;
  const log = logger.getLog();


  const redisConfig = config.get('redis');
  const commanderConfig = config.get('redis.redis_commander');

  if (!configValidator(commanderConfig)) {
    const error = new Error('Not valid redis-commander config');
    log({
      message: 'Error: '+ error.message,
      error,
      event: WORKER_ERROR
    });
    return worker.close();
  }

  worker.emitter.on(WORKER_HANDLE_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError proxy',
      event: WORKER_ERROR,
      error
    });
  });

  const commanderConfigPath = __dirname + '/.redis-commander';
  const removeCommanderConfig = () => fs.existsSync(commanderConfigPath) && fs.unlinkSync(commanderConfigPath);

  removeCommanderConfig();

  const args = [
    // js to execute
    path.normalize(__dirname + '/../../node_modules/redis-commander/bin/redis-commander.js'),
    // process arguments
    '--redis-host', redisConfig.ip || 'localhost',
    '--redis-port', redisConfig.port || '6379',
    '--redis-password', redisConfig.password || '',
    '--port', commanderConfig.port || '8081',
    '--http-auth-username', commanderConfig.user,
    '--http-auth-password', commanderConfig.pass
  ];

  const env = Object.assign(Object.create(process.env), {
    'HOME': __dirname,
    'USERPROFILE': __dirname
  });

  const commander = spawn('node', args, { env });

  commander.stdout.on('data', data => {
    const message = data.toString().trim();
    log({ message });
  });

  commander.stderr.on('data', data => {
    const error = data.toString().trim();
    log({
      message: 'Error in redis-commander',
      error
    })
  });

  commander.on('close', (code) => {
    log({
      message: 'Redis-Commander closed with code: "'+ code + '"',
      event: WORKER_EXIT
    });
    removeCommanderConfig();
    worker.close();
  });

  worker.emitter.on(WORKER_HANDLE_EXIT, (forced) => {
    log({
      message: 'On worker exit, forced: '+ (forced === true ? 'true' : 'false'),
      event: WORKER_EXIT
    });
    commander.kill();
  });

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: WORKER_START
  });
};