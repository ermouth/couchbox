const Promise = require('bluebird');
const Logger = require('../utils/logger');
const couchdb = require('../utils/couchdb');
const DDoc = require('./ddoc');
const config = require('../config');

const { LOG_EVENT_BUCKET_ERROR, LOG_EVENT_DDOC_ERROR } = require('../constants/logEvents');
const { API_DEFAULT_TIMEOUT } = require('../constants/api');

function Bucket(props = {}) {
  const { name } = props;
  const logger = new Logger({ prefix: 'DB '+ name, logger: props.logger });
  const log = logger.getLog();

  const bucket = couchdb.connectBucket(name);

  const ddocs = {};
  let timeout = 0;

  const init = (endpoints = {}) => new Promise((resolve, reject) => {
    let keys;
    const handlers = [];
    if (!(endpoints && Object.isObject(endpoints) && (keys = Object.keys(endpoints)) && keys.length)) return reject(new Error('Bad endpoints'));
    Promise.all(keys.map(key => {
      const { ddoc, endpoint, domain, methods } = endpoints[key];
      ddoc['_design/' + ddoc] = null;
      return DDoc({ logger, bucket, name: ddoc, domain, endpoint, methods })
        .catch(error => {
          log({
            message: 'Error init DDoc: '+ ddoc,
            event: LOG_EVENT_DDOC_ERROR,
            error
          });
        })
        .then(info => {
          if (info) {
            if (timeout < info.timeout) timeout = info.timeout;
            ddocs[info.id] = info;
          }
          return info;
        });
    })).catch(error => {
      log({
        message: 'Error init Bucket: '+ name,
        event: LOG_EVENT_BUCKET_ERROR,
        error
      });
    }).then((results) => {
      results.forEach(info => {
        if (!(info && info.domain && info.endpoint && info.api )) return null;
        const { domain, endpoint } = info;
        info.api.forEach(apiItem => {
          handlers.push(Object.assign({ domain, endpoint }, apiItem));
        });
      });
    }).finally(() => {
      if (!timeout) timeout = API_DEFAULT_TIMEOUT;
      return resolve({ timeout, handlers });
    });
  });

  let feed;
  const onUpdate = (callback) => {
    if (!callback) return null;
    if (feed) return null;
    feed = bucket.follow({ since: 'now' });
    feed.on('change', function (change) {
      if (change && change.id && ddocs.hasOwnProperty(change.id)) {
        feed.stop();
        callback(true);
      }
    });
    feed.follow();
  };


  const close = () => new Promise((resolve, reject) => {
    if (feed) feed.stop();
    resolve();
  });

  return {
    name,
    onUpdate,
    init, close
  };
}

module.exports = Bucket;
