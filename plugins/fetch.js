require('sugar');
const Promise = require('bluebird');
const fetch = require('node-fetch');
const couchdb = require('../utils/couchdb');
const config = require('../config');

const NODE_NAME = config.get('couchbox.nodename');
const NODE_URL = config.get('couchdb.connection') +'://'+ config.get('couchdb.ip') +':'+ config.get('couchdb.port');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
const HTTP_METHODS_VALID = {}; HTTP_METHODS.forEach(m => HTTP_METHODS_VALID[m] = true);
const getNodeURL = (node) => NODE_NAME === node
  ? NODE_URL
  : config.get('nodes.domainPrefix') + node +'.'+ config.get('nodes.domain');

function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'fetch');

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

    if (options.node) {
      const nodeURL = getNodeURL(options.node);
      if (!nodeURL) return Promise.reject(new Error('Bad node: '+ options.node));
      if (/^https?:/.test(url)) return Promise.reject(new Error('Bad url: '+ url));
      url = getNodeURL(options.node) + (url[0] === '/' ? '' : '/') + url;
    } else {
      if (!/^https?:/.test(url)) {
        url = NODE_URL + (url[0] === '/' ? '' : '/') + url;
      }
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

  return new Promise(resolve => {

    function make(env) {
      const { ref, ctx } = env;
      return fetch_method(ref).bind(ctx);
    }

    resolve({ name, make });
  });
}

module.exports = Plugin;