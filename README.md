# Couchbox

Couchbox extends CouchDB query server with backstage \_changes feed hooks and
configurable REST API. Both [hooks](#hooks) and [REST API](#rest-api) are functions
in design docs. Unlike native query server functions, couchbox parts are async and
have per-ddoc configurable access to DB and outside world via aux methods.

Couchbox is multi-worker and employs native CouchDB config. Once run, Couchbox tracks
changes in both CouchDB config and ddocs and seamlessly restarts appropriate workers.

Unlike CouchDB, Couchbox only tracks ddocs, that are explicitly listed in configs,
and each ddoc has own set of available aux methods, also defined in CouchDB config.

## Hooks

Hooks are pairs of a filter function from `.filters` section and a complimentary
section in `.hooks` object. For example:

``` javascript
{
  _id: "_design/email",
  filters:{
    emailQueue: function (doc, req) { return doc.type=="email"; }
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

A hook itself has three properties: `.timeout` in milliseconds, a body of the hook
in `.lambda`, and a `.mode` defining how doc updates are processed (sequentially
or in parallel).

Lambda function receives doc as an argument and must call `resolve()` or `reject()`
function in `.timeout` timeframe, or it is assumed rejected. Lambda is not allowed
to return Promise for safety reasons: a wrapper Promise must be able to auto-reject
on timeout and handle uncaught error, so it’s safer to instantiate Promise outside
lambda code.

Lambdas have access to aux functions using `this._method` syntax, so aux functions look
like extensions of the ddoc (in CouchDB query server `this` points to parent ddoc
JSON, same in Couchbox). Most aux methods are async and return Promise.

### Saving docs

A hook normally can not write to DB during processing. The only way to write DB is
to add `.docs` property to a resolved object. This property must be an array
of JSONs to save.

Each doc JSON in an array may have additional properties `_db` and `_node`,
they define destination node and DB for the doc.

Each row in the `.docs` array only runs after previous row save finished successfully.
If doc save fails, save chain stops and error is logged. Successfully saved docs
are __not__ deleted.

The `.docs` array may have non-plain structure, any row can be an array of docs also.
In this case all docs of the row are saved simultaneously, and next row is processed
only after all docs are saved successfully.

### Hooks modes

Each hook definition may have `.mode` property of values `"sequential"`, `"transitive"`
or `"parallel"`. Default mode is transitive.

Mode defines hook’s behavior when there is an unprocessed queue of changes of
a single doc.

__Parallel__ mode allows to run a hook for each change of a particular doc. So several
instances of a hook, processing different revisions of a doc, may run simultaneously.

__Sequential__ mode only allows one instance of a hook for one doc at a time.
So next change of a particular doc is only processed when previous change processing
finishes.

__Transitive__ mode is very similar to sequential, but only last change is taken
from the queue. So transitive mode does not guarantee processing all queued revisions,
it only takes the last revision in queue.

### Hooks configuration

Hooks are configured in `hooks` section of CouchDB config. Each key in a `hooks`
section is a pointer to ddoc, and its value is a space separated list of aux fns,
available for hooks in the ddoc. In JSON format it might look like this:

```
"hooks":{
  "db1|ddoc1":"bucket fetch sms email aws jpegtran",
  "db2|ddoc2":"bucket"
}
```
Vertical bar `|` character is used instead of slash `/` to overcome CouchDB config
parser block for slashes. Key `db1|ddoc1` means: _start hooks in_ `_design/ddoc1`
_from_ `db1` _DB, also monitor changes in the ddoc and config, and restart hooks
when needed_.

Key’s value ie `bucket fetch sms` means all hooks in a particular ddoc will see
`this._bucket`, `this._fetch` and `this._sms` methods, whatever they do.

### Hooks and workers

TLDR: one hook worker for one CouchDB bucket (DB).

All hooks originating from one CouchDB bucket run in one worker thread. This is  
different from CouchDB query server model, where each ddoc has own SpiderMonkey
instance.

The ‘one worker for a DB’ approach guarantees sequential changes processing without
complicated cross-worker interlocks. To avoid worker global scope intervention each
hook runs in a separate node.js `vm` context.

__Note__, that REST API employs yet another model of workers, also different from CouchDB.

On any DB ddoc change hook worker must restart entirely. In this case running fns aren’t
killed immediately, they are allowed to resolve/reject each. Worker to die receives
\_changes until new worker successfully start, then waits for running jobs to finish,
and then terminates itself.

Worker may command supervisor to restart itself, if decides there were too many hanged
jobs and memory might have leaked.

## REST API

REST API (api for brevity) functions are defined similar to hooks. They are just
sections in ddocs, although without complimentary filter.

Appropriate CouchDB config section may look like this...
```
"api":{
  "abc.example.com|cmd|sendmail":"db1/email bucket email",
  "def.example.com":"db2/ddoc2 bucket"
}
```
...and appropriate ddoc in `db1` bucket like this:
```javascript
{
  _id:"_design/email",
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
With above data, POST-ing to `abc.example.com/cmd/sendmail/all/immediate` will
call lambda, that presumably sends emails (and we configured it to have an
access to `this._email` extension to be able to act this way).

### Request object

The request object is CouchDB-styled, with minor differences. Request object
looks like:
``` javascript
{
  "info":{"update_seq": 12345},
  "host": "abc.example.com"
  "method": "GET",
  "path": ["cmd","sendmail","all","immediate"],
  "raw_path": "/auth/_design/login/_rewrite/?reflect=true",
  "query": {"param": "value"},
  "headers": {
    "Accept": "text/html",
    "Connection": "close",
    "Host": "abc.example.com",
    "User-Agent": "Mozilla/5.0"
  },
  "body": " /* body string */ ",
  "peer": "0.0.0.0",
  "cookie": {"AuthSession": "B64TOKEN"},
  "userCtx": {
    "db": "auth",
    "name": "username",
    "roles": ["_admin"]
  }
}
```
Unlike CouchDB, no `uuid`, `form`, `secObj`, `requested_path` and `id` properties
present in request object. Also the property `info` has only one key with DB update
sequence.

### Result object

To be written.

### Api and workers

TLDR: all REST API request listeners run in a single worker. However, several
identical round-robin workers can run simultaneously in different threads.

So Couchbox api feature provides a farm of identical monolith single-threaded
web servers. On any monitored ddoc change all farm workers restart one by one,
first finishing requests pending.

Api lambdas run in separate node.js `vm` instances, so they neither can see, nor
can intervene their parent worker global scope.

## Niceties

Couchbox supports `require()` exactly as CouchDB query server does. So if a ddoc
has, say, text property `.Underscore` with the value that is lodash source JS,
one can use `require("Underscore")` to have lodash onboard inside lambda.

CouchDB QS native methods `isArray()`, `toJSON()` are also emulated.

-----------
(c) 2017 ftescht, ermouth. Couchbox is MIT licensed.
