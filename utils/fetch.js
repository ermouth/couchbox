const Promise = require('bluebird');

const fetch = (url) => new Promise((resolve, reject) => {
  resolve(true);
});

module.exports = fetch;
