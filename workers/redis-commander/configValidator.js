require('sugar');

module.exports = function (conf) {
  return (
    Object.isObject(conf) && conf.active && conf.port > 0 &&
    Object.isString(conf.user) && conf.user.length > 0 &&
    Object.isString(conf.pass) && conf.pass.length > 0
  );
};
