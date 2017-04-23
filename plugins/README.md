# Couchbox plugins

Plugins allows hooks and REST API functions to communicate with outside world.
Each plugin exports a function or a class object, accesible through
`this._methodname` during lambda runtime.

Plugins are configured on init with an object, parsed from JSON string,
taken from CouchDB config. Plugin named `xyz.js` imlements `this._xyz`
and receives config from the key `couchbox_plugins/xyz`.

Couchbox built-in plugins, in AZ order:

__Plugin__ | Description
---|---
[this.\_bank](#this_bank) | Access to SBRF API for web merchants.
[this.\_bucket](#this_bucket) | Provides access to CouchDB bucket.
[this.\_cache](#this_cache) | Redis-backed fast cache.
[this.\_email](#this_email) | Email sender.
[this.\_fetch](#this_cache) | Access to CouchDB across nodes.
this.\_jpegtran | Proxy method for jpegtran lib.
[this.\_kkm](#this_kkm) | Fiscal reports, required in Russia since 2017.
this.\sms | Sends SMS.
[this.\_socket](#this_socket) | Sends messages to socket.

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

#### this.\_cache(key'',data,tags{}?) → Promise

Stores `data` under `key` with optional `tags`. More expressive alias for saving data.

#### this.\_cache(key'',null) → Promise

Evicts an entry, stored under the `key`. Wildcard keys are supported like 
in node-stow.

#### this.\_cache(null,null,tags{}) → Promise

Invalidates keys by `tags`. Calling `this.\_cache(null,null,{tag2:3})` evicts all
entries with value `3` in `tag2` tag, whatever it is.

---

## this.\_email

The `_email` method provides access to mail sender, which is a thin wrapper around
[nodemailer](https://www.npmjs.com/package/nodemailer). Like other Couchbox methods, 
`this._email` returns Promise.

```javascript
this._email ({
  to: 'r2@woo.com',       // or to:'r1@example.com, r2@woo.com'
  from:'',                // Optional, default should be configured in Couch cfg
  subject:'',             // Required
  text:'',                // Text representation, required
  html:'',                // Optional html representation
  attachments:[           // Attached files, optional
    {
      filename:'foo.jpg',
      contentType:'',     // valid mime
      content: Buffer | String,	// only buffer or b64 string, streams are denied
      //cid:''            // cid for inlined images
    }
  ]
})
.then(function(){ /* do smth on success */})
.catch(function(err){ /* process errors */})
```
Note, that attachements do not allow passing `.href` or `.path` properties for 
an attach. Only properties ensuring no sandbox escape are allowed.

---

## this.\_socket

Method, sends a message to a socket. Wrapper over [socket.io](https://socket.io/), 
only allowing to send. Returns a promise, fulfilled on success and rejected on fail.

Syntax is `this._socket (channel'', message) → Promise → true`. A message can 
be of any JSONable type, channel name should be a string.

Unlike other plugins, the socket plugin is configured in the main `couchbox` config 
section, under the `socket` key. The value should be stringified JSON, like
`{"active":true,"port":8000,"path":"/_socket"}`. 

At the client side socketio should connect using both port and path from the config.

Socket connections do not require user to be authorized.

---

## this.\_kkm

The `this._kkm` method provides access to pre-configured and running
[kkm server](https://kkmserver.ru/KkmServer). The plugin provides fiscal reports,
required for web strores in Russia since 2017.

#### this.\_kkm('devices') → Promise

Returns promise with a list of devices available.

#### this.\_kkm('sell', deviceNum, userContact'', products, toPrint?) → Promise

Registers payed deal (successful buy).

Required:
* `.deviceNum` num of kkm device (default = 0)
* `.userContact` client contact: email or phone number
* `.products` array of products `[{name'', count, price, amount}]`

Not required
* `.toPrint` true if need to print on paper (default = false)

#### this.\_kkm('open', deviceNum?]) → Promise

Opens shift.

#### this.\_kkm('zreport', deviceNum?]) → Promise

Makes ZReport.

#### this.\_kkm('xreport', deviceNum?]) → Promise

Makes XReport.

#### this.\_kkm('status', deviceNum?]) → Promise

Gets device status

#### this.\_kkm('checkCommand', commandId]) → Promise

Gets command status.

#### this.\_kkm('lineLength', deviceNum?]) → Promise

Gets device line length.

---

## this.\_bank

The `this._bank` method provides an access to [Sberbank acquiring API](https://developer.sberbank.ru/acquiring). 

#### this.\_bank('register', opts={}) → Promise

Registers an order using the opts object of properties:

Required props:
* `.userName`    login from api
* `.password`    password from api
* `.orderNumber` order number in shop
* `.amount`      price of order
* `.returnUrl`   absolute link for redirect after `GOOD` result

Optional props:
* `.currency`    order currency in `ISO 4217`
* `.failUrl`     absolute link for redirect after `BAD` result
* `.description` order description
* `.language`    language in `ISO 639-1`
* `.pageView`    interface type `DESKTOP | MOBILE | custom template`
* `.clientId`    client id in shop
* `.merchantLogin` for register order from child merchant
* `.jsonParams` custom json meta
* `.sessionTimeoutSecs` order TTL - `default 1200 sec = 20 min`
* `.expirationDate` order expiration date
* `.bindingId`

#### this.\_bank('reverse', {userName*, password*, orderId*, language}) → Promise

Reverses (cancels) an order.

Required options properties:
* `.userName` login from api
* `.password` password from api
* `.orderId`  order id, bank generated

Optional properties:
* `.language` language in `ISO 639-1`

#### this.\_bank('getOrderStatus', {userName*, password*, orderId*, language}) → Promise

Load order status by `id`

Required:
* `.userName` login from api
* `.password` password from api
* `.orderId`  order id, bank generated

Optional:
* `.language` language in `ISO 639-1`

#### this.\_bank('getOrderStatusExtended', {userName*, password*, orderId*, orderNumber*, language}) → Promise

Load order status by `id` in bank and `id` in shop 

Required:
* `.userName`    login from api
* `.password`    password from api
* `.orderId`     order id, bank generated
* `.orderNumber` order id, local

Optional:
* `.language` language in `ISO 639-1`

#### this.\_bank('verifyEnrollment', {userName*, password*, pan*}) → Promise

Verifies if a card is 3d secure memeber.

Required:
* `.userName` login from api
* `.password` password from api
* `.pan`      card number `12..19`

#### this.\_bank('getLastOrdersForMerchants', {userName*, password*, language, page, size*, from*, to*, transactionStates*, merchants*, searchByCreatedDate}) → Promise

Fetches orders by several filter criteria.

Required:
* `.userName` login from api
* `.password` password from api
* `.size`     count elements per page
* `.from`     from date `YYYYMMDDHHmmss`
* `.to`       to date `YYYYMMDDHHmmss`
* `.transactionStates` orders states `CREATED, APPROVED, DEPOSITED, DECLINED, REVERSED, REFUNDED`
* `.merchants` list of merchantes
* `.searchByCreatedDate` `true`- search by date of created `false`- by date of payment `default false`

#### this.\_bank('refund', {userName*, password*, orderId*, amount*}) → Promise

Refund money from order by `id`

Required:
* `.userName`  login from api
* `.password`  password from api
* `.orderId`   order id in bank
* `.amount`    money amount
