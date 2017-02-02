const Promise = require('bluebird');
const lib = require('../utils/lib');
const Logger = require('../utils/logger');
const couchdb = require('../utils/couchdb');
const DDoc = require('./ddoc');
const config = require('../config');

const {} = require('../constants/logEvents');
const {} = require('../constants/bucket');

function Bucket(props = {}) {
  const { name } = props;
  const logger = new Logger({ prefix: 'DB '+ name, logger: props.logger });
  const log = logger.getLog();

  const bucket = couchdb.connectBucket(name);

  const ddocs = {};

  const handlers = {};

  const init = (endpoints) => {
    let keys;
    if (!(endpoints && Object.isObject(endpoints) && (keys = Object.keys(endpoints)) && keys.length)) return Promise.reject(new Error('Bad endpoints'));
    return Promise.all(keys.map(key => {
      const { ddoc, endpoint, domain, methods } = endpoints[key];
      return DDoc({ logger, bucket, name: ddoc, domain, endpoint, methods }).then(info => {
        ddocs[key] = info;
        return info;
      });
    })).then((results) => {
      const result = [];
      results.forEach(({ domain, endpoint, api }) => {
        api.forEach(apiItem => {
          result.push(Object.assign({ domain, endpoint }, apiItem));
        });
      });
      return result;
    });
  };


  const close = () => new Promise((resolve, reject) => {
    resolve();
  });

  return {
    name,
    init, close
  };
}

module.exports = Bucket;
