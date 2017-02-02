const Promise = require('bluebird');
const vm = require('vm');
const Logger = require('../utils/logger');
const { makeModules } = require('../utils/ddocModules');
const Handler = require('./handler');
const config = require('../config');

const { LOG_EVENT_DDOC_INIT } = require('../constants/logEvents');
const { API_DEFAULT_TIMEOUT } = require('../constants/api');

function DDoc(props = {}) {
  const { bucket, name, domain, endpoint, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  let id;
  let rev;
  let vmContext = {};
  let _api = {};
  let timeout = 0;


  const getInfo = () => ({ name, id, rev, domain, endpoint, methods, timeout: timeout||API_DEFAULT_TIMEOUT });
  const getApi = () => Object.keys(_api).map(path => {
    const api = _api[path];
    if (timeout < api.timeout) timeout = api.timeout;
    return { path, handler: api.run};
  });

  const makeApi = (api) => {
    if (!(api && Object.isObject(api))) return null;
    const props = Object.assign({ logger }, vmContext);
    Object.keys(api).forEach(path => {
      _api[path] = new Handler(path, api[path], props);
    });
  };

  return new Promise((resolve, reject) => {
    bucket.get('_design/'+ name, {}, (error, body) => {
      if (error) return reject(error);

      id = body._id;
      rev = body._rev;

      log({
        message: 'Started ddoc: "'+ name + '" with methods: "'+ methods.join(',') +'" and req path: "' + domain +'/'+ endpoint + '"',
        event: LOG_EVENT_DDOC_INIT,
        error
      });

      vmContext = makeModules(body, { log, bucket, methods });
      makeApi(body.api);

      return resolve(Object.assign({ api:getApi() }, getInfo()));
    });
  });
}

module.exports = DDoc;
