require('sugar');

module.exports = function (conf) {
  return (
    Object.isObject(conf) && conf.active &&
    Object.isArray(conf.ports) && conf.ports.length > 0 && conf.ports.filter(p => p > 0).length === conf.ports.length &&
    conf.restart_delta > 0
  );
};
