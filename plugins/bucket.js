require('sugar');
const Promise = require('bluebird');


function Plugin(method, conf, log) {
  const name = '_' + (method || 'bucket');

  function Bucket(bucket) {
    if (!bucket) return null;

    function get() {
      const id = arguments[0];
      const params = arguments[1] || {};

      if (!id) return Promise.reject(new Error('Bad document id: '+ id));
      if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

      return new Promise((resolve, reject) => bucket.get(id, params, (error, result) => error ? reject(error) : resolve(result)));
    }

    function allDocs() {
      const params = arguments[0] || {};

      if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

      return new Promise((resolve, reject) => bucket.list(params, (error, result) => error ? reject(error) : resolve(result)));
    }

    function query() {
      const designname = arguments[0];
      const viewname = arguments[1];
      const params = arguments[2] || {};

      if (!designname) return Promise.reject(new Error('Bad designname: '+ designname));
      if (!viewname) return Promise.reject(new Error('Bad viewname: '+ viewname));
      if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

      return new Promise((resolve, reject) => bucket.view(designname, viewname, params, (error, result) => error ? reject(error) : resolve(result)));
    }

    return { get, allDocs, query };
  }

  return new Promise(resolve => {

    function make(env) {
      const { bucket } = env;
      return new Bucket(bucket);
    }

    resolve({ name, make });
  });
}

module.exports = Plugin;