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

function getNodeURL(node) {
  return NODES[node];
}

function hasUrlHttp(url) {
  return /^http[s]?:/.test(url);
}

function getUrlDomain(url, startInd) {
  if (url && url.length > 7 && url.substr(0, 4) === 'http') {
    if (!startInd) startInd = url.indexOf(':', 3) + 3;
    let endInd = url.indexOf(':', startInd);
    if (endInd < 1) endInd = url.indexOf('/', startInd + 3);
    if (endInd < 1) endInd = url.length;
    return url.substring(startInd, endInd);
  }
}

function toQS(query = {}) {
  let queryString = Object.keys(query).map(function(key){
    let value = query[key];
    if (Object.isString(value)) value = encodeURIComponent(value);
    else value = JSON.stringify(value);
    return key +'=' + value;
  });
  return queryString.length > 0 ? '?' + queryString.join('&') : '';
}




function qsCover(paramObj) {
  Object.keys(paramObj).forEach(function (key) {
    switch (key) {
      case 'key':
      case 'startkey':
      case 'start_key':
      case 'endkey':
      case 'end_key':
        paramObj[key] = JSON.stringify(paramObj[key]);
        break;
    }
  });
  return paramObj;
}

function parseUrlSugar(url) {
  if (Object.isArray(url)) {
    let urlParams = url.slice();
    let urlQuery = {};
    url = '';
    urlParams.forEach(function (param) {
      if (Object.isString(param)) {
        if (param) url += url ? '/' + param : param;
      }
      else if (Object.isObject(param)) {
        Object.assign(urlQuery, param);
      }
    });
    url = url + toQS(qsCover(urlQuery));
  }
  return url;
}

function checkResult(res) {
  if (!res.ok) return Promise.reject(res.status +' '+ res.statusText);
  return Promise.resolve(res);
}
function onBuffer(res) {
  return res.buffer();
}
function onText(res) {
  return res.text();
}
function onJSON(res) {
  return res.json();
}

function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'fetch');

  const nodesDomains = {
    '127.0.0.1': true
  };

  function checkUrl(url) {
    const domain = getUrlDomain(url);
    if (!domain) return 'Empty connection type';
    if (domain[0] === '/') return 'Bad url path';
    if (nodesDomains.hasOwnProperty(domain) && url.indexOf('/_config') > 0) return 'Access denied';
    return null;
  }

  Object.keys(NODES).map(getNodeURL).filter(u => !checkUrl(u)).forEach(u => {
    nodesDomains[getUrlDomain(u)] = true;
  });

  const fetch_method = (ref) => function () {
    const options = Object.isObject(arguments[0]) ? arguments[0] : {};
    let url = Object.isString(arguments[0]) ? arguments[0] : parseUrlSugar(options.url);
    if (!(Object.isString(url) && url.length > 0)) return Promise.reject(new Error('Bad url: '+ url));

    const queryParams = {
      headers: {}
    };

    if (options.method) {
      const method = options.method.toUpperCase();
      if (!HTTP_METHODS_VALID[method]) return Promise.reject(new Error('Bad method: '+ method));
      queryParams.method = method;
    } else {
      queryParams.method = HTTP_METHODS[0];
    }

    if ((!options.node || options.node === NODE_NAME) && !hasUrlHttp(url)) {
      url = couchdb.Constants.DB_URL + (url[0] === '/' ? '' : '/') + url;
    }
    if (options.node && !hasUrlHttp(url)) {
      const nodeURL = getNodeURL(options.node);
      if (!nodeURL) return Promise.reject(new Error('Bad node: '+ options.node));
      if (hasUrlHttp(url)) return Promise.reject(new Error('Bad url: '+ url));
      url = getNodeURL(options.node) + (url[0] === '/' ? '' : '/') + url;
    }
    const urlError = checkUrl(url);
    if (urlError) return Promise.reject(new Error('Bad url: "'+ url + '" reason: '+ urlError));

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

    if (options.headers && Object.isObject(options.headers)) {
      Object.assign(queryParams.headers, options.headers);
    }

    if (options.lift) switch (options.lift) {
      case 'buffer':
        return fetch(url, queryParams).then(checkResult).then(onBuffer);
      case 'text':
        return fetch(url, queryParams).then(checkResult).then(onText);
      case 'json':
        return fetch(url, queryParams).then(checkResult).then(onJSON);
    }
    return fetch(url, queryParams);
  };


  function make(env) {
    const { ref, ctx } = env;
    return fetch_method(ref).bind(ctx);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;