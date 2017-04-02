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

The `get` method