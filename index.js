// config
const config = require('./config');

const DB = require('./models/db');


const dbs = {};
Object.keys(config.couchdb.hooks).forEach((dbdocKey) => {
  const dbdoc = dbdocKey.split(/\//);
  const db = dbdoc[0];
  const ddoc = dbdoc[1];
  const props = config.couchdb.hooks[dbdocKey].split(/s+/);

  if (!dbs[db]) dbs[db] = new DB(db);
  dbs[db].addDDoc(ddoc, props);
});
