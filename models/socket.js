const http = require('http');
const socketio = require('socket.io');
const Logger = require('../utils/log');
const config = require('../config');

const SOCKET_PORT = config.get('socket.port');
const { LOG_EVENT_SOCKET_START } = require('../constants/logEvents');

function Socket(props = {}) {
  const logger = new Logger({ prefix: 'Socket', logger: props.logger });
  const log = logger.getLog();

  const server = http.createServer();
  const io = socketio(server);

  const _onInit = props.onInit || function(){}; // Call on init all ddocs
  const _onClose = props.onClose || function(){}; // Call on closing

  let _running = false;

  const clients = new Map();

  io.on('connection', function(client) {
    const { id } = client;
    clients.set(id, client);

    console.log('Client connected: '+ id);

    client.on('disconnect', function() {
      clients.delete(id);
      console.log('Client disconnected: '+ id);
    });

    client.on('event', function(data) {
      console.log();
      console.log('Client data:', data);
      console.log();
    });
  });




  const init = () => {
    server.listen(SOCKET_PORT, () => {
      _running = true;
      log({
        message: 'Start listen sockets on port: '+ SOCKET_PORT,
        event: LOG_EVENT_SOCKET_START
      });
      // setTimeout(() => {
      //   console.log('emit emit emit emit emit emit emit ');
      //   io.sockets.emit('an event sent to all connected clients');
      // }, 7000);
      _onInit();
    });
  };

  const close = () => {
    console.log('Socket exit!');
    for (let client in clients.values()) client.destroy(() => console.log('closed'));
    io.close(() => {
      console.log('io closed');
      server.close(() => {
        console.log('server closed');
        _running = false;
        _onClose();
      });
    });
  };

  const isRunning = () => _running === true;

  return {
    init, close,
    isRunning
  };
}

module.exports = Socket;