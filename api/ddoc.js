const Promise = require('bluebird');
const vm = require('vm');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const { makeModules } = require('../utils/ddocModules');
const Handler = require('./handler');
const config = require('../config');

// methods
const cache = require('../methods/cache');
const fetch = require('../methods/fetch');
const socket = require('../methods/socket');
const sms = require('../methods/sms');
const Bucket = require('../methods/bucket');


const { LOG_EVENT_DDOC_INIT, LOG_EVENT_DDOC_ERROR } = require('../constants/logEvents');
const { BUCKET_DDOC_CONTEXT_DENY } = require('../constants/bucket');


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


  const getInfo = () => ({ name, id, rev, domain, endpoint, methods });
  const getApi = () => Object.keys(_api).map(path => ({ path, handler: _api[path].run }));

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
        message: 'Started ddoc: "'+ name + '" with methods: "'+ methods.join(',') +'"',
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
