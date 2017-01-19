const config = require('../config');
const couchdb = require('../couchdb');

require('sugar');
const Promise = require('bluebird');
const fetch = require('node-fetch');


const HTTP_METHODS = {
  'GET': 1,
  'POST': 1,
  'PUT': 1,
  'DELETE': 1,
  'HEAD': 1
};

const getNodeURL = (node) => config.get('nodes.domainPrefix') + node +'.'+ config.get('nodes.domain');

module.exports = function () {
  const options = Object.isObject(arguments[0]) ? arguments[0] : {};
  let url = Object.isString(arguments[0]) ? arguments[0] : options.url;

  if (!url) return Promise.reject('Bad url');

  const queryParams = {};

  if (options.method) {
    const method = options.method.toUpperCase();
    if (!HTTP_METHODS[method]) return Promise.reject('Bad method');
    queryParams.method = method;
  } else {
    queryParams.method = 'GET';
  }

  if (options.node) {
    const nodeURL = getNodeURL(options.node);
    if (!nodeURL) return Promise.reject('Bad node');
    if (/^https?:/.test(url)) return Promise.reject('Bad url');
    url = getNodeURL(options.node) + (url[0] === '/' ? '' : '/') + url;
  }

  if (options.body) {
    queryParams.body = options.body;
  }

  if (options.userCtx) {
    const authHeaders = couchdb.makeAuthHeaders(options.userCtx);
    queryParams.headers = Object.assign(authHeaders, {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8'
    });
  }

  return fetch(url, queryParams);
};
