require('sugar');
const Promise = require('bluebird');
const redisClient = require('../redis');
const config = require('../config');

const { SOCKET_NODE_DELIMITER, SOCKET_EVENT_PREFIX } = require('../constants/socket');

module.exports = function (channel, message) {
  if (!channel || !Object.isString(channel) || channel.length === 0) return Promise.reject(new Error('Bad channel: '+ channel));

  let nodename = config.get('couchbox.nodename');

  const messagePath = channel.split(SOCKET_NODE_DELIMITER);
  if (messagePath.length > 1 && messagePath[0].length !== 0) {
    nodename = messagePath[0];
    channel = messagePath.slice(1).join(SOCKET_NODE_DELIMITER);
    if (channel.length === 0) return Promise.reject(new Error('Bad channel: '+ channel));
  }
  redisClient.publish(SOCKET_EVENT_PREFIX + nodename, JSON.stringify({ channel, message }));
  return Promise.resolve();
};
