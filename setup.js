const argv = require('minimist')(process.argv.slice(2));
require('sugar');
const Promise = require('bluebird');

const crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');

const isS = Object.isString;
const isO = Object.isObject;
const isB = Object.isBoolean;
const isN = Object.isNumber;


const checkAddress = (() => {
  const httpR = /^https?:\/\//;
  const domainR = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
  return (address) => isS(address) && httpR.test(address) && domainR.test(address.replace(httpR, ''));
})();

const toSecret = secret => {
  if (!(isS(secret) && secret.length === 32)) {
    console.log('Generate new secret');
    secret = '' + Date.now() + (secret ||  Number.random(1000000, 10000000)).toString();
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

const CONFIG_PATH   = argv._[0];
const NODE_NAME     = argv.n;
const COUCHDB_USER  = argv.u;
const COUCHDB_PASS  = argv.p;
const COUCHDB_IP    = argv.ip || '127.0.0.1';
const COUCHDB_PORT  = argv.port || 5984;
const COUCHDB_URL   = 'http://'+ COUCHDB_USER +':'+ COUCHDB_PASS +'@'+ COUCHDB_IP +':'+ COUCHDB_PORT;
const CORS          = (argv.c || '').split(',').filter(checkAddress);
const SECRET        = toSecret(argv.s);
const MODE          = toMode(argv.m);


const dbQuery = (path) => fetch(COUCHDB_URL + path, {
  method: 'GET',
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
  }
}).then(res => res.json());

const removeConfigItem = (path) => {
  console.log('remove config item', path);
  return fetch(COUCHDB_URL + '/_config/' + encodeURI(path), {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
    },
  }).then(res => res.json())
    .then(res => {
      if (res && res.error && res.reason) {
        throw new Error('Error save '+ path +' ' + res.reason);
      }
      return [path, res];
    });
};

const saveConfigItem = (path, val) => {
  console.log('save config item', path, val);
  if (isB(val) || isN(val)) {
    val = val.toString();
  }
  return fetch(COUCHDB_URL + '/_config/' + encodeURI(path), {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(val)
  }).then(res => res.json())
    .then(res => {
      if (res && res.error && res.reason) {
        throw new Error('Error save '+ path +' ' + res.reason);
      }
      return [path, res];
    });
};

const getConfigFile = (filePath) => new Promise((resolve, reject) => {
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

const checkParams = () => new Promise((resolve, reject) => {
  const rewrite = {
    cors: {
      origins: CORS.join(', ')
    },
    couch_httpd_auth: {
      secret: SECRET
    },
    couchbox: {}
  };

  if (NODE_NAME) {
    if (!(isS(NODE_NAME) && NODE_NAME.length > 0)) return reject(new Error('Bad node name'));
    rewrite.couchbox.nodename = NODE_NAME;
  }
  if (!(SECRET && isS(SECRET) && SECRET.length === 32)) return reject(new Error('Bad secret'));

  resolve(rewrite);
});

Promise.all([
  checkParams(),
  dbQuery('/_config'),
  getConfigFile(CONFIG_PATH)
]).then(([params, conf, json]) => {
  const save_actions = [];
  const remove_actions = [];

  if (conf.couchbox_hooks) Object.keys(conf.couchbox_hooks).forEach(key => remove_actions.push([ 'couchbox_hooks/'+ key ]));
  if (conf.couchbox_api) Object.keys(conf.couchbox_api).forEach(key => remove_actions.push([ 'couchbox_api/'+ key ]));

  const c = Object.extended({}).merge(json).merge(params, true);
  Object.keys(c).forEach(k1 => Object.keys(c[k1]).forEach(k2 => save_actions.push([k1 +'/'+ k2, c[k1][k2]])));

  const patchConfig = () => Promise.map(save_actions, args => saveConfigItem.apply(this, args), {concurrency: 1});

  if (MODE === MODE_PATCH) return patchConfig();
  return Promise.map(remove_actions, args => removeConfigItem.apply(this, args), { concurrency: 1 }).then(patchConfig);
})
  .catch(err => console.error(err))
  .then(res => res.forEach(row => console.log(row.join('\n= '))));
