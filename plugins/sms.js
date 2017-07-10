const Promise = require('bluebird');
const { checkPhone } = require('../utils/lib');
const fetch = require('node-fetch');
const config = require('../config');


const DEBUG = config.get('debug');
const TASK_SMS = 'sms/send';
const TASK_SMS_ERROR = 'sms/error';

const getError = (status) => {
  switch (+status) {
    case 100:
      // Good result
      return;
    case 200:
      return new Error('Неправильный api_id');
    case 201:
      return new Error('Не хватает средств на лицевом счету');
    case 202:
      return new Error('Неправильно указан получатель');
    case 203:
      return new Error('Нет текста сообщения');
    case 204:
      return new Error('Имя отправителя не согласовано с администрацией');
    case 205:
      return new Error('Сообщение слишком длинное (превышает 8 СМС)');
    case 206:
      return new Error('Будет превышен или уже превышен дневной лимит на отправку сообщений');
    case 207:
      return new Error('На этот номер (или один из номеров) нельзя отправлять сообщения, либо указано более 100 номеров в списке получателей');
    case 208:
      return new Error('Параметр time указан неправильно');
    case 209:
      return new Error('Вы добавили этот номер (или один из номеров) в стоп-лист');
    case 210:
      return new Error('Используется GET, где необходимо использовать POST');
    case 211:
      return new Error('Метод не найден');
    case 212:
      return new Error('Текст сообщения необходимо передать в кодировке UTF-8 (вы передали в другой кодировке)');
    case 220:
      return new Error('Сервис временно недоступен, попробуйте чуть позже.');
    case 230:
      return new Error('Превышен общий лимит количества сообщений на этот номер в день.');
    case 231:
      return new Error('Превышен лимит одинаковых сообщений на этот номер в минуту.');
    case 232:
      return new Error('Превышен лимит одинаковых сообщений на этот номер в день.');
    case 300:
      return new Error('Неправильный token (возможно истек срок действия, либо ваш IP изменился)');
    case 301:
      return new Error('Неправильный пароль, либо пользователь не найден');
    case 302:
      return new Error('Пользователь авторизован, но аккаунт не подтвержден (пользователь не ввел код, присланный в регистрационной смс)');
  }
};

function Plugin(method, conf, log) {
  const name = '_' + (method || 'sms');

  const API_KEY = conf.key;
  const SEND_FROM = conf.from;
  const makeQuery = (phone, message) => 'https://sms.ru/sms/send?api_id='+ API_KEY + (SEND_FROM ? '&from='+ encodeURI(SEND_FROM) : '') +'&to='+ phone +'&text='+ encodeURI(message);

  if (DEBUG) {
    log('Plugin sms: "'+ name +'"');
  }

  const sms_method = (ref) => function(number, message) {
    if (!(message && message.length)) return Promise.reject(new Error('Empty message'));
    if (!((number = checkPhone(number)) && number.length)) return Promise.reject(new Error('Bad phone number'));

    const phone = '7' + number;

    log({
      message: 'Send SMS: "'+ message +'" to: '+ phone,
      event: TASK_SMS,
      ref
    });

    return new Promise((resolve, reject) => {
      fetch(makeQuery(phone, message)).then(res => res.text()).then(res => {
        const status = res.split('\n')[0];
        const error = getError(status);
        if (error) {
          log({
            message: 'Error send SMS: "'+ message +'" to: '+ phone,
            event: TASK_SMS_ERROR,
            error,
            ref
          });
          return reject(error);
        }
        resolve({ status, ok: true });
      }).catch(error => {
        log({
          message: 'Error send SMS: "'+ message +'" to: '+ phone,
          event: TASK_SMS_ERROR,
          error,
          ref
        });
        reject(error);
      });
    });
  };

  function make(env) {
    const { ref, ctx } = env;
    return sms_method(ref).bind(ctx);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;