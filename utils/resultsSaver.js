require('sugar');
const Promise = require('bluebird');
const lib = require('../utils/lib');
const couchdb = require('../utils/couchdb');

const saveResults = (bucketName, docs) => {
  if (docs && docs.length) return saveBatch(bucketName, docs.shift()).then(() => saveResults(bucketName, docs));
  return Promise.resolve();
}; // save results sequential by first order recursively

const saveToBucket = (bucketName) => (doc) => {
  if (!doc) return Promise.reject(new Error('Bad document'));
  const docDB = couchdb.connectNodeBucket(doc._node, doc._db || bucketName);
  const newDoc = Object.reject(doc, /^(?!(_rev$|_id$|_attachments$))_.+$/);
  return getOldDoc(docDB, newDoc).then(oldDoc => updateDoc(docDB, oldDoc, newDoc));
}; // save one doc: load old by result params and update

const saveBatch = (bucketName, toSave) => {
  const saveDoc = saveToBucket(bucketName);
  if (Object.isObject(toSave)) return saveDoc(toSave); // if data is Object save as one document
  else if (Object.isArray(toSave)) return Promise.map(toSave, saveDoc); // if data is Array save as many docs in parallel
  else return Promise.reject(new Error('Bad results: ('+ JSON.stringify(toSave) +')')); // return error if data is not Object or Array
}; // check to save data and save

const getOldDoc = (docDB, doc) => new Promise((resolve, reject) => {
  if (!doc._id) return resolve();
  const rev = doc._rev;
  docDB.get(doc._id, rev ? { rev } : {}, (error, result) => {
    if (error) {
      if (error.error === 'not_found' && !rev) return resolve();
      return reject(error);
    }
    return resolve(result);
  });
}); // load old document

const updateDoc = (docDB, oldDoc, newDoc) => new Promise((resolve, reject) => {
  if (oldDoc) { // doc update
    newDoc._rev = oldDoc._rev;
  } else { // new doc
    if (!newDoc._id) newDoc._id = lib.uuid(); // set id as uuid if no id
  }
  docDB.insert(newDoc, (error, result) => error ? reject(error) : resolve(result));
}); // update by old and new documents

module.exports = saveResults;
