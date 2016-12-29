const Promise = require('bluebird');

const sms = (number, message) => new Promise((resolve, reject) => {
  resolve(`SMS: ${number} ${message}`);
});

module.exports = sms;
