# <img align="right" src="http://jquerymy.com/i/couchbox130.png" /> Couchbox

Couchbox extends CouchDB query server with backstage \_changes feed hooks and
configurable REST API. Both [hooks](#hooks) and [REST API](#rest-api) are functions
in design docs. Unlike native query server functions, couchbox parts are async and
have per-ddoc configurable access to DB and outside world via 
[aux methods](#plugins).

Couchbox is multi-worker and employs [native CouchDB config](#configs). Once started, 
Couchbox tracks changes in both CouchDB config and ddocs, and seamlessly restarts 
appropriate workers.

Unlike CouchDB, Couchbox only tracks ddocs explicitly listed in configs,
and each ddoc has own set of available aux methods, also defined in CouchDB config. 
To manage feed states properly, Couchbox requires [Redis](#redis).

Couchbox is intended for CouchDB 1.5–1.6.1 and specially designed for large 
multi-node projects.

## Hooks

Hooks are pairs of a filter function from `.filters` section and a complimentary
section in `.hooks` object. For example:

``` javascript
{
  _id: "_design/email",
  filters:{
    emailQueue: function (doc) { return doc.type=="email"; }
  },
  hooks:{
    emailQueue:{
      timeout: 10000,
      mode: 'transitive',
      lambda: function (doc) {
        var doc = doc;
        this._email({
          to:   doc.to,
          html: doc.html
        })
        .then(function(){
          doc.sent = Date.now();
          resolve ({
            code:200,              // code for log
            message:'Email sent',  // msg for log
            docs:[doc]             // docs to save
          });
        });
      }
    }
}}
```
Filter part is an ordinary filter function, except hook filters never receive `req`
argument, since there are no inbound http requests for action.

A hook object has 3 properties: 

* `.timeout`, number in milliseconds, optional
* `.lambda`, required, JS code of the hook,
* `.mode`, defines an [order of doc revs processing](#hooks-modes).

Lambda function receives a doc as an argument and must call `resolve()` or `reject()`
 in `.timeout` timeframe, or it is assumed rejected. Lambda is not allowed
to return Promise for safety reasons: a wrapper Promise must be able to auto-reject
on timeout and handle uncaught errors, so it’s safer to instantiate Promise outside
lambda code.

Lambdas have access to aux functions using `this._method` syntax, so aux functions look
like extensions of the ddoc (in CouchDB query server `this` points to parent ddoc
JSON, same in Couchbox). Most aux methods are async and return Promise.

Aux functions are implemented using plugin architecture, so third-party node.js libs
are easily mountable as plugins for Couchbox.

### Saving docs

A hook normally can not write to DB during processing. The only way to write DB is
to add `.docs` property to a resolved object. This property must be an array
of JSONs to save.

Each doc object in an array may have additional properties `_db` and `_node`,
they define destination node and DB for the doc.

Each row in the `.docs` array only runs after previous row was saved successfully.
If doc save fails, save chain stops and error is logged. Successfully saved docs
are __not__ deleted from DB on subsequent save error.

The `.docs` array can be non-plain, any row can be an array of docs also.
In this case all docs of the row are saved simultaneously, and next row is processed
only after all docs are saved successfully.

``` javascript
resolve ({
  code:200, docs:[
    [{_id:'A',_node:'N1',_db:'db1'},{_id:'B',_node:'N2',_db:'db1'}],
    [{_id:'C',_node:'N3',_db:'db1'}],
    {_id:'D'}
  ]
})
```
Above code will attempt to save docs `A` and `B` simultaneously. If succeed, 
the `C` doc is saved, and, on sucess, the `D` doc.

### Hooks modes

Each hook definition may have `.mode` property of values `"sequential"`, `"transitive"`
or `"parallel"`. Default is transitive.

Mode defines hook behavior when there is an unprocessed queue of changes of
a single particular doc. 

__Parallel__ mode allows to run a hook for each change of a particular doc. So several
instances of a hook, processing different revisions of a doc, may run simultaneously.

__Sequential__ mode only allows one instance of a hook for one doc at a time.
So next change of a particular doc is only processed when previous change processing
finishes.

__Transitive__ mode is very similar to sequential, but only last change is taken
from the queue. So transitive mode does not guarantee processing all queued revisions,
it only takes the last revision in queue.

### Hooks configuration

Hooks are configured in `couchbox_hooks` section of CouchDB config. Each key in 
the `couchbox_hooks` section is a pointer to a ddoc, and its value is a space 
separated list of aux fns (plugins), available for hooks in the ddoc. In JSON format it 
might look like this:

```
"hooks":{
  "db1|ddoc1": "bucket fetch sms email aws jpegtran",
  "db2|ddoc2": "bucket"
}
```
Vertical bar `|` character is used instead of slash `/` to overcome CouchDB config
parser block for slashes. Key `db1|ddoc1` means: _start hooks in_ `_design/ddoc1`
_from_ `db1` _DB, also monitor changes in the ddoc and config, and restart hooks
when needed_.

Key’s value ie `bucket fetch sms` means all hooks in a particular ddoc will see
`this._bucket`, `this._fetch` and `this._sms` methods, whatever they do.

### Hooks and workers

TLDR: one hook worker per one CouchDB bucket (DB).

All hooks originating from one CouchDB bucket run in a single-threaded worker. This is
different from CouchDB query server model, where each ddoc has own SpiderMonkey
instance.

The ‘one worker for a DB’ approach guarantees sequential changes processing without
complicated cross-worker interlocks. To avoid worker global scope intervention each
hook runs in a separate node.js `vm` context.

__Note__, that REST API employs yet another model of workers, also different from CouchDB.

On any DB ddoc change a hook worker must restart entirely. In this case running fns aren’t
killed immediately, they are allowed to resolve/reject each. Worker to die receives
\_changes until new worker successfully starts, then waits for running jobs to finish,
and then terminates itself.

Worker may command supervisor to restart itself, if decides there were too many hanged
jobs and memory might have leaked.

## REST API

REST API (api for brevity) functions are defined similar to hooks. They are just
sections in ddocs, although without complimentary filter.

Appropriate CouchDB config section may look like this...
```
"api":{
  "abc.example.com|cmd|sendmail":"db1/mail bucket email",
  "def.example.com":"db2/ddoc2 bucket"
}
```
...and the ddoc in `db1` bucket like this:
```javascript
{
  _id:"_design/mail",
  api:{
    "all/immediate": {
      timeout: 1000,
      methods:["POST"],
      lambda: function (req) {
        // send emails
        resolve({
          code:200,
          body:'Emails sent',
          docs:[/*docs to save*/]
        });
      }
    }
}}
```
With above config, POST-ing to `abc.example.com/cmd/sendmail/all/immediate` will
call lambda, which presumably sends emails (and we configured it to have an
access to `this._email` extension to be able to act this way).

Unrecognized requests (no matching rules) by default return `404`. However,
if the `couchbox/api` config key has `"fallback"` property with an URL, Couchbox proxies 
all unrecognized requests to the URL given. The `"hostKey"` property overrides
`Host` header for proxied requests.

### Request object

The request object is CouchDB-style, with minor differences. Request object
looks like:
``` javascript
{
  "info":{"update_seq": 12345},
  "host": "abc.example.com"
  "method": "GET",
  "path": ["cmd","sendmail","all","immediate"],
  "raw_path": "/cmd/sendmail/all/immediate/?param=value",
  "query": {"param": "value"},
  "headers": {
    "Accept": "text/html",
    "Connection": "close",
    "Host": "abc.example.com",
    "User-Agent": "Mozilla/5.0"
  },
  "body": " /* body string or undefined*/ ",
  "peer": "0.0.0.0",
  "cookie": {"AuthSession": "B64TOKEN"},
  "userCtx": {
    "db": "auth",
    "name": "username",
    "roles": ["_admin"]
  }
}
```
Unlike CouchDB, no `.uuid`, `.form`, `.secObj`, `.requested_path` and `.id` properties
present in the request object. Also the property `.info` has only one key with the DB
update sequence.

### Result object

Api call must end up calling `resolve(result)` or `reject(result)`. The `result` 
object should look like this:
```javascript
{
  code:200, // or any http code
  body:'Body string',
  // json:{},           // may be used instead of .body
  // stream: Stream,    // may be used instead of .body
  headers:{ /* response headers */ },
  docs:[
    [{_id:"doc1"},{_id:"doc2",_db:"db2"}],  // first pile of docs to save
    {_id:"doc3",_db:"db3",_node:"n1"}       // doc to save after the first pile
  ]
}
```
Fields `.headers` and `.docs` are optional. Code and body are sent to a client only
if all docs were saved successfully. [More about saving docs](#saving-docs).

If there were any errors during saving docs, client receives `500` response.

### Api and workers

TLDR: all REST API request listeners run in a single worker. However, several
similar round-robin workers can run simultaneously in different threads.

So Couchbox api feature provides a farm of identical monolith single-threaded
web servers. On any monitored ddoc change all farm workers restart one by one,
first finalizing active requests.

Api lambdas run in separate node.js `vm` instances, so they neither can see, nor
can intervene parent worker global scope.

## Plugins

Plugins are extensions for hooks and api. They are visible as `this._methodName`
from lambda code. Visisbility of each plugin for a particular design doc is 
fine-tuned using CouchDB config.

Plugins are, in general, very thin and simple wrappers around known and well 
tested node.js libs. The `email` plugin is, in fact, 
[nodemailer](https://github.com/nodemailer/nodemailer). The `cache` module is 
based on [node-stow](https://github.com/cpsubrian/node-stow), and so on.

In general, wrapper looks like this:
```javascript
// load ext lib
var ext = require('some-external-lib');

// called on plugin init
function Plugin(methodName, conf = {}, log) {

  // init plugin

  function processCommand(params) {
    /* does something */
    return new Promise((resolve,reject)=>{
      // call ext lib here
    })
  }
  
  // returns Promise resolves
  return new Promise(resolve => {
    function make(env) {
      const { ctx, ref } = env;
      return processCommand(ref).bind(ctx);
    }
    resolve({ name:'_'+methodName, make:make });
  });
}
module.exports = Plugin;
```

[] TODO: list of built-in plugins

## Redis

Couchbox uses Redis to store intermediate results, feed states and so on. We’ve tried
to use CouchDB `_local/docs` for the task, but speed required is order of magnitude
higher than CouchDB is able to provide. So – Redis.

Redis as a component also backs built-in `_cache` plugin.

Couchbox includes [Redis-commander](https://github.com/joeferner/redis-commander) 
as a component, so Redis buckets are accessible and editable through web interface. 
Redis-commander looks pretty much like native CouchDB Futon.

## Configs

Couchbox is configured using native CouchDB config. Couchbox config lives in 
`couchbox`, `couchbox_hooks`, `couchbox_api` and `couchbox_plugins` sections of
CouchDB config.

### \[couchbox\]

General configuration of Couchbox supervisor. Also holds config for socket.io since
socket.io connections pass through supervisor.

__Key__ | Sample value | Meaning
--------|--------------|----------------------
__debug__ | false | Turns on debug mode (more informatibe messages)
__nodename__ | node1 | Shortcut name of current node
__nodes__ | {node1,node2} | List of nodes, JSON; nodenames as keys, URLs as values
__max_parallel_changes__ | 16 | Maximum changes ticks processed simultaneously
__cold\_start__ | now | Defines if first run starts from current sequences or DB first seq ('normal')
__api__ | {active,ports,restart_delta,hostKey,fallback} | Configures REST API
__proxy__ | {active,port,path,fallback} | Proxy settings, JSON
__socket__ | {active,port,path}} | Socket.io config
__mail__ | {active,from,recepients} | Emergency notifications email
__redis\_ip__ | localhost | Redis domain or IP address
__redis\_port__ | 6379 | Redis port
__redis\_password__ | pwd | Redis password, if any
__redis\_commander__ | {active,port,user,pass} | Redis commander config, JSON

The above JSON notation like `{active,port,user,pass}` is an abrrev. The real value
should be a valid JSON string like `{"active":true,"port":8888,"user":"x","pass":"y"}`.


### \[couchbox\_plugins\]

List of Couchbox [plugins](#plugins) and configuration objects for each plugin. 
Keys in this section are shortcuts for appropriate plugins. Each key’s value
is a JSON string of a plugin configuration object. For example:

Key | Value
---|---
__email__ | {"from":"Abc <abc@def.com>", "service":"Yandex", "host":"mail.abc.xyz", "port":465, "secure":true, "user":"mail@abc.xyz", "pass":"1234"}
__sms__ | {"key":"ABCD-1234", "from":"abc.xyz"}

Plugins receive appropriate config objects when initialized on worker start.

### \[couchbox_hooks\]

List of design documents with hooks and plugins they can use. More details in 
[Hooks configuration](#hooks-configuration) section.

### \[couchbox_api\]

List of endpoints and ddocs attached to them. More details in 
[REST API](#rest-api) section.

## Niceties

Couchbox supports `require()` exactly as CouchDB query server does. So if a ddoc
has, say, text property `.Underscore` with the value that is lodash source JS,
your code can use `require("Underscore")` to have lodash onboard inside lambda.

CouchDB QS native methods `isArray()`, `toJSON()` are also emulated.

-----------
(c) 2017 ftescht, ermouth. Couchbox is MIT licensed.
