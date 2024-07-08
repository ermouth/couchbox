const argv = require('minimist')(process.argv.slice(2));
require('sugar');
const Promise = require('bluebird');

const crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');


const isS = Object.isString;
const isO = Object.isObject;
const isA = Object.isArray;
const isB = Object.isBoolean;
const isN = Object.isNumber;


// load json file
const loadJSON = (filePath) => new Promise((resolve, reject) => {
  if (!(filePath && isS(filePath))) return {};
  fs.stat(filePath, (errorCheck) => {
    if (errorCheck) return reject(errorCheck);
    fs.readFile(filePath, (errorLoad, res) => {
      if (errorLoad) return reject(errorLoad);
      if (!res) return reject(new Error('No file'));
      let json;
      try {
        json = JSON.parse(res.toString());
      }
      catch (errorParse) {
        return reject(errorParse);
      }
      if (json && isO(json)) {
        return resolve(json);
      }
      return reject(new Error('Bad json'));
    });
  });
});

// load couchbox.json
const getConfigFile = loadJSON;

// load doc.json
const getDoc = (filePath) => loadJSON(filePath).then(json => {
  let i = filePath.lastIndexOf('/');
  if (i >= 0) filePath = filePath.substr(i + 1, filePath.length - i - 1).replace('.json', '');
  i = filePath.indexOf('=');
  filePath = [filePath.substr(0, i), filePath.substr(i + 1).replace('-', '/')];
  return [filePath, json];
});

// load list of docs
const getDocs = (docs) => {
  if (!(docs && isA(docs) && docs.length > 0)) return Promise.resolve([]);
  return Promise.map(docs, getDoc);
};


const checkAddress = (() => {
  const httpR = /^https?:\/\//;
  const domainR = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
  return (address) => isS(address) && httpR.test(address) && domainR.test(address.replace(httpR, ''));
})();

const toSecret = secret => {
  if (secret === null || secret === undefined) return null;
  if (!(isS(secret) && secret.length === 32)) {
    console.log('Generate new secret');
    secret = '' + Date.now() + ((secret + '') ||  Number.random(1000000, 10000000)).toString();
    secret = crypto.createHash('md5').update(secret).digest("hex");
  }
  return secret;
};

const MODE_OVERWRITE  = 'MODE_OVERWRITE';
const MODE_PATCH      = 'MODE_PATCH';
const toMode = mode => {
  switch (mode) {
    case 'o':
    case 'overwrite':
      return MODE_OVERWRITE;
    default:
      return MODE_PATCH;
  }
};

const CONFIG_PATH   = isS(argv._[0]) ? argv._[0] : null;
const DOCS         = isS(argv.D) ? argv.D.split(',') : [];
const NODE_NAME     = isS(argv.n) ? argv.n : null;
const COUCHDB_USER  = isS(argv.u) ? argv.u : null;
const COUCHDB_PASS  = isS(argv.p) ? argv.p : null;
const REDIS_PASS    = isS(argv.r) ? argv.r : null;
const COUCHDB_IP    = isS(argv.A) ? argv.A : '127.0.0.1';
const COUCHDB_PORT  = isS(argv.P) ? argv.P : '5984';
const CORS          = isS(argv.c) ? argv.c.split(',').filter(checkAddress) : [];
const SECRET        = isS(argv.s) ? toSecret(argv.s) : null;
const MODE          = isS(argv.m) ? toMode(argv.m) : null;

const COUCHDB_URL   = 'http://'+ COUCHDB_USER +':'+ COUCHDB_PASS +'@'+ COUCHDB_IP +':'+ COUCHDB_PORT;


// query to db
const dbQuery = (path, method = 'GET', body) => {
  const query = {
    method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
    }
  };
  if (body) query.body = JSON.stringify(body);
  const url = COUCHDB_URL + (path[0] === '/' ? path : '/' + path);
  return fetch(url, query).then(res => method === 'HEAD' ? res : res.json());
};

// remove item form couchdb config
const removeConfigItem = (path) => {
  console.log('Remove config item');
  console.log('>', path);

  return dbQuery('_node/_local/_config/' + encodeURI(path), 'DELETE').then(res => {
    if (res && res.error && res.reason) {
      throw new Error('Error remove '+ path +' ' + res.reason);
    }
    return ['REMOVED config item "' + path + '"', res];
  });
};

// save item to couchdb config
const saveConfigItem = (path, val) => {
  console.log('Save config item');
  console.log('>', path, val);

  if (isB(val) || isN(val)) val = val.toString();

  return dbQuery('_node/_local/_config/' + encodeURI(path), 'PUT', val).then(res => {
    if (res && res.error && res.reason) {
      throw new Error('Error save '+ path +' ' + res.reason);
    }
    return ['SAVED config item "' + path + '"', (res || val)];
  });
};

// check db on exists
const checkDB = (dbName) => {
  console.log('Check db on exists');
  console.log('>', dbName);

  return dbQuery(dbName, 'HEAD').then(res => {
    if (res && res.status === 200) return true;
    throw new Error('No db '+ dbName);
  });
};

// create db
const createDB = (dbName) => {
  console.log('Create db');
  console.log('>', dbName);

  return dbQuery(dbName+'?q=1&n=1', 'PUT').then(res => {
    if (res && res.ok === true) return true;
    throw new Error('Error on create db '+ dbName + (res && res.error && res.reason ? ' ' + res.reason : ''));
  });
};

// save doc
const saveDoc = ([[db, name], json]) => {
  console.log('Save doc');
  console.log('>', db, name);

  const docPath = db +'/'+ name;

  return checkDB(db)
    .catch(() => createDB(db))
    .then(() => dbQuery(docPath))
    .then(doc => {
      if (doc && doc._id && doc._rev) json._rev = doc._rev;
      return dbQuery(docPath, 'PUT', json);
    })
    .then(res => ['SAVED document "' + db +'/'+ name +'"', res && res.ok === true]);
};

// check main params
const checkParams = () => new Promise((resolve, reject) => {
  const rewrite = {
    couchbox: {}
  };

  if (CORS && CORS.length > 0) {
    rewrite.cors =  { origins: CORS.join(', ') };
  }

  if (NODE_NAME) {
    if (isS(NODE_NAME) && NODE_NAME.length > 0) {
      rewrite.couchbox.nodename = NODE_NAME;
    } else {
      return reject(new Error('Bad node name'));
    }
  }

  if (SECRET) {
    if (isS(SECRET) && SECRET.length === 32) {
      rewrite.couch_httpd_auth =  { secret: SECRET };
    } else {
      return reject(new Error('Bad secret'));
    }
  }

  if (REDIS_PASS) {
    if (isS(REDIS_PASS) && REDIS_PASS.length > 0) {
      rewrite.couchbox.redis_password = REDIS_PASS;
    } else {
      return reject(new Error('Bad redis password'));
    }
  }

  resolve(rewrite);
});


const onSetup = ([params, conf, json, docs]) => {
  const save_actions = [];
  const remove_actions = [];

  if (conf.couchbox_hooks) Object.keys(conf.couchbox_hooks).forEach(key => remove_actions.push([ 'couchbox_hooks/'+ key ]));
  if (conf.couchbox_api) Object.keys(conf.couchbox_api).forEach(key => remove_actions.push([ 'couchbox_api/'+ key ]));

  const c = Object.extended({}).merge(json).merge(params, true);
  Object.keys(c).forEach(k1 => Object.keys(c[k1]).forEach(k2 => save_actions.push([k1 +'/'+ k2, c[k1][k2]])));


  const onResult = res => res.forEach(row => console.log(row.join(' = ')));


  const cleanConfig = () => Promise.map(remove_actions, args => removeConfigItem.apply(this, args), { concurrency: 1 });
  const patchConfig = () => Promise.map(save_actions, args => saveConfigItem.apply(this, args), { concurrency: 1 }).then(onResult);
  const updateDocs = () => Promise.map(docs, saveDoc).then(onResult);


  if (MODE === MODE_PATCH) {
    return patchConfig().then(updateDocs);
  } else {
    return cleanConfig().then(patchConfig).then(updateDocs);
  }
};


// validate params, load couchbox.json & docs
const tasks = [
  checkParams(),
  dbQuery('/_node/_local/_config'),
  getConfigFile(CONFIG_PATH),
  getDocs(DOCS)
];

Promise.all(tasks)
  .then(onSetup)
  .catch(err => console.error(err));
