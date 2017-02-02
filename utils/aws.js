const AWS = require('aws-sdk');
const config = require('../config');

AWS.config.update({
  accessKeyId: config.get('aws.accessKey'),
  secretAccessKey: config.get('aws.secretKey'),
  region: config.get('aws.region'),
});

const SES = new AWS.SES();
const SNS = new AWS.SNS();
const S3 = new AWS.S3();

module.exports = { S3, SNS, SES };
