Couchbox installer
==================

    couchbox/setup.js couchbox.json -n cb -A 127.0.0.1 -P 5984 -u couchbox -p couchbox -c http://localhost,http://127.0.0.1 -s 12345678901234567890123456789012

* `-n` Node name
* `-A` Couchdb ip address
* `-P` Couchdb port
* `-u` Couchdb user
* `-p` Couchdb user password
* `-c` set Couchdb cors in config
* `-s` set Couchdb secret key in config
* `-r` Redis password
* `-m` installer mode 'o' - overwrite 'p' - patch

