require('sugar');
const Promise = require('bluebird');
const fetch = require('node-fetch');
const btoa = require('btoa');
const config = require('../config');



function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'kkm');
  if (!Object.isObject(conf)) return Promise.reject(new Error('Bad config'));

  if (!(Object.isString(conf.url) && conf.url.length > 0)) return Promise.reject(new Error('Bad kkm server url'));

  const KKM_SERVER_URL = conf.url.replace(/\/+$/, '');
  const KKM_SERVER_LOGIN = conf.login;
  const KKM_SERVER_PASSWORD = conf.password;
  const KKM_SERVER_AUTH_ROW = 'Basic '+ btoa(KKM_SERVER_LOGIN +':'+ KKM_SERVER_PASSWORD);

  const KKM_TIMEOUT = conf.timeout || 30;
  const KKM_REQUEST_TIMEOUT = conf.requestTimeout || (KKM_TIMEOUT * 1000);

  const KKM_COMPANY = conf.company || 'Couchbox';
  const KKM_CASHIER = conf.cashier || (KKM_COMPANY +' ПО');
  const KKM_TAX = 'tax' in conf ? (conf.tax|0) : -1;
  if (KKM_TAX === null) return Promise.reject(new Error('Bad kkm tax'));
  const KKM_DEPARTMENT = conf.department || 0;
  const KKM_PHONE = Object.isString(conf.phone) && conf.phone.length > 0 ? conf.phone : null;
  const KKM_PRINT = !!conf.print;

  const kkm_valid_tax = tax => (
    (Object.isString(tax) && (+tax === (tax|0)) && (tax = tax|0)) ||
    (Object.isNumber(tax) && (tax === (tax|0)))
  ) && (
    tax === -1 || // НДС не облагается
    tax === 0 ||  // НДС 0%
    tax === 10 || // НДС 10%
    tax === 18    // НДС 18%
  );


  if (!(Object.isString(KKM_SERVER_LOGIN) && KKM_SERVER_LOGIN.length > 0)) return Promise.reject(new Error('Bad kkm server login'));
  if (!(Object.isString(KKM_SERVER_PASSWORD) && KKM_SERVER_PASSWORD.length > 0)) return Promise.reject(new Error('Bad kkm server password'));
  if (!(KKM_TIMEOUT >= 1 && KKM_TIMEOUT <= 60)) return Promise.reject(new Error('Bad kkm timeout: 1 <= timeout <= 60'));
  if (!kkm_valid_tax(KKM_TAX)) return Promise.reject(new Error('Bad kkm tax: -1, 0, 10, 18'));


  function kkm_guid() {
    const S4 = () => (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
  }

  const kkm_method_send = (command, data = {}, async = false) => {
    data.Command = command;

    // Уникальный идентификатор команды. Любая строка из 40 символов - должна быть уникальна для каждой подаваемой команды
    if (!(Object.isString(data.IdCommand) && data.IdCommand.length !== 40)) data.IdCommand = kkm_guid();

    // Номер устройства. Если 0 то первое не блокированное на сервере
    if (!(Object.isNumber(data.NumDevice) && data.NumDevice >= 0)) data.NumDevice = 0;

    const url = KKM_SERVER_URL +'/Execute/'+ (async ? 'async' : 'sync');
    const params = {
      mode: 'cors',
      method: 'POST',
      timeout: KKM_REQUEST_TIMEOUT,
      headers: {
        'Accept': 'application/json; charset=utf-8',
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': KKM_SERVER_AUTH_ROW
      },
      body: JSON.stringify(data)
    };
    return fetch(url, params).then(res => res.json());
  };

  const _defautCheckStrings = [ { PrintText: { Text: '>#2#<'+ KKM_COMPANY, Font: 2 } } ]; // company title

  const kkm_method_sell = (userContact, products = [], print = false) => {
    if (!(Object.isString(userContact) && userContact.length > 0)) return Promise.reject('Bad userContact');
    {
      let itemIndex, item;
      if (!(Object.isArray(products) && (itemIndex = products.length) > 0)) return Promise.reject('Bad products to sell');
      while (itemIndex--) if (!(
        (item = products[itemIndex]) && Object.isObject(item) &&
          (
            // item name is set
            ('name' in item) &&
            Object.isString(item.name) && item.name.length > 0
          ) &&
          (
            // item price is set and more than 0
            ('price' in item) &&
            (
              (Object.isString(item.price) && (item.price = +item.price)) ||
              Object.isNumber(item.price)
            ) &&
            (item.price > 0)
          ) &&
          (
            // item count is set and more than 0
            ('count' in item) &&
            (
              (Object.isString(item.count) && (+item.count === (item.count|0)) && (item.count = (item.count|0))) ||
              (Object.isNumber(item.count) && (item.count === (item.count|0)))
            ) &&
            (item.count > 0)
          ) &&
          (
            // item amount is set and more or equal 0
            ('amount' in item) &&
            (
              (Object.isString(item.amount) && (item.amount = +item.amount)) ||
              Object.isNumber(item.amount)
            ) &&
            (item.amount >= 0)
          )
      )) return Promise.reject('Bad product to sell at index '+ itemIndex);
    }

    const sellRequest = {
      Timeout: KKM_TIMEOUT, // Таймаут в секундах
      IsFiscalCheck: true,
      TypeCheck: 0, // 0 – продажа; 1 – возврат продажи; 10 – покупка; 11 - возврат покупки; 8 - продажа только по ЕГАИС; 9 - возврат продажи только по ЕГАИС;
      CancelOpenedCheck: true, // Аннулировать открытый чек если ранее чек не был завершен до конца
      NotPrint: !(print || KKM_PRINT),
      CashierName: KKM_CASHIER,
      ClientAddress: userContact,

      // Дополниельные реквизиты чека (не обязательно)
      // 1005 Адрес оператора по переводу денежных средств (Строка 100)
      // 1010 Размер вознаграждения банковского агента (субагента)
      // 1016 ИНН оператора по переводу денежных средств (Строка 12)
      // 1026 Наименование оператора по переводу денежных средств (Строка 64)
      // 1044 Операция банковского агента (Строка 24)
      // 1045 Операция банковского субагента (Строка 24)
      // 1073 Телефон банковского агента (Строка 19)
      // 1074 Телефон платежного агента (Строка 19)
      // 1075 Телефона оператора по переводу денежных средств (Строка 19)
      // 1082 Телефон банковского субагента (Строка 19)
      // 1083 Телефон платежного субагента (Строка 19)
      // 1119 Телефон оператора по приему платежей (Строка 19)
      CheckProps: [],

      // Дополнительные произвольные реквизиты (не обязательно) пока только 1 строка
      AdditionalProps: [],

      // Строки чека
      CheckStrings: Object.clone(_defautCheckStrings),

      Cash: 0,          // нал
      CashLessType1: 0, // безнал - карта
      CashLessType2: 0, // безнал - кредит
      CashLessType3: 0  // безнал - сертификат
    };

    if (KKM_PHONE) {
      sellRequest.AdditionalProps.push(
        { Print: true, PrintInHeader: false, NameProp: 'Телефон поставщика', Prop: KKM_PHONE }
      );
    }

    products.forEach(product => {
      const Register = {
        Name: product.name,         // Наименование товара 64 символа
        Quantity: product.count,    // Количество товара
        Price: product.price,       // Цена за шт. без скидки
        Amount: product.amount,     // Конечная сумма строки с учетом всех скидок/наценок;
        Department: KKM_DEPARTMENT, // Отдел, по которому ведется продажа
        Tax: KKM_TAX                // НДС в процентах или ТЕГ НДС: 0 (НДС 0%), 10 (НДС 10%), 18 (НДС 18%), -1 (НДС не облагается)
      };

      if (product.department) Register.Department = product.department;
      if (product.tax) Register.Tax = product.tax;
      if (product.ean13) Register.EAN13 = product.EAN13; //Штрих-код EAN13 для передачи в ОФД (не печатется)

      sellRequest.CheckStrings.push({ Register });
      sellRequest.CashLessType1 += product.amount;
    });

    return kkm_method_send('RegisterCheck', sellRequest);
  };

  const kkm_method_devices = () => kkm_method_send('List');
  const kkm_method_status = (NumDevice = 0) => kkm_method_send('GetDataKKT', { NumDevice });
  const kkm_method_open = (NumDevice = 0) => kkm_method_send('OpenShift', { CashierName: KKM_CASHIER });
  const kkm_method_zreport = (NumDevice = 0) => kkm_method_send('ZReport', { NumDevice });
  const kkm_method_xreport = (NumDevice = 0) => kkm_method_send('XReport', { NumDevice });
  const kkm_method_checkCommand = (IdCommand) => kkm_method_send('GetRezult', { IdCommand });
  const kkm_method_lineLength = (NumDevice = 0) => kkm_method_send('GetLineLength', { NumDevice });

  const kkm_method = (ref) => function (action) {
    switch (action) {
      case 'devices': return kkm_method_devices.apply(this);
      case 'sell': return kkm_method_sell.apply(this, Array.from(arguments).slice(1));
      case 'open': return kkm_method_open.apply(this, Array.from(arguments).slice(1));
      case 'zreport': return kkm_method_zreport.apply(this, Array.from(arguments).slice(1));
      case 'xreport': return kkm_method_xreport.apply(this, Array.from(arguments).slice(1));
      case 'status': return kkm_method_status.apply(this, Array.from(arguments).slice(1));
      case 'checkCommand': return kkm_method_checkCommand.apply(this, Array.from(arguments).slice(1));
      case 'lineLength': return kkm_method_lineLength.apply(this, Array.from(arguments).slice(1));
    }
    return Promise.reject(new Error('Bad action name'))
  };

  return new Promise((resolve, reject) => {
    function make(env) {
      const { ref, ctx } = env;
      return kkm_method(ref).bind(ctx);
    }
    resolve({ name, make });
  });
}

module.exports = Plugin;