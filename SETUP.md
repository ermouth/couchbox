Couchbox installer
==================

    couchbox/setup.js couchbox.json -D testdb=testdoc.json -n cb -A 127.0.0.1 -P 5984 -u couchbox -p couchbox -c http://localhost,http://127.0.0.1 -s 12345678901234567890123456789012

* `first arg` couchbox.json file path
* `-D` paths to json type documents that need to save in couchdb (use `,` delimiter)
* `-n` Node name
* `-A` Couchdb ip address
* `-P` Couchdb port
* `-u` Couchdb user
* `-p` Couchdb user password
* `-c` set Couchdb cors in config (use `,` delimiter)
* `-s` set Couchdb secret key in config
* `-r` Redis password
* `-m` installer mode 'o' - overwrite 'p' - patch

Document file name pattern `DBNAME=DOCNAME.json'

