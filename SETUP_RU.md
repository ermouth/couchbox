Установка Couchbox в Ubuntu
==================

Обновление системы + зависимости

    sudo apt-get update -y
    sudo apt-get upgrade -y
    sudo apt-get install build-essential curl git -y

Создание пользователя с sudo правами (например ubuntu)

    adduser ubuntu
    usermod -aG sudo ubuntu
    su - ubuntu

NodeJS

    curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash -
    sudo apt-get install -y nodejs

СouchDB
------
Зависимости + Erlang

    cd /tmp
    wget http://packages.erlang-solutions.com/erlang-solutions_1.0_all.deb
    sudo dpkg -i erlang-solutions_1.0_all.deb
    sudo apt-get update
    sudo apt-get install erlang -y
    
    sudo apt-get update -y
    
    sudo apt-get install --yes build-essential curl git
    sudo apt-get install --yes python-software-properties python g++ make
    
    sudo apt-get install -y erlang-dev erlang-manpages erlang-base-hipe erlang-eunit erlang-nox erlang-xmerl erlang-inets
    sudo apt-get install -y libmozjs185-dev libicu-dev libcurl4-gnutls-dev libtool

Дистрибутив + патч (нужно скачать *configure* файл)

    cd /tmp
    wget http://ftp.fau.de/apache/couchdb/source/1.6.1/apache-couchdb-1.6.1.tar.gz && tar xvzf apache-couchdb-*
    
    cd apache-couchdb-*
    cp ~/install/configure ./
    ./configure && make
    sudo make install

Настройка + пользователь (couchdb) + автозагрузка

    ##############################################################################
    # vars
    ##############################################################################
    
    #set red color
    red=$(tput setf 4)
    
    #set green color
    green=$(tput setf 2)
    
    #reset color
    reset=$(tput sgr0)
    
    #print in the end of string
    toend=$(tput hpa $(tput cols))$(tput cub 6)
    
    country=RU
    
    
    ###############################################################################
    #finish install couchdb 1.6.1
    ###############################################################################
    
    useradd -d /usr/local/var/lib/couchdb couchdb
    sudo chown -R couchdb: /usr/local/var/lib/couchdb
    sudo chown -R couchdb: /usr/local/var/log/couchdb
    
    # vi /etc/passwd here and change home directory to /usr/local/var/lib/couchdb/
    
    sleep 1
    
    sudo chown -R couchdb: /usr/local/var/lib/couchdb
    sudo chown -R couchdb: /usr/local/var/log/couchdb
    sudo chown -R couchdb: /usr/local/var/run/couchdb
    sudo chown -R couchdb: /usr/local/etc/couchdb
    
    sleep 1
    
    sudo chmod 0770 /usr/local/var/lib/couchdb/
    sudo chmod 0770 /usr/local/var/log/couchdb/
    sudo chmod 0770 /usr/local/var/run/couchdb/
    sudo chmod 664 /usr/local/etc/couchdb/*.ini
    sudo chmod 775 /usr/local/etc/couchdb/*.d
    
    #cd /etc/init.d
    #ln -s /usr/local/etc/init.d/couchdb couchdb
    #/etc/init.d/couchdb start
    #sleep 1
    #update-rc.d couchdb defaults
    
    sudo ln -s /usr/local/etc/logrotate.d/couchdb /etc/logrotate.d/couchdb
    
    # add CouchDB upstart
    
    cat <<'EOF' >/etc/init/couchdb.conf
    description "Start the CouchDB instance"
    author "bis-media.ru"
    
    start on filesystem and static-network-up
    stop on deconfiguring-networking
    respawn
    
    pre-start script
        mkdir -p /var/run/couchdb || /bin/true
        chown -R couchdb: /usr/local/var/lib/couchdb
        chown -R couchdb: /usr/local/var/log/couchdb
        chown -R couchdb: /usr/local/var/run/couchdb
        chown -R couchdb: /usr/local/etc/couchdb
        chown -R couchdb: /usr/local/var/log/couchdb
        chown -R couchdb:couchdb /var/run/couchdb /usr/local/etc/couchdb/local.*
    end script
    
    script
      HOME=/usr/local/var/lib/couchdb
      export HOME
      chdir $HOME
      exec su couchdb -c /usr/local/bin/couchdb
    end script
    
    post-stop script
        rm -rf /var/run/couchdb/*
    end script
    
    
    EOF
    
        
    ##############################################################
    
    # create SSL
    sudo mkdir /usr/local/etc/couchdb/cert
    #sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /usr/local/etc/couchdb/cert/couch.key -out /usr/local/etc/couchdb/cert/couch.crt -subj "/C=RU"
    sudo openssl genrsa -out /usr/local/etc/couchdb/cert/couch_key.pem 4096
    sudo openssl req -new -x509 -key /usr/local/etc/couchdb/cert/couch_key.pem -out /usr/local/etc/couchdb/cert/couch_cert.pem -days 1095 -subj "/C=RU"
    ################################################
    # create new local.ini
    cat <<'EOF' >/usr/local/etc/couchdb/local.ini
    ; CouchDB Configuration Settings
    
    ; Custom settings should be made in this file. They will override settings
    ; in default.ini, but unlike changes made to default.ini, this file won't be
    ; overwritten on server upgrade.
    
    [couchdb]
    ;max_document_size = 4294967296 ; bytes
    uuid = 50a08984564254cc21s4ff860955b15e
    
    [httpd]
    ;port = 5984
    bind_address = 0.0.0.0
    ; Options for the MochiWeb HTTP server.
    ;server_options = [{backlog, 128}, {acceptor_pool_size, 16}]
    ; For more socket options, consult Erlang's module 'inet' man page.
    ;socket_options = [{recbuf, 262144}, {sndbuf, 262144}, {nodelay, true}]
    
    ; Uncomment next line to trigger basic-auth popup on unauthorized requests.
    ;WWW-Authenticate = Basic realm="administrator"
    
    ; Uncomment next line to set the configuration modification whitelist. Only
    ; whitelisted values may be changed via the /_config URLs. To allow the admin
    ; to change this value over HTTP, remember to include {httpd,config_whitelist}
    ; itself. Excluding it from the list would require editing this file to update
    ; the whitelist.
    ;config_whitelist = [{httpd,config_whitelist}, {log,level}, {etc,etc}]
    
    [query_servers]
    ;nodejs = /usr/local/bin/couchjs-node /path/to/couchdb/share/server/main.js
    
    
    [httpd_global_handlers]
    ;_google = {couch_httpd_proxy, handle_proxy_req, <<"http://www.google.com">>}
    
    [couch_httpd_auth]
    ; If you set this to true, you should also uncomment the WWW-Authenticate line
    ; above. If you don't configure a WWW-Authenticate header, CouchDB will send
    ; Basic realm="server" in order to prevent you getting logged out.
    ; require_valid_user = false
    timeout = 18600
    
    [log]
    ;level = debug
    
    [log_level_by_module]
    ; In this section you can specify any of the four log levels 'none', 'info',
    ; 'error' or 'debug' on a per-module basis. See src/*/*.erl for various
    ; modules.
    ;couch_httpd = error
    
    
    [os_daemons]
    ; For any commands listed here, CouchDB will attempt to ensure that
    ; the process remains alive. Daemons should monitor their environment
    ; to know when to exit. This can most easily be accomplished by exiting
    ; when stdin is closed.
    ;foo = /path/to/command -with args
    
    [daemons]
    ; enable SSL support by uncommenting the following line and supply the PEM's below.
    ; the default ssl port CouchDB listens on is 6984
    httpsd = {couch_httpd, start_link, [https]}
    
    [ssl]
    cert_file = /usr/local/etc/couchdb/cert/couch_cert.pem
    key_file = /usr/local/etc/couchdb/cert/couch_key.pem
    ;password = somepassword
    ; set to true to validate peer certificates
    verify_ssl_certificates = false
    ; Path to file containing PEM encoded CA certificates (trusted
    ; certificates used for verifying a peer certificate). May be omitted if
    ; you do not want to verify the peer.
    ;cacert_file = /full/path/to/cacertf
    ; The verification fun (optional) if not specified, the default
    ; verification fun will be used.
    ;verify_fun = {Module, VerifyFun}
    ; maximum peer certificate depth
    ssl_certificate_max_depth = 1
    
    ; To enable Virtual Hosts in CouchDB, add a vhost = path directive. All requests to
    ; the Virual Host will be redirected to the path. In the example below all requests
    ; to http://example.com/ are redirected to /database.
    ; If you run CouchDB on a specific port, include the port number in the vhost:
    ; example.com:5984 = /database
    [vhosts]
    ;example.com = /database/
    
    [update_notification]
    ;unique notifier name=/full/path/to/exe -with "cmd line arg"
    
    ; To create an admin account uncomment the '[admins]' section below and add a
    ; line in the format 'username = password'. When you next start CouchDB, it
    ; will change the password to a hash (so that your passwords don't linger
    ; around in plain-text files). You can add more admin accounts with more
    ; 'username = password' lines. Don't forget to restart CouchDB after
    ; changing this.
    [admins]
    couchbox=couchbox
    EOF
    
    # restart couchdb
    
    # sudo /etc/init.d/couchdb restart
    
    sudo stop couchdb
    sleep 5
    sudo start couchdb
    sleep 5

Redis
------
Установка + автозагрузка

    cd /tmp
    sudo apt-get update
    sudo apt-get install build-essential tcl -y
    curl -O http://download.redis.io/redis-stable.tar.gz
    tar xzvf redis-stable.tar.gz
    cd redis-stable
    make
    make test
    sudo make install
    cd utils
    sudo ./install_server.sh
    sudo update-rc.d redis_6379 defaults

Nginx
------

    sudo apt-get update
    sudo apt-get install nginx

Couchbox
------

Установка

    useradd -d /home/couchbox couchbox
    
    sudo chown -R couchbox:/home/couchbox
    sudo chown -R couchbox: /usr/local/var/log/couchbox
    sudo chmod 0770 /usr/local/var/log/couchbox
    
    cd ~/
    git pull git@gitlab.com:ermouth/couchbox.git
    cd couchbox
    npm install

Скрипт автозапуска */etc/init/couchbox.conf*

    #!upstart
    description "Couchbox service"
    author      "bismedia"
    
    start on started couchdb
    stop on stopped couchdb
    
    respawn
    respawn limit 10 5
    
    env NODE=/usr/local/bin/node
    env APP_USER=couchbox
    env APP_NAME=couchbox
    env APP_DIR=/home/couchbox/couchbox
    env APP_FILE=index.js
    env LOGS_DIR=/usr/local/var/log
    env LOG_DIR=/usr/local/var/log/couchbox
    env LOG_FILE=/usr/local/var/log/couchbox/couchbox.log
    
    pre-start script
      test -x $NODE || { stop; echo "Bad node"; exit 0; }
      test -e $LOGS_DIR || { stop; echo "Bad log dir"; exit 0; }
      test -e $LOG_DIR || { echo "Make dir $LOG_DIR"; mkdir $LOG_DIR; chown -R $APP_USER:$APP_USER $LOG_DIR; }
      test -e $LOG_FILE || { echo "Make file $LOG_FILE"; touch $LOG_FILE; chown $APP_USER:$APP_USER $LOG_FILE; chmod 770 $LOG_FILE; }
      echo "[`date -u +%Y-%m-%dT%T.%3NZ`] $APP_NAME starting" >> $LOG_FILE
    end script
    
    script
      export NODE_ENV="production"
      export DB_USER="couchbox"
      export DB_PASS="couchbox"
      export LOGGER_DB="log"
      export LOGGER_DB_SAVE=true
      export LOGGER_BULK_SIZE=100
    
      exec start-stop-daemon --start --chuid $APP_USER --make-pidfile --pidfile /var/run/$APP_NAME.pid --exec $NODE $APP_DIR/$APP_FILE >> $LOG_FILE 2>&1
    end script
    
    pre-stop script
      rm -f /var/run/$APP_NAME.pid
      echo "[`date -u +%Y-%m-%dT%T.%3NZ`] $APP_NAME stopping" >> $LOG_FILE
    end script
    
Пример конфигурации couchbox */home/couchbox/couchbox.json*

    {
      "cors": {
        "origins": "http://cloudwall.me, http://jquerymy.com, http://ddoc.me, http://localhost, http://127.0.0.1, http://localhost:5984, http://127.0.0.1:5984, http://localhost:8888"
      },
      "couchbox": {
        "api": "{active:true, ports:[8001], restart_delta:5000, hostKey:\"Host\", fallback:\"http://localhost:5984\"}",
        "cold_start": "now",
        "debug": "true",
        "mail": "{ active:true, from:\"CouchBox\", recipients:\"recipient@someaddress.com\"}",
        "max_parallel_changes": "16",
        "nodename": "lc",
        "nodes": "{ lc: \"https: //localhost:5984\"}",
        "proxy": "{ active:true, port:8888, path:\"/\"}",
        "redis_commander": "{ active:true, port:8881, user:\"rc\", pass:\"password\"}",
        "redis_ip": "localhost",
        "redis_password": "password",
        "redis_port": "6379",
        "socket": "{ active:true, port:8000, path:\"/_socket\"}"
      },
      "couchbox_plugins": {
        "cache": "{\"ttl\": 60}",
        "bank": "{\"login\":\"\",\"pass\":\"\",\"currencies\":[\"RUB\",\"USD\",\"EUR\"],\"languages\":[\"ru\",\"en\",\"uk\",\"be\"],\"timeout\":5000,\"merchant\":\"\"}",
        "email": "{\"from\":\"\",\"service\":\"Yandex\",\"host\":\"smtp.yandex.ru\",\"port\":465,\"secure\":true,\"user\":\"\", \"pass\":\"\"}",
        "sms": "{\"key\":\"\", \"from\":\"\"}",
        "kkm": "{\"url\":\"http://localhost:5893\",\"login\":\"Admin\",\"password\":\"\",\"timeout\":30,\"requestTimeout\":10000,\"company\":\"Couchbox\",\"cashier\":\"Couchbox software\",\"tax\":-1}"
      },
      "couchbox_api": {
        "host|_route": "db/ddoc bucket socket cache jpegtran fetch email sms bank kkm"
      },
      "couchbox_hooks": {
        "db|ddoc": "bucket socket cache jpegtran fetch email sms bank kkm"
      }
    }

Установка конфигурации

    /home/couchbox/couchbox/setup.js /home/couchbox/couchbox.json -n cb -ip 127.0.0.1 -port 5984 -u couchbox -p couchbox -c http://localhost,http://127.0.0.1 -s 12345678901234567890123456789012

