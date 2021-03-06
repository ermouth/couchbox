require('sugar');
const Promise = require('bluebird');
const mime = require('mime-types');
const JpegTran = require('jpegtran');
const stream = require('stream');
const couchdb = require('../utils/couchdb');
const config = require('../config');

const NODES = config.get('couchbox.nodes') || {};
const BASE64_HEADER = 'data:image/jpeg;base64,';
const BASE64_HEADER_SIZE = BASE64_HEADER.length;

function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'jpegtran');

  const jpegtran_method = (bucket) => (src, props = [], mode = 'buffer') => new Promise((resolve, reject) => {
    if (!src || !props || !Object.isArray(props) || props.length === 0) return reject(new Error('Bad arguments'));

    let fileStream;

    if (Object.isObject(src)) {
      const { _node, _db, _id, _fname } = src;
      if (!(_id && Object.isString(_id))) return reject(new Error('Bad src _id'));
      if (!(_fname && Object.isString(_fname))) return reject(new Error('Bad src _fname'));
      if (_node && !(Object.isString(_node) && _node in NODES)) return reject(new Error('Bad src _node'));
      if (_db && !Object.isString(_db)) return reject(new Error('Bad src _db'));
      const db = _db && Object.isString(_db)
        ? couchdb.connectNodeBucket(_node, _db)
        : bucket;

      fileStream = db.attachment.get(_id, _fname);

    } else if (Object.isString(src)) {
      fileStream = new stream.PassThrough();
      try {
        fileStream.end(
          Buffer.from(src.substring(0, BASE64_HEADER_SIZE) === BASE64_HEADER ? src.substring(BASE64_HEADER_SIZE) : src, 'base64')
        );
      } catch (error) {
        return reject(new Error('Bad src parse: "'+ error.message +'"'));
      }
    } else if (src instanceof stream.Stream) {
      fileStream = src;
    } else {
      return reject(new Error('Empty src'));
    }

    const chunks = [];
    const translator = new JpegTran(props);
    const onError = (error) => new Error('Error translating src: "'+ error.message +'"');

    if (mode === 'stream') {
      resolve(
        fileStream
        .on('error', error => log(onError(error)))
        .pipe(translator)
      );
    } else {
      fileStream
        .on('error', error => reject(onError(error)))
        .pipe(translator)
          .on('error', error => reject(onError(error)))
          .on('data', chunk => chunks.push(chunk))
          .on('end', () => resolve(mode === 'base64' ? Buffer.concat(chunks).toString('base64') : Buffer.concat(chunks)));
    }
  });

  function make(env) {
    const { ctx, bucket } = env;
    return jpegtran_method(bucket).bind(ctx);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;
