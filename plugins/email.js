require('sugar');
const Promise = require('bluebird');
const mime = require('mime-types');
const nodemailer = require("nodemailer");

const TASK_EMAIL = 'email/send';
const TASK_EMAIL_ERROR = 'email/error';

function Plugin(method, conf = {}, log) {
  const name = '_' + (method || 'email');

  const connection = conf.service ? { service: conf.service } : {
    host: conf.host || 'smtp.gmail.com',
    port: conf.port || 465,
    secure: !!conf.secure || true
  };

  connection.auth = {
    user: conf.user,
    pass:  conf.pass
  };

  const defaults = {
    from: conf.from
  };

  const transporter = nodemailer.createTransport(connection, defaults);

  const email_send = (ref) => (props = {}) => {
    const { to, from, subject, text, html, attachments } = props;

    const message = {};

    if (!(to && Object.isString(to))) return Promise.reject(new Error('Bad prop "to"'));
    if (from && !Object.isString(from)) return Promise.reject(new Error('Bad prop "from"'));
    if (!(subject && Object.isString(subject))) return Promise.reject(new Error('Bad prop "subject"'));
    if (!(text && Object.isString(text))) return Promise.reject(new Error('Bad prop "text"'));
    if (html && !Object.isString(html)) return Promise.reject(new Error('Bad prop "html"'));
    if (attachments && !Object.isArray(attachments)) return Promise.reject(new Error('Bad prop "attachments"'));

    if (attachments && attachments.length > 0) {
      message.attachments = [];
      for(let i = 0, iMax = attachments.length, att; i < iMax; i++) {
        att = attachments[i];
        if (!att) return Promise.reject(new Error('Bad attachment at index '+ i));
        if (!(att.name && Object.isString(att.name))) return Promise.reject(new Error('Bad attachment name at index '+ i));
        if (!att.content) return Promise.reject(new Error('Bad attachment content at index '+ i));
        if (att.contentType && !Object.isString(att.contentType)) return Promise.reject(new Error('Bad attachment contentType at index '+ i));
        if (att.cid && !Object.isString(att.cid)) return Promise.reject(new Error('Bad attachment cid at index '+ i));

        const attSend = {
          filename: att.name,
          content: att.content
        };

        const type = att.contentType && att.contentType in mime.extensions ? att.contentType : mime.lookup(att.name);
        if (type) attSend.contentType = type;

        if (att.cid) attSend.cid = att.cid;

        if (attSend.content instanceof Buffer) {}
        else if (Object.isString(attSend.content)) {
          attSend.encoding = 'base64';
        } else {
          return Promise.reject(new Error('Bad attachment content at index '+ i));
        }

        message.attachments.push(attSend);
      }
    }

    message.from = from || defaults.from;
    message.to = to;
    message.subject = subject;
    message.text = text;
    if (html) message.html = html;

    log({
      message: 'Send email: "'+ message.text +'" to: '+ to,
      event: TASK_EMAIL,
      ref
    });

    return new Promise((resolve, reject) => {
      transporter.sendMail(message, (error, info) => {
        if (error) {
          log({
            message: 'Error send email: "'+ message.text +'" to: '+ to,
            event: TASK_EMAIL_ERROR,
            error,
            ref
          });
          return reject(error);
        }
        transporter.close();
        return resolve(info);
      });
    });
  };

  return new Promise(resolve => {

    function make(env) {
      const { ctx, ref } = env;
      return email_send(ref).bind(ctx);
    }

    resolve({ name, make });
  });
}

module.exports = Plugin;
