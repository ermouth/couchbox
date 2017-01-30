const Promise = require('bluebird');
const Logger = require('./log');
const { SNS } = require('../aws');
const { checkPhone } = require('../lib');

const logger = new Logger({ prefix: 'SMS' });
const _log = logger.getLog();

const { LOG_EVENT_TASK_SMS } = require('../constants/logEvents');

const sms = (number, message, log) => {
  if (!(message && message.length)) return Promise.reject(new Error('Empty message'));
  if (!((number = checkPhone(number)) && number.length)) return Promise.reject(new Error('Bad phone number'));
  if (!log) log = _log;

  const params = {
    Message: message,
    PhoneNumber: '+7' + number,
    // Subject: 'Test message'
  };

  log({
    message: 'Send SMS: "'+ params.Message +'" to: '+ params.PhoneNumber,
    event: LOG_EVENT_TASK_SMS
  });

  return new Promise((resolve, reject) => {
    SNS.publish(params, (error, data) => error ? reject(error) : resolve(data));
  });
};

module.exports = sms;
