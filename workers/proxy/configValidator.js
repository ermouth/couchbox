require('sugar');

module.exports = function (conf) {
  return Object.isObject(conf) && conf.active && conf.port > 0 && conf.path && conf.path.length > 0;
};
