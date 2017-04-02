# Couchbox plugins

Plugins allows hooks and REST API functions to communicate with outside world.
Each plugin exports a function or a class object, accesible through
`this._methodname` during lambda runtime.

Plugins are configured on init with an object, parsed from JSON string,
taken from CouchDB config. Plugin named `xyz.js` imlements `this._xyz`
and receives config from the key `couchbox_plugins/xyz`.

## bucket

Object `this._bucket` provides read access to a bucket the lambda lives in,
and has 3 methods: `get`, `allDocs` and `query`, each returns `Promise`.
Actually, all three methods are just promisified and contextified Nano 
functions.

#### this.\_bucket.get (\_id'', opts{}?) 

Reads a doc from CouchDB bucket, returns Promise, fulfilled with doc object.
See [Nano docs](https://github.com/dscape/nano#dbgetdocname-params-callback) 
for more details on options.

#### this.\_bucket.allDocs(opts{})

Equivalent to Nano `db.list`, wrapping CouchDB `\_all\_docs` request. See 
[CouchDB docs](http://docs.couchdb.org/en/1.6.1/api/database/bulk-api.html#db-all-docs) 
for list of available options.

Returns Promise, fulfilled with CouchDB response object.

#### this.\_bucket.query(ddoc'', view'', opts{}?)

Wrapper for Nano [db.view](https://github.com/dscape/nano#dbviewdesignname-viewname-params-callback) 
method. Returns Promise, fulfilled with CouchDB response object.

## fetch

Method `this._fetch` provides access to CouchDB instances across nodes 
listed in `couchbox/nodes` config key.

Unlike `this._bucket`, fetch is more low-level. It requires knowing CouchDB API,
and is able to return not only JSON, but Stream as well. Streams are useful for 
piping attaches or long queries directly to client for instance.


