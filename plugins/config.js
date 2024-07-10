require('sugar');
const Promise = require('bluebird');
const fetch = require('node-fetch');
const couchdb = require('../utils/couchdb');
const config = require('../config');

const DEBUG = config.get('debug');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
const HTTP_METHODS_VALID = {}; HTTP_METHODS.forEach(m => HTTP_METHODS_VALID[m] = true);

const NODE_NAME = config.get('couchbox.nodename');
const NODES = config.get('couchbox.nodes') || {};
const getNodeURL = node => NODES[node];
const getUrlDomain = (url, startInd) => {
  if (url && url.length > 7 && url.substr(0, 4) === 'http') {
    if (!startInd) startInd = url.indexOf(':', 3) + 3;
    let endInd = url.indexOf(':', startInd);
    if (endInd < 1) endInd = url.indexOf('/', startInd + 3);
    if (endInd < 1) endInd = url.length;
    return url.substring(startInd, endInd);
  }
};

const configPath = '/_node/_local/_config';

function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'fetch');

  const nodesDomains = {
    '127.0.0.1': true
  };
  const checkUrl = (url) => {
    const domain = getUrlDomain(url);
    if (!domain) return new Error('Empty connection type');
    if (domain[0] === '/') return new Error('Bad url path');
    return null;
  };

  Object.keys(NODES).map(getNodeURL).filter(u => checkUrl(u) === null).forEach(u => {
    nodesDomains[getUrlDomain(u)] = true;
  });

  function config_method(ref) {
    return function get_config(node, userCtx) {

      let url, authHeaders;
      const queryParams = {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json; charset=utf-8'
        }
      };

      if ((!node || node === NODE_NAME)) {
        url = couchdb.Constants.DB_URL + configPath;
      } else {
        const nodeURL = getNodeURL(node);
        if (nodeURL) {
          url = nodeURL + configPath;
        } else {
          return Promise.reject(new Error('Bad node: '+ node));
        }
      }

      try {
        authHeaders = couchdb.makeAuthHeaders(userCtx || {
          name: 'system',
          roles:['_admin']
        });
      } catch(error) {
        return Promise.reject(error);
      }

      Object.assign(queryParams.headers, authHeaders);

      return fetch(url, queryParams).then(res => {
        return res.json();
      })
    }
  }

  function make(env) {
    const { ref, ctx } = env;
    return config_method(ref).bind(ctx);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;