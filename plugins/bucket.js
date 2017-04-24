require('sugar');
const Promise = require('bluebird');


function Plugin(method, conf, log) {
  const name = '_' + (method || 'bucket');

  function Bucket(bucket) {
    if (!bucket) {
      const error = new Error('Empty bucket');
      log({
        message: 'Error on init bucket plugin',
        event: 'plugin/error',
        error,
        type: 'fatal'
      });
      throw error;
    }

    function get(id, params = {}) {
      if (!id) return Promise.reject(new Error('Bad document id: '+ id));
      if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

      return new Promise((resolve, reject) => bucket.get(id, params, (error, result) => error ? reject(error) : resolve(result)));
    }

    function allDocs(params = {}) {
      if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

      return new Promise((resolve, reject) => bucket.list(params, (error, result) => error ? reject(error) : resolve(result)));
    }

    function query(designname, viewname, params = {}) {
      if (!designname) return Promise.reject(new Error('Bad design document name: '+ designname));
      if (!viewname) return Promise.reject(new Error('Bad view name: '+ viewname));
      if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

      return new Promise((resolve, reject) => bucket.view(designname, viewname, params, (error, result) => error ? reject(error) : resolve(result)));
    }

    return { get, allDocs, query };
  }

  function make({ bucket }) {
    return new Bucket(bucket);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;