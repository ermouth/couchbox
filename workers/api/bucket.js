const Promise = require('bluebird');
const DDoc = require('./ddoc');
const Logger = require('../../utils/logger');
const couchdb = require('../../utils/couchdb');
const config = require('../../config');

const {
  API_DEFAULT_TIMEOUT,
  LOG_EVENTS: {
    BUCKET_ERROR, API_DDOC_ERROR
  }
} = require('./constants');

function Bucket(props = {}) {
  const { name } = props;
  const logger = new Logger({ prefix: 'Bucket', scope: name, logger: props.logger });
  const log = logger.getLog();

  const bucket = couchdb.connectBucket(name);

  const ddocs = new Set();
  let timeout = 0;
  let seq = 0;
  let feed;

  function getSeq() {
    return seq;
  }
  function getBucket() {
    return bucket;
  }

  function init(endpoints = {}) {
    return new Promise(function(resolve, reject) {
      let keys;
      const handlers = [];
      if (!(endpoints && Object.isObject(endpoints) && (keys = Object.keys(endpoints)) && keys.length)) return reject(new Error('Bad endpoints'));
      Promise.map(keys, function(key){
        const { ddoc, endpoint, domain, methods } = endpoints[key];
        const ddocId = '_design/' + ddoc;
        if (!ddocs.has(ddocId)) ddocs.add(ddocId);
        return DDoc(bucket, name, { logger, name: ddoc, domain, endpoint, methods })
          .catch(function(error){
            log({
              message: 'Error init DDoc: '+ ddoc,
              event: API_DDOC_ERROR,
              error,
              type: 'fatal'
            });
          });
      })
        .catch(function(error){
          log({
            message: 'Error init Bucket: '+ name,
            event: BUCKET_ERROR,
            error,
            type: 'fatal'
          });
        })
        .then(function(results){
          const bucket = { name, getSeq, getBucket };
          results.forEach(function(info){
            if (!(info && info.domain && info.api )) return null;
            if (info.timeout && timeout < info.timeout) timeout = info.timeout;
            const { domain, endpoint } = info;
            info.api.forEach(function(apiItem){
              handlers.push(Object.assign({ domain, endpoint, bucket }, apiItem));
            });
          });
        })
        .finally(function(){
          bucket.info(function(error, info){
            if (error || !info) {
              if (!error) error = new Error('No bucket info');
              log({
                message: 'Error init Bucket: '+ name,
                event: BUCKET_ERROR,
                error,
                type: 'fatal'
              });
              reject(error);
            }
            seq = info.update_seq;
            if (!timeout) timeout = API_DEFAULT_TIMEOUT;
            return resolve({ timeout, handlers });
          });
        });
    });
  }

  function onUpdate(callback) {
    if (!callback) return null;
    if (feed) return null;
    feed = bucket.follow({ since: 'now' });
    feed.on('change', function (change) {
      if (seq < change.seq) seq = change.seq;
      if (change && change.id && ddocs.has(change.id)) {
        feed.stop();
        callback(true);
      }
    });
    feed.follow();
  }

  function close() {
    if (feed) feed.stop();
    return Promise.resolve();
  }

  return { name, init, close, onUpdate };
}

module.exports = Bucket;
