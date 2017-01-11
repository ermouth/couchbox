const sugar = require('sugar');

function Logger(props = {}) {
  const _parent = props.logger;
  const _prefix = props.prefix;

  const _endLog = _parent ? _parent.log : function({ time, chain, msg }) {
    console.log(time.iso() +' ['+ chain.reverse().join('->') +']: '+ JSON.stringify(msg));
  };

  function _preLog({ time, chain, msg }) {
    if (!time) time = new Date();
    if (!chain) chain = [];
    chain.push(_prefix);
    _endLog({ time, chain, msg });
  }

  return {
    log: _preLog,
    getLog: () => (msg) => _preLog({ msg })
  };
}

module.exports = Logger;
