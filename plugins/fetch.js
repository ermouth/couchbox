require('sugar');
const Promise = require('bluebird');
const fetch = require('node-fetch');
const couchdb = require('../utils/couchdb');
const config = require('../config');

const NODE_NAME = config.get('couchbox.nodename');
const NODE_URL = config.get('couchdb.connection') +'://'+ config.get('couchdb.ip') +':'+ config.get('couchdb.port');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
const HTTP_METHODS_VALID = {}; HTTP_METHODS.forEach(m => HTTP_METHODS_VALID[m] = true);

const nodes = config.get('couchbox.nodes') || {};
const getNodeURL = node => nodes[node];
const getUrlDomain = (url, startInd) => {
  if (url && url.length > 7 && url.substr(0, 4) === 'http') {
    if (!startInd) startInd = url.indexOf(':', 3) + 3;
    let endInd = url.indexOf(':', startInd);
    if (endInd < 1) endInd = url.indexOf('/', startInd + 3);
    if (endInd < 1) endInd = url.length;
    return url.substring(startInd, endInd);
  }
};
const hasUrlHttp = url => /^https?:/.test(url);

function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'fetch');

  const nodesDomains = {};
  const checkUrl = (url) => {
    const domain = getUrlDomain(url);
    if (!domain) return new Error('Empty connection type');
    if (domain[0] === '/') return new Error('Bad url path');
    if (domain in nodesDomains && url.indexOf('/_config') > 0) return new Error('Denied access');
    return null;
  };

  Object.keys(nodes).map(getNodeURL).filter(u => checkUrl(u) === null).forEach(u => {
    nodesDomains[getUrlDomain(u)] = true;
  });

  const fetch_method = (ref) => function (params) {
    const options = Object.isObject(arguments[0]) ? arguments[0] : {};
    let url = Object.isString(arguments[0]) ? arguments[0] : options.url;

    if (!url) return Promise.reject(new Error('Bad url: '+ url));

    const queryParams = {};

    if (options.method) {
      const method = options.method.toUpperCase();
      if (!HTTP_METHODS_VALID[method]) return Promise.reject(new Error('Bad method: '+ method));
      queryParams.method = method;
    } else {
      queryParams.method = HTTP_METHODS[0];
    }

    if (!options.node && !hasUrlHttp(url)) options.node = NODE_NAME;
    if (options.node) {
      const nodeURL = getNodeURL(options.node);
      if (!nodeURL) return Promise.reject(new Error('Bad node: '+ options.node));
      if (hasUrlHttp(url)) return Promise.reject(new Error('Bad url: '+ url));
      url = getNodeURL(options.node) + (url[0] === '/' ? '' : '/') + url;
    }
    const urlError = checkUrl(url);
    if (urlError) return Promise.reject(new Error('Bad url: "'+ url + '" reason: '+ urlError.toString()));

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

  return new Promise(resolve => {

    function make(env) {
      const { ref, ctx } = env;
      return fetch_method(ref).bind(ctx);
    }

    resolve({ name, make });
  });
}

module.exports = Plugin;