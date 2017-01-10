const sugar = require('sugar');

function Logger(props = {}) {
  let parentPrefix = props.prefix || '';

  function _log(params = {}, msg) {
    const time = new Date();
    console.log(time.iso() +' ['+ params.prefix +']: '+ JSON.stringify(msg));
  }

  function _getLog(props = {}) {
    const prefix = [parentPrefix, props.prefix].compact().join('->').trim();
    return _log.fill({ prefix });
  }

  return {
    getLog: _getLog
  };
}

module.exports = Logger;
