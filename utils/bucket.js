require('sugar');
const Promise = require('bluebird');

function Bucket(db) {
  if (!db) return null;

  function get() {
    const id = arguments[0];
    const params = arguments[1] || {};

    if (!id) return Promise.reject('Bad document id');
    if (!Object.isObject(params)) return Promise.reject('Bad params');

    return new Promise((resolve, reject) => {
      db.get(id, params, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }

  function allDocs() {
    const params = arguments[0] || {};

    if (!Object.isObject(params)) return Promise.reject('Bad params');

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

    if (!designname) return Promise.reject('Bad designname');
    if (!viewname) return Promise.reject('Bad viewname');
    if (!Object.isObject(params)) return Promise.reject('Bad params');

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
