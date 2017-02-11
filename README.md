# Couchbox

Couchbox extends CouchDB query server with backstage \_changes feed hooks and
configurable REST API. Both hooks and REST API are functions in design
docs. Unlike native query server functions, couchbox parts are async and have per-ddoc
configuarble access to DB and outside world.

Couchbox is multi-worker and employs native CouchDB config. Once run, Couchbox tracks
changes in both CouchDB config and ddocs and seamlessly restarts appropriate workers.

Unlike CouchDB, Couchbox only tracks ddocs, that are explicitly listed in configs,
and each ddoc has own set of available aux methods, also defined in CouchDB config.

## Hooks

Hooks are pairs of a filter function from `.filters` section and complimentary
section in `.hooks` object. For example:

``` javascript
{
  _id: "_design/email",
  filters:{
    emailQueue: function (doc, req){ return doc.type=="email"; }
  },
  hooks:{
    emailQueue:{
      timeout: 10000,
      mode: 'transitive',
      lambda: function (doc){
        var doc = doc;
        this._email({
          to:   doc.to,
          html: doc.html
        })
        .then(function(){
          doc.sent = Date.now();
          resolve ({
            code:200,
            message:'Email sent',
            docs:[doc] // docs to save
          });
        });
      }
}}}
```
Filter part is an ordinary filter function, except hook filter never receive `req`
argument, since there is no inbound http request for action.

A hook itself has three properties: `.timeout` in milliseconds, a body of the hook
in `.lambda`, and a `.mode` defining how doc updates are processed (sequentially
or in parallel).

Lambda function receives doc as an argument and must call `resolve()` or `reject()`
function in `.timeout` timeframe, or it is assumed rejected. Lambda is not allowed
to return Promise for safety reasons: a wrapper Promise must be able to auto-reject
on timeout, so it’s safer to instantiate Promise outside ddoc code.

Lambda has access to aux functions using `this._method` syntax, so aux functions look
like extensions of the ddoc (in CouchDB query server `this` points to parent ddoc
JSON). Most aux methods are async and return Promise.

### Hooks modes

Each hook definition may have `.mode` property of values `"sequential"`, `"transitive"`
or `"parallel"`. Default mode is transitive.

Mode defines hook’s behavior when there is an unprocessed queue of changes of
a single doc.

__Parallel__ mode allows to run a hook for each change of a particular doc.

__Sequential__ mode only allows one instance of a hook for one doc at a time.
So next change of a particular doc is only processed when previous change processing
finishes.

__Transitive__ mode is very similar to sequential, but only last change is taken
from the queue. So transitive mode does not guarantee processing all changes, it
only takes last.

### Hooks configuration

Hooks are configured in `hooks` section of a CouchDB config. Each key in `hooks`
section is a pointer to ddoc, and its value is a space separated list of aux fns,
available for hooks in the ddoc. In JSON format it might look like this:

```
"hooks":{
  "db1|ddoc1":"bucket fetch sms email aws jpegtran",
  "db2|ddoc2":"bucket"
}
```
Vertical bar `|` character is used instead of slash `/` to overcome CouchDB config
parser block for slashes. Key `db1|ddoc1` means: _start hooks in_ `_design/ddoc1` _from_ `db1` _DB, also monitor changes in the ddoc and config and restart hooks when needed_.

Key’s value ie `bucket fetch sms` means all hooks in a particular ddoc will see
`this._bucket`, `this._fetch` and `this._sms` methods, whatever they do.

## REST API

REST API (api for brevity) functions are defined similar to hooks. They are just
sections in ddocs, although without complimentary filter.
