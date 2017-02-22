require('sugar');
const Promise = require('bluebird');
const Logger = require('../../utils/logger');
const couchdb = require('../../utils/couchdb');
const config = require('../../config');


const { EmptyRequestError } = require('../../utils/errors');

const {
  SESSION_TTL,
  LOG_EVENTS: { API_SESSION_ERROR }
} = require('./constants');

function Sessions(props = {}) {
  const logger = new Logger({ prefix: 'Sessions', logger: props.logger });
  const log = logger.getLog();

  const usersBucket = couchdb.connectBucket('_users');

  const feed = usersBucket.follow({ since: 'now' });
  feed.on('change', function (change) {
    if (change.id.indexOf('_design/') !== 0) {
      const id = change.id.split(':',2)[1];
      if (id[1]) removeUser(id[1]);
    }
  });
  feed.follow();

  const close = (callback) => {
    if (feed) feed.stop();
    if (callback) callback();
  };

  const users = new Map();
  const sessions = new Map();

  const removeSession = (sid, cleanUser) => {
    if (sessions.has(sid)) {
      if (cleanUser) {
        const session = sessions.get(sid);
        const user = session ? users.get(session.user) : null;
        if (user) {
          user.sessions.remove(sid);
          if (user.sessions.length) users.set(session.user, user);
          else users.delete(session.user);
        }
      }
      sessions.delete(sid);
    }
  };

  const removeUser = (name) => {
    if (users.has(name)) {
      const user = users.get(name);
      if (user) {
        user.sessions.forEach(removeSession);
        users.delete(name);
      }
    }
  };

  const getSession = (sid) => {
    if (checkSession(sid)) {
      const user = users.get(sessions.get(sid).user);
      if (user) return user.userCtx;
    }
    removeSession(sid, true);
    return undefined;
  };

  const checkSession = (sid) => sessions.has(sid) && sessions.get(sid).ttl >= Date.now();

  const onSession = (sid, userCtx) => {
    if (userCtx && userCtx.name && userCtx.roles) {
      const { name, roles } = userCtx;
      let user = users.get(name);
      if (user) {
        if (roles.length === user.userCtx.roles.length && roles.join(',') === user.userCtx.roles.join(',')) {
          user.sessions.push(sid);
          user.sessions = user.sessions.unique(true).filter(osid => {
            if (checkSession(osid)) return true;
            removeSession(osid);
            return false;
          });
        } else {
          user.userCtx = userCtx;
          user.sessions.forEach(removeSession);
          user.sessions = [sid];
        }
      }
      else user = { userCtx, sessions: [sid] };
      users.set(name, user);
      const ttl = Date.now() + SESSION_TTL;
      sessions.set(sid, { user: name, ttl });
    } else {
      removeSession(sid, true);
      userCtx = Object.clone(userCtxDef);
    }
    return userCtx;
  };

  const userCtxDef = {
    name: null,
    roles: []
  };

  const loadSession = (request) => new Promise((resolve, reject) => {
    if (!request) return reject(new EmptyRequestError());
    let sid, session;

    // Basic auth
    sid = request.headers['authorization'];
    if (sid) {
      session = getSession(sid);
      return session
        ? resolve(session)
        : couchdb.getBasicSession(sid)
          .then(userCtx => onSession(sid, userCtx))
          .then(resolve)
          .catch(error => {
            log({
              message: 'Error on session by Basic auth',
              event: API_SESSION_ERROR,
              error
            });
            resolve(undefined);
          });
    }

    // Cookie auth
    sid = request.cookie['AuthSession'];
    if (sid) {
      session = getSession(sid);
      return session
        ? resolve(session)
        : couchdb.getCookieSession('AuthSession=' + sid)
          .then(userCtx => onSession(sid, userCtx))
          .then(resolve)
          .catch(error => {
            log({
              message: 'Error on session by cookie',
              event: API_SESSION_ERROR,
              error
            });
            resolve(undefined);
          });
    }

    return resolve(Object.clone(userCtxDef));
  });

  return { loadSession, removeSession, close };
}

module.exports = Sessions;
