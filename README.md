# Couchbox

Couchbox extends CouchDB query server with backstage \_changes feed hooks and configurable
REST API. Couchbox hooks and REST API functions are functions in design docs. Unlike
native query server functions, couchbox parts are async and have per-ddoc
configuarble access to DB and outside world.

## Hooks

Hooks are pairs of a filter function from `.filters` section and appropriate section in `.hooks` object. For example:

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
Filter part is an ordinary filter function, except hook filters never receive `req`
argument, since there is no inbound request for action.

A hook itself has three properties: `.timeout` in milliseconds, a body of the hook
in `.lambda`, and a `.mode` defining how doc updates are processed (sequentially
or in parallel).
