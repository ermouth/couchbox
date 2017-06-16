require('sugar');
const Promise = require('bluebird');
const couchdb = require('../utils/couchdb');
const config = require('../config');
const pdf = require('html-pdf');


const NODE_NAME = config.get('couchbox.nodename');
const NODES = config.get('couchbox.nodes') || {};
const TASK_2PDF_ERROR = 'html2pdf/error';

const defaults = {
  type: 'pdf'
};

function Plugin(method, conf, log) {
  const name = '_' + (method || 'html2pdf');

  const pluginOptions = {
    httpHeaders: couchdb.makeAuthHeaders((conf && conf.ctx ? conf.ctx : null) || {})
  };
  if (conf && Object.isObject(conf)) {
    if (conf.ctx) {
      pluginOptions.httpHeaders = couchdb.makeAuthHeaders(conf.ctx);
    }
    if (conf.base && conf.base.length > 0) {
      const base = conf.base.last() === '/' ? conf.base : conf.base + '/';
      if (base[0] === '/') {
        const node = conf.node && NODES[conf.node] ? conf.node : NODE_NAME;
        pluginOptions.base = NODES[node] + base;
      } else {
        pluginOptions.base = base;
      }
    }
  }

  const html2pdf_method = (ref) => function(html = '', opts = {}, stream = false) {
    if (!Object.isString(html)) return Promise.reject(new Error('Bad html'));
    if (!Object.isObject(opts)) return Promise.reject(new Error('Bad options'));

    const options = Object.assign({}, defaults, pluginOptions, opts);

    return new Promise((resolve, reject) => {
      if (stream === true) {
        pdf.create(html, options).toStream(function(error, stream){
          if (error) {
            log({
              message: 'Error create PDF',
              event: TASK_2PDF_ERROR,
              error,
              ref
            });
            return reject(error);
          }
          return resolve(stream);
        });
      } else {
        pdf.create(html, options).toBuffer(function(error, buffer){
          if (error) {
            log({
              message: 'Error create PDF',
              event: TASK_2PDF_ERROR,
              error,
              ref
            });
            return reject(error);
          }
          return resolve(buffer);
        });
      }
    });
  };

  function make({ ref, ctx }) {
    return html2pdf_method(ref).bind(ctx);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;
