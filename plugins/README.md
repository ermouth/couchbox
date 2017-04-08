# Couchbox plugins

Plugins allows hooks and REST API functions to communicate with outside world.
Each plugin exports a function or a class object, accesible through
`this._methodname` during lambda runtime.

Plugins are configured on init with an object, parsed from JSON string,
taken from CouchDB config. Plugin named `xyz.js` imlements `this._xyz`
and receives config from the key `couchbox_plugins/xyz`.

----

## this.\_bucket

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

----

## this.\_fetch

Method `this._fetch` provides access to CouchDB instances across nodes 
listed in `couchbox/nodes` config key.

Unlike `this._bucket`, fetch is more low-level. It requires knowing CouchDB API,
and is able to return not only JSON, but Stream as well. Streams are useful for 
piping attaches or long queries directly to client.

Couchbox’s fetch is a thin wrapper around [node-fetch](https://www.npmjs.com/package/node-fetch).
The difference is `this.\_fetch()` receives only one argument and restricts destinations
reacheable.

```javascript
// General use of this._fetch
this._fetch({
	url:'url/path?params',	// mandatory relative URL
	node:'mb',				// default is own node
	method:'GET',			// default is GET
	headers:{accept:'application/json'},	// default
	userCtx:{								// default is node service
		name:'username',
		roles:['role1','role2'...]
	}
})
.then(function(streamObj){ 
    // here we do not have result yet, 
    // but have a stream ready to pipe a result
    return streamObj.json() 
})
.then(function(result){
    // here we have result as an object
})
```
Note two `.then()`s are required to receive response as an object. If receiving and
processing data is not needed, stream may be immediately passed to a client.

```javascript
this._fetch({url:'db/docid/filename.jpg'})
.then(function(stream){
    // immediately resolve lambda with 
    // the response stream
    resolve({
        code:200,
        headers:{
    		'content-type':stream.headers.get('content-type'),
    		'Cache-Control':'max-age=864000',
    		'X-Accel-Buffering':'no' // disables nginx buffering
    	}, 
    	stream: stream.body
    })
});
```
Since `this.\_fetch` allows not only GET, but also PUT and POST requests, it can
write data during lambda execution. Writing data during lambda runtime is not
recommended however.

---

## this.\_cache

The `_cache` method provides access to Redis-backed cache, based on 
[node-stow](https://github.com/cpsubrian/node-stow). 

Cache is configured using JSON in `couchbox_plugins/cache` section and have only 
one param `{"ttl":0}`. The `ttl` property defines default ttl for a cache entry,
_in seconds_. Zero creates forever lasting entries.

#### this.\_cache(key'') → Promise → {key,data,tags,ttl}

Returns promise resolved with stow object, or rejected if no key exists. Retrieving 
several kilobytes of data takes ~1…2 ms. Estimating very roughly, fetching cache 
is ~5 times faster than reading CouchDB.

#### this.\_cache({key,data,tags,ttl}) → Promise

Stores `data` of any JSONable type under the `key`, that must be a string. Optional 
`ttl` property restricts cache entry lifetime, _in seconds_.

The `tags` property is an optional object like `{tag1:10,tag2:[3,4]}`. Tags are useful
for massive group cache invalidation.

#### this.\_cache(key'',data,tags{}*) → Promise

Stores `data` under `key` with optional `tags`. More expressive alias for saving data.

#### this.\_cache(key'',null) → Promise

Evicts an entry, stored under the `key`. Wildcard keys are supported like 
in node-stow.

#### this.\_cache(null,null,tags{}) → Promise

Invalidates keys by `tags`. Calling `this.\_cache(null,null,{tag2:3})` evicts all
entries with value `3` in `tag2` tag, whatever it is.

---

## this.\_email

---

## this.\_socket
