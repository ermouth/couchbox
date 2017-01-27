require('sugar');
const Promise = require('bluebird');
const redisClient = require('../redis');
const config = require('../config');

const NODE_DELIMITER = ':';

module.exports = function (channel, message) {
  if (!channel || !Object.isString(channel) || channel.length === 0) return Promise.reject(new Error('Bad channel: '+ channel));

  let nodename = config.get('couchbox.nodename');

  const messagePath = channel.split(NODE_DELIMITER);
  if (messagePath.length > 1 && messagePath[0].length !== 0) {
    nodename = messagePath[0];
    channel = messagePath.slice(1).join(NODE_DELIMITER);
  }
  redisClient.publish(nodename + '.socket.emit', JSON.stringify({ channel, message }));
  return Promise.resolve();
};
