const Promise = require('bluebird');
const vm = require('vm');
const Logger = require('../utils/logger');
const { makeModules } = require('../utils/ddocModules');
const Handler = require('./handler');
const config = require('../config');

const { LOG_EVENT_DDOC_INIT, LOG_EVENT_API_HANDLER_ERROR } = require('../constants/logEvents');
const { API_DEFAULT_TIMEOUT } = require('../constants/api');

function DDoc(props = {}) {
  const { bucket, name, domain, endpoint, methods } = props;
  const logger = new Logger({
    prefix: 'DDoc '+ name,
    logger: props.logger
  });
  const log = logger.getLog();

  return new Promise((resolve, reject) => {
    bucket.get('_design/'+ name, {}, (error, body) => {
      if (error) return reject(error);

      const id = body._id;
      const rev = body._rev;

      let timeout = 0;

      log({
        message: 'Started ddoc: "'+ name + '" with methods: "'+ methods.join(',') +'" and req path: "' + domain +'/'+ endpoint + '"',
        event: LOG_EVENT_DDOC_INIT
      });

      const api = [];

      if (body.api && Object.isObject(body.api)) {
        const vmContext = makeModules(body, { log, bucket, methods });
        const props = Object.assign({ logger }, vmContext);
        Object.keys(body.api).forEach(path => {
          try {
            const lambda = new Handler(path, body.api[path], props);
            if (timeout < lambda.timeout) timeout = lambda.timeout;
            api.push(lambda);
          } catch (error) {
            log({
              message: 'Error init lambda: '+ path,
              event: LOG_EVENT_API_HANDLER_ERROR,
              error
            });
          }
        });
      }

      return resolve({ name, id, rev, domain, endpoint, methods, api, timeout: timeout || API_DEFAULT_TIMEOUT });
    });
  });
}

module.exports = DDoc;
