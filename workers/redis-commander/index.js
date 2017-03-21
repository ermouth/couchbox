const lib = require('../../utils/lib');
const Worker = require('../../utils/worker');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../../config');

const { WORKER_HANDLE_EXIT, WORKER_HANDLE_UNHANDLED_ERROR } = Worker.Constants;
const { WORKER_START, WORKER_EXIT, WORKER_ERROR } = Worker.LOG_EVENTS;

const commanderConfigPath = __dirname + '/.redis-commander';
const removeCommanderConfig = () => fs.existsSync(commanderConfigPath) && fs.unlinkSync(commanderConfigPath);

module.exports = function initWorker(cluster, props = {}) {
  const worker = new Worker(cluster, { name: 'Redis-Commader worker' });
  const { logger } = worker;
  const log = logger.getLog();

  log({
    message: 'Started with '+ Object.keys(props).map(key => (key +'='+ JSON.stringify(props[key]).replace(/"/g, ''))).join(' '),
    event: WORKER_START
  });

  worker.emitter.on(WORKER_HANDLE_UNHANDLED_ERROR, (error) => {
    log({
      message: 'UnhandledError proxy',
      event: WORKER_ERROR,
      error
    });
  });

  removeCommanderConfig();

  const redisConfig = config.get('redis');
  const commanderConfig = config.get('redis.redis_commander');

  const procPath = path.normalize(__dirname + '/../../node_modules/redis-commander/bin/redis-commander.js');
  const args = {
    'redis-host': redisConfig.ip || 'localhost',
    'redis-port': redisConfig.port || '6379',
    'redis-password': redisConfig.password || '',
    'port': commanderConfig.port || '8081',
    'http-auth-username': commanderConfig.user,
    'http-auth-password': commanderConfig.pass,
  };

  const procArgs = [procPath];
  Object.keys(args).forEach(key => {
    procArgs.push('--'+ key);
    procArgs.push(args[key].toString());
  });


  const env = Object.create( process.env );
  env['HOME'] = env['USERPROFILE'] = __dirname;

  const commander = spawn('node', procArgs, { env });

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
    commander.stdin.end();
  });
};