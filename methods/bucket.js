require('sugar');
const Promise = require('bluebird');

function Bucket(db) {
  if (!db) return null;

  function get() {
    const id = arguments[0];
    const params = arguments[1] || {};

    if (!id) return Promise.reject(new Error('Bad document id: '+ id));
    if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

    return new Promise((resolve, reject) => {
      db.get(id, params, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }

  function allDocs() {
    const params = arguments[0] || {};

    if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

    return new Promise((resolve, reject) => {
      db.list(params, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }

  function query() {
    const designname = arguments[0];
    const viewname = arguments[1];
    const params = arguments[2] || {};

    if (!designname) return Promise.reject(new Error('Bad designname: '+ designname));
    if (!viewname) return Promise.reject(new Error('Bad viewname: '+ viewname));
    if (!Object.isObject(params)) return Promise.reject(new Error('Bad params: '+ JSON.stringify(params)));

    return new Promise((resolve, reject) => {
      db.view(designname, viewname, params, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }

  return { get, allDocs, query };
}

module.exports = Bucket;
