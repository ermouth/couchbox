module.exports = {
  couchbox: {
    nodename: 'lc',
    nodes: '{"lc":"http://localhost"}',

    cold_start: 'now',
    max_parallel_changes: 16,

    redis_ip: 'localhost',
    redis_password: '',
    redis_port: 6379,
    redis_commander: '{"active":true,"port":8881,"user":"test","pass":"pass"}',

    proxy: '{"active":false, "port":8888, "path":"/"}',
    api: '{"active":true,"ports":[8001,8002],"restart_delta":5000, "hostKey":"Host", "fallback":"http://localhost:5984"}',
    socket: '{"active":true, "port":8000, "path":"/_socket"}',

    mail: '{"active":false,"from":"CouchBox","recipients":""}',
    debug: false
  },
  couchbox_api: {
    'host|_route': 'db/ddoc bucket socket cache jpegtran fetch email sms bank kkm'
  },
  couchbox_hooks: {
    'db|ddoc': 'bucket socket cache jpegtran fetch email sms bank kkm'
  },
  couchbox_plugins: {
    cache: '{"ttl": 60}',
    bank: '{"login":"","pass":"","currencies":["RUB","USD","EUR"],"languages":["ru","en","uk","be"], "timeout":5000}',
    email: '{"from":"","service":"Yandex","host":"smtp.yandex.ru","port":465,"secure":true,"user":"", "pass":""}',
    sms: '{"key":"", "from":""}',
    kkm: '{"url":"http://localhost:5893","login":"Admin","password":"","timeout":30,"requestTimeout":10000,"company":"Couchbox","cashier":"Couchbox software","tax":-1}'
  }
};