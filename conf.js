const argv = require('minimist')(process.argv.slice(2));
require('sugar');
const Promise = require('bluebird');

const crypto = require('crypto');
const fs = require('fs');

const isS = Object.isString;

const checkAddress = (() => {
  const httpR = /^https?:\/\//;
  const domainR = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
  return (address) => isS(address) && httpR.test(address) && domainR.test(address.replace(httpR, ''));
})();

const toSecret = secret => {
  if (!(isS(secret) && secret.length === 32)) {
    secret = '' + Date.now() + (secret ||  Number.random(1000000, 10000000)).toString();
    secret = crypto.createHash('md5').update(secret).digest("hex");
  }
  return secret;
};

const CONFIG_PATH   = argv._[0];


const NODE_NAME     = argv.n;
const COUCHDB_USER  = argv.u;
const COUCHDB_PASS  = argv.p;
const CORS          = argv.c.split(',').filter(checkAddress);
const SECRET        = toSecret(argv.s || Math.random());


const getConfig = (filePath) => new Promise((resolve, reject) => {
  fs.stat(filePath, (errorCheck) => {
    if (errorCheck) return reject(errorCheck);
    fs.readFile(filePath, (errorLoad, res) => {
      if (errorLoad) return reject(errorLoad);
      if (!res) return reject(new Error('No file'));
      try {
        resolve(JSON.parse(res.toString()));
      }
      catch (errorParse) {
        reject(errorParse);
      }
    });
  });
});

getConfig(CONFIG_PATH).then(json => {
  console.log(json);
});


console.dir({
  CONFIG_PATH,
  NODE_NAME,
  COUCHDB_USER,
  COUCHDB_PASS,
  CORS,
  SECRET
});
