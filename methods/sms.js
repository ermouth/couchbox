const Promise = require('bluebird');
const Logger = require('./../utils/logger');
const { SNS } = require('../utils/aws');
const { checkPhone } = require('../utils/lib');

const logger = new Logger({ prefix: 'SMS' });
const _log = logger.getLog();

const { LOG_EVENT_TASK_SMS, LOG_EVENT_TASK_SMS_ERROR } = require('../constants/logEvents');

// const makeQuery = (phone, message) => 'https://sms.ru/sms/send?api_id='+ API_KEY +'&to='+ number +'&text='+ message;

const sms = (number, message, log) => {
  if (!(message && message.length)) return Promise.reject(new Error('Empty message'));
  if (!((number = checkPhone(number)) && number.length)) return Promise.reject(new Error('Bad phone number'));
  if (!log) log = _log;

  const params = {
    Message: message,
    PhoneNumber: '7' + number,
    // Subject: 'Test message'
  };

  log({
    message: 'Send SMS: "'+ params.Message +'" to: '+ params.PhoneNumber,
    event: LOG_EVENT_TASK_SMS
  });

  return new Promise((resolve, reject) => {
    SNS.publish(params, (error, data) => {
      if (error) {
        log({
          message: 'Error send SMS: "'+ params.Message +'" to: '+ params.PhoneNumber,
          event: LOG_EVENT_TASK_SMS_ERROR,
          error
        });
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
};

module.exports = sms;
