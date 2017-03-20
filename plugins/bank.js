require('sugar');
const Promise = require('bluebird');
const fetch = require('node-fetch');
const queryString = require('query-string');
const moment = require('moment');
const config = require('../config');


const API_URL = 'https://3dsec.sberbank.ru/payment/rest/';


const languages = new Set();
const currencies = new Set();
const transactionStatesAll = new Set();


const DEFAULT_LANGS = ['ru','en','uk','be'];
const DEFAULT_CURRENCIES = ['RUB', 'USD', 'EUR'];
const DEFAULT_TRANSACTION_STATES = ['CREATED', 'APPROVED', 'DEPOSITED', 'DECLINED', 'REVERSED', 'REFUNDED'];
DEFAULT_TRANSACTION_STATES.forEach(st => transactionStatesAll.add(st));

const DATETIME_FORMAT = 'YYYYMMDDHHmmss';


const check_dateTime = (val) => {
  if (Object.isString(val) && val.length > 0) {
    try {
      val = moment(val, DATETIME_FORMAT);
      return Promise.resolve(val);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return Promise.reject(new Error('Bad dateTime'));
};
const check_url = (val) => {
  if (Object.isString(val) && val.length > 0) {
    val = val.trim();
    if (/^https?:\/\//.test(val)) return Promise.resolve(val);
  }
  return Promise.reject(new Error('Bad url'));
};
const check_userName = (val) => {
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad userName'));
};
const check_password = (val) => {
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad password'));
};
const check_orderId = (val) => {
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad orderId'));
};
const check_orderNumber = (val) => {
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad orderNumber'));
};
const check_amount = (val) => {
  if (Object.isNumber(val) && val > 0 && val === (val|0)) return Promise.resolve(val);
  return Promise.reject(new Error('Bad amount'));
};
const check_currency = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val) && val.length === 3) {
    val = val.toUpperCase();
    if (currencies.has(val)) return Promise.resolve(val);
  }
  return Promise.reject(new Error('Bad currency'));
};
const check_returnUrl = (val) => {
  return check_url(val).catch(err => {
    throw new Error('Bad returnUrl: "'+ err.message +'"');
  });
};
const check_failUrl = (val) => {
  if (!val) return Promise.resolve();
  return check_url(val).catch(err => {
    throw new Error('Bad failUrl: "'+ err.message +'"');
  });
};
const check_description = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val)) {
    if (val.length === 0) return Promise.resolve();
    if (val.length > 99) return Promise.reject(new Error('Bad description - max length = 99'));
    if (!!~val.indexOf('%')) return Promise.reject(new Error('Bad description - deny symbol "%"'));
    if (!!~val.indexOf('\r')) return Promise.reject(new Error('Bad description - deny symbol "/\r"'));
    if (!!~val.indexOf('\n')) return Promise.reject(new Error('Bad description - deny symbol "/\n"'));
    return Promise.resolve(val);
  }
  return Promise.reject(new Error('Bad description'));
};
const check_language = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val) && val.length === 2) {
    if (languages.has(val)) return Promise.resolve(val);
  }
  return Promise.reject(new Error('Bad currency'));
};
const check_pageView = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad pageView'));
};
const check_clientId = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad clientId'));
};
const check_merchantLogin = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad merchantLogin'));
};
const check_jsonParams = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isObject(val)) return Promise.resolve(JSON.stringify(val));
  if (Object.isString(val)) {
    try {
      JSON.parse(val);
      return Promise.resolve(val);
    } catch (error) {
      return Promise.reject(new Error('Bad jsonParams "'+ error.message +'"'));
    }
  }
  return Promise.reject(new Error('Bad jsonParams'));
};
const check_sessionTimeoutSecs = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isNumber(val) && val > 0 && val === (val|0)) return Promise.resolve(val);
  return Promise.reject(new Error('Bad sessionTimeoutSecs'));
};
const check_expirationDate = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad expirationDate'));
};
const check_bindingId = (val) => {
  if (!val) return Promise.resolve();
  if (Object.isString(val) && val.length > 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad bindingId'));
};
const check_page = (val) => {
  if (!val) return Promise.resolve(0);
  if (Object.isNumber(val) && val >= 0) return Promise.resolve(val);
  return Promise.reject(new Error('Bad page'));
};
const check_size = (val) => {
  if (Object.isNumber(val) && val > 0 && val <= 200) return Promise.resolve(val);
  return Promise.reject(new Error('Bad size'));
};
const check_from_to = (from, to) => {
  return Promise.all([
    check_dateTime(from),
    check_dateTime(to)
  ]).then(([from, to]) => {
    if (from > to) throw new Error('Error: from more then to');
    return [from.format(DATETIME_FORMAT), to.format(DATETIME_FORMAT)];
  });
};
const check_transactionStates = (val) => {
  if (Object.isString(val) && val.length > 0) val = val.trim().toUpperCase().split(',');
  if (Object.isArray(val) && val.length > 0) {
    let i = val.length;
    while (i--) {
      if (!transactionStatesAll.has(val[i])) return Promise.reject(new Error('Error parse transactionStates at "' + val[i] + '"'));
    }
    return Promise.resolve(val.join(','));
  }
  return Promise.reject(new Error('Bad transactionStates'));
};
const check_merchants = (val) => {
  if (Object.isString(val) && val.length > 0) val = val.trim().split(',');
  if (Object.isArray(val) && val.length > 0) return Promise.resolve(val.join(','));
  return Promise.reject(new Error('Bad transactionStates'));
};
const check_searchByCreatedDate = (val = false) => Promise.resolve(!!val);


const errorCodes = {
  'register0': 'Обработка запроса прошла без системных ошибок',
  'register1': 'Заказ с таким номером уже зарегистрирован в системе',
  'register3': 'Неизвестная (запрещенная) валюта',
  'register4': 'Отсутствует обязательный параметр запроса',
  'register5': 'Ошибка значение параметра запроса',
  'register7': 'Системная ошибка',

  'getOrderStatus0': 'Обработка запроса прошла без системных ошибок',
  'getOrderStatus2': 'Заказ отклонен по причине ошибки в реквизитах платежа',
  'getOrderStatus5': [
    'Доступ запрещён',
    'Пользователь должен сменить свой пароль',
    'orderId не указан'
  ],
  'getOrderStatus6': 'Незарегистрированный OrderId',
  'getOrderStatus7': 'Системная ошибка',

  'getOrderStatusExtended0': 'Обработка запроса прошла без системных ошибок',
  'getOrderStatusExtended1': 'Ожидается orderId или orderNumber',
  'getOrderStatusExtended2': 'Заказ отклонен по причине ошибки в реквизитах платежа',
  'getOrderStatusExtended5': [
    'Доступ запрещён',
    'Пользователь должен сменить свой пароль'
  ],
  'getOrderStatusExtended6': 'Заказ не найден',
  'getOrderStatusExtended7': 'Системная ошибка',

  'getLastOrdersForMerchants0': 'Обработка запроса прошла без системных ошибок',
  'getLastOrdersForMerchants5': [
    'Не заполнено одно из обязательных полей',
    'Неверный формат параметра transactionStates',
    'Доступ запрещён'
  ],
  'getLastOrdersForMerchants7': 'Системная ошибка',
  'getLastOrdersForMerchants10': [
    'Значение параметра size превышает максимально допустимое',
    'Недостаточно прав для просмотра транзакций указанного мерчанта'
  ],

  'refund0': 'Обработка запроса прошла без системных ошибок',
  'refund5': 'Ошибка значение параметра запроса',
  'refund6': 'Незарегистрированный OrderId',
  'refund7': 'Системная ошибка',
};

const orderStatuses = {
  0: 'Заказ зарегистрирован, но не оплачен',
  1: 'Предавторизованная сумма захолдирована (для двухстадийных платежей)',
  2: 'Проведена полная авторизация суммы заказа',
  3: 'Авторизация отменена',
  4: 'По транзакции была проведена операция возврата',
  5: 'Инициирована авторизация через ACS банка-эмитента',
  6: 'Авторизация отклонена'
};

const makeRequest = (action) => (props) => API_URL + action + '.do?' + queryString.stringify(props);
const onRequest = (action) => (reqUrl) => {
  return fetch(reqUrl, { method: 'POST' }).then(res => res.json())
    .catch(error => {
      throw new Error('Request error: "'+ error.message +'"');
    })
    .then(json => {
      if (!Object.isObject(json)) {
        throw new Error('Bad result');
      }
      if ('errorCode' in json || 'errorMessage' in json || 'ErrorCode' in json || 'ErrorMessage' in json) {
        const errorCode =  json.errorCode >= 0
            ? json.errorCode
            : json.ErrorCode >= 0
              ? json.ErrorCode
              : 0;
        if (errorCode > 0) {
          throw new Error( json.errorMessage || json.ErrorMessage || errorCodes[action + errorCode] || 'Bad request' );
        }
      }
      if ('OrderStatus' in json || 'orderStatus' in json) {
        const statusCode = json.OrderStatus >= 0
          ? json.OrderStatus
          : json.orderStatus >= 0
            ? json.orderStatus
            : 0;
        json._OrderStatus = orderStatuses[statusCode];
      }
      return json;
    })
};


function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'bank');

  const BANK_LOGIN = conf.login;
  const BANK_PASSWORD = conf.pass;

  (conf.languages && conf.languages.length > 0 ? conf.languages : DEFAULT_LANGS).forEach(lang => languages.add(lang));
  (conf.currencies && conf.currencies.length > 0 ? conf.currencies : DEFAULT_CURRENCIES).forEach(cur => currencies.add(cur));


  // Запрос регистрации заказа
  const bank_register = (props = {}, ref) => {
    const {
      userName,           // ! Логин магазина, полученный при подключении
      password,           // ! Пароль магазина, полученный при подключении
      orderNumber,        // ! Номер (идентификатор) заказа в системе магазина, уникален для каждого магазина в пределах системы
      amount,             // ! Сумма платежа в копейках (или центах)
      currency,           //   Код валюты платежа ISO 4217. Если не указан, считается равным коду валюты по умолчанию.
      returnUrl,          // ! Адрес, на который требуется перенаправить пользователя в случае успешной оплаты. Значение должно представлять собой абсолютную ссылку.
      failUrl,            //   Адрес, на который требуется перенаправить пользователя в случае неуспешной оплаты. Значение должно представлять собой абсолютную ссылку.
      description,        //   Описание заказа в свободной форме
      language,           //   Язык в кодировке ISO 639-1. Если не указан, будет использован язык, указанный в настройках магазина как язык по умолчанию (default language)

      pageView,           //   По значению данного параметра определяется, какие страницы платёжного интерфейса должны загружаться для клиента. Возможные значения:
                          //   - DESKTOP – для загрузки страниц, верстка которых предназначена для отображения на экранах ПК (в архиве страниц платёжного интерфейса будет осуществляться поиск страниц с названиями payment_<locale>.html и errors_<locale>.html );
                          //   - MOBILE – для загрузки страниц, верстка которых предназначена для отображения на экранах мобильных устройств (в архиве страниц платёжного интерфейса будет осуществляться поиск страниц с названиями mobile_payment_<locale>.html и mobile_errors_<locale>.html );
                          //   - Если магазин создал страницы платёжного интерфейса, добавив в название файлов страниц произвольные префиксы, передайте значение нужного префикса в параметре pageView для загрузки соответствующей страницы. Например, при передаче значения iphone в архиве страниц платёжного интерфейса будет осуществляться поиск страниц с названиями iphone_p ayment_<locale>.html и iphone_error_<locale>.html.
                          //   Где locale – язык страницы в кодировке ISO 639-1. Например, ru для русского или en для английского.
                          //   Если параметр отсутствует, либо не соответствует формату, то по умолчанию считается pageView= DESKTOP.

      clientId,           //   Номер (идентификатор) клиента в системе магазина. Используется для реализации функционала связок. Может присутствовать, если магазину разрешено создание связок.
      merchantLogin,      //   Чтобы зарегистрировать заказ от имени дочернего мерчанта, укажите его логин в этом параметре.

      jsonParams,         //   Блок для передачи дополнительных параметров мерчанта. Поля дополнительной информации для последующего хранения, передаются в виде: {"<name1>":"<value1>",...,"<nameN>":"<valueN>"},
                          //   Данные поля могут быть переданы в процессинг банка для последующего отображения в реестрах.*
                          //   Включение данного функционала возможно по согласованию с банком в период интеграции.
                          //   Если для продавца настроена отправка уведомлений покупателю, адрес электронной почты покупателя должен передаваться в этом блоке в параметре с именем email.

      sessionTimeoutSecs, //   Продолжительность жизни заказа в секундах.
                          //   В случае если параметр не задан, будет использовано значение, указанное в настройках мерчанта или время по умолчанию (1200 секунд = 20 минут).
                          //   Если в запросе присутствует параметр expirationDate, то значение параметра sessionTimeout Secs не учитывается.

      expirationDate,     //   Дата и время окончания жизни заказа. Формат: yyyy-MM-ddTHH:mm:ss.
                          //   Если этот параметр не передаётся в запросе, то для определения времени окончания жизни заказа используется sessionTimeoutSecs.

      bindingId           //   Идентификатор связки, созданной ранее. Может использоваться, только если у магазина есть разрешение на работу со связками. Если этот параметр передаётся в данном запросе, то это означает:
                          //   1. Данный заказ может быть оплачен только с помощью связки;
                          //   2. Плательщик будет перенаправлен на платёжную страницу, где требуется только ввод CVC.
    } = props;

    return Promise.all([
      check_userName(userName || BANK_LOGIN),
      check_password(password || BANK_PASSWORD),
      check_orderNumber(orderNumber),
      check_amount(amount),
      check_currency(currency),
      check_returnUrl(returnUrl),
      check_failUrl(failUrl),
      check_description(description),
      check_language(language),
      check_pageView(pageView),
      check_clientId(clientId),
      check_merchantLogin(merchantLogin),
      check_jsonParams(jsonParams),
      check_sessionTimeoutSecs(sessionTimeoutSecs),
      check_expirationDate(expirationDate),
      check_bindingId(bindingId)
    ]).then(([
      userName, password, orderNumber, amount, currency, returnUrl, failUrl, description, language, pageView,
      clientId, merchantLogin, jsonParams, sessionTimeoutSecs, expirationDate, bindingId
    ]) => ({
      userName, password, orderNumber, amount, currency, returnUrl, failUrl, description, language, pageView,
      clientId, merchantLogin, jsonParams, sessionTimeoutSecs, expirationDate, bindingId
    }))
      .then(makeRequest('register'))
      .then(onRequest('register'));
  };


  // Запрос состояния заказа
  const bank_getOrderStatus = (props, ref) => {
    const {
      userName, // ! Логин магазина, полученный при подключении
      password, // ! Пароль магазина, полученный при подключении
      orderId,  // ! Номер заказа в платежной системе. Уникален в пределах системы.
      language  //   Язык в кодировке ISO 639-1. Если не указан, считается, что язык – русский. Сообщение ошибке будет возвращено именно на этом языке.
    } = props;

    return Promise.all([
      check_userName(userName || BANK_LOGIN),
      check_password(password || BANK_PASSWORD),
      check_orderId(orderId),
      check_language(language)
    ]).then(([ userName, password, orderId, language ]) => ({ userName, password, orderId, language }))
      .then(makeRequest('getOrderStatus'))
      .then(onRequest('getOrderStatus'));
  };


  // Расширенный запрос состояния заказа
  const bank_getOrderStatusExtended = (props, ref) => new Promise((resolve, reject) => {
    const {
      userName,     // ! Логин магазина, полученный при подключении
      password,     // ! Пароль магазина, полученный при подключении
      orderId,      // ! Номер заказа в платежной системе. Уникален в пределах системы.
      orderNumber,  // ! Номер (идентификатор) заказа в системе магазина.
      language      //   Язык в кодировке ISO 639-1. Если не указан, считается, что язык – русский. Сообщение ошибке будет возвращено именно на этом языке.
    } = props;

    return Promise.all([
      check_userName(userName || BANK_LOGIN),
      check_password(password || BANK_PASSWORD),
      check_orderId(orderId),
      check_orderNumber(orderNumber),
      check_language(language)
    ]).then(([ userName, password, orderId, orderNumber, language ]) => ({ userName, password, orderId, orderNumber, language }))
      .then(makeRequest('getOrderStatusExtended'))
      .then(onRequest('getOrderStatusExtended'));
  });


  // Запрос статистики по платежам за период
  const bank_getLastOrdersForMerchants = (props, ref) => {
    const {
      userName,           // ! Логин магазина, полученный при подключении
      password,           // ! Пароль магазина, полученный при подключении
      language,           //   Язык в кодировке ISO 639-1. Если не указан, считается, что язык – русский. Сообщение ошибке будет возвращено именно на этом языке.
      page,               //   При обработке запроса будет сформирован список, разбитый на страницы (с количеством записей s ize на одной странице). В ответе возвращается страница под номером, указанным в параметре pag e. Нумерация страниц начинается с 0. Если параметр не указан, будет возвращена страница под номером 0.
      size,               // ! Количество элементов на странице (максимальное значение = 200).
      from,               // ! Дата и время начала периода для выборки заказов в формате YYYYMMDDHHmmss.
      to,                 // ! Дата и время окончания периода для выборки заказов в формате YYYYMMDDHHmmss.

      transactionStates,  // ! В этом блоке необходимо перечислить требуемые состояния заказов. Только заказы, находящиеся в одном из указанных состояний, попадут в отчёт.
                          //   Несколько значений указываются через запятую. Возможные значения: CREATED, APPROVED, DEPOSITED, DECLINED, REVERSED, REFUNDED.

      merchants,          // ! Список Логинов мерчантов, чьи транзакции должны попасть в отчёт. Несколько значений указываются через запятую.
                          //   Оставьте это поле пустым, чтобы получить список отчётов по всем доступным мерчантам (дочерним мерчантам и мерчантам, указанным в настройках пользователя).

      searchByCreatedDate //   Значение по умолчанию – false . Возможные значения:
                          //   - true – поиск заказов, дата создания которых попадает в заданный период.
                          //   - false – поиск заказов, дата оплаты которых попадает в заданный период (таким образом, в отчёте не могут присутствовать заказы в статусе CREATED и DECLINED).
    } = props;

    return Promise.all([
      check_userName(userName || BANK_LOGIN),
      check_password(password || BANK_PASSWORD),
      check_language(language),
      check_page(page),
      check_size(size),
      check_from_to(from, to),
      check_transactionStates(transactionStates),
      check_merchants(merchants),
      check_searchByCreatedDate(searchByCreatedDate)
    ]).then(([
      userName, password, language, page, size, [from, to], transactionStates, merchants, searchByCreatedDate
    ]) => ({
      userName, password, language, page, size, from, to, transactionStates, merchants, searchByCreatedDate
    }))
      .then(makeRequest('getLastOrdersForMerchants'))
      .then(onRequest('getLastOrdersForMerchants'));
  };


  // Запрос возврата средств оплаты заказа
  const bank_refund = (props, ref) => {
    const {
      userName, // ! Логин магазина, полученный при подключении
      password, // ! Пароль магазина, полученный при подключении
      orderId,  // ! Номер заказа в платежной системе. Уникален в пределах системы.
      amount    // ! Сумма платежа в копейках (или центах)
    } = props;

    return Promise.all([
      check_userName(userName || BANK_LOGIN),
      check_password(password || BANK_PASSWORD),
      check_orderId(orderId),
      check_amount(amount)
    ]).then(([ userName, password, orderId, amount ]) => ({ userName, password, orderId, amount }))
      .then(makeRequest('refund'))
      .then(onRequest('refund'));
  };


  const call_bank = (ref) => (action, props = {}) => {
    if (!(props && Object.isObject(props)) && action !== 'statuses') return Promise.reject(new Error('Bad props'));
    switch (action) {
      case 'register':
        return bank_register(props, ref);
      case 'getOrderStatus':
        return bank_getOrderStatus(props, ref);
      case 'getOrderStatusExtended':
        return bank_getOrderStatusExtended(props, ref);
      case 'getLastOrdersForMerchants':
        return bank_getLastOrdersForMerchants(props, ref);
      case 'refund':
        return bank_refund(props, ref);
      case 'statuses':
        return Promise.resolve(Object.clone(orderStatuses));
      default:
        return Promise.reject(new Error('Bad method'));
    }
  };


  return Promise.resolve({
    name,
    make: ({ ctx, ref }) => call_bank(ref).bind(ctx)
  });
}

module.exports = Plugin;