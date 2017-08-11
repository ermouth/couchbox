require('sugar');
const Promise = require('bluebird');
const Logger = require('../../utils/logger');
const couchdb = require('../../utils/couchdb');


const { HttpError } = require('../../utils/errors');

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
      if (id) removeUser(id);
    }
  });
  feed.follow();

  function close(callback) {
    if (feed) feed.stop();
    if (callback) callback();
  }

  const users = new Map();
  const sessions = new Map();

  function removeSession(sid, cleanUser) {
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
  }

  function removeUser(name) {
    if (users.has(name)) {
      const user = users.get(name);
      if (user) {
        let i = user.sessions.length;
        while (i--) removeSession(user.sessions[i]);
        users.delete(name);
      }
    }
  }

  function getSession(sid) {
    if (checkSession(sid)) {
      const user = users.get(sessions.get(sid).user);
      if (user) return user.userCtx;
    }
    removeSession(sid, true);
    return undefined;
  }

  function checkSession(sid) {
    return sessions.has(sid) && sessions.get(sid).ttl >= Date.now();
  }

  function onSession(sid, userCtx) {
    if (userCtx && userCtx.name && userCtx.roles) {
      const { name, roles } = userCtx;
      let user = users.get(name);
      if (user) {
        if (roles.length === user.userCtx.roles.length && roles.join(',') === user.userCtx.roles.join(',')) {
          user.sessions.push(sid);
          user.sessions = user.sessions.unique(true).filter(function sidFilter(userSid) {
            if (checkSession(userSid)) return true;
            removeSession(userSid);
            return false;
          });
        } else {
          user.userCtx = userCtx;
          let i = user.sessions.length;
          while (i--) removeSession(user.sessions[i]);
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
  }

  const userCtxDef = {
    name: null,
    roles: []
  };

  function loadSession(request) {
    if (!request) return Promise.reject(new HttpError(500, 'Empty request'));
    return new Promise(function loadSessionPromise(resolve) {
      let sid, session;
      // Basic auth
      sid = request.headers['authorization'];

      if (sid) {
        session = getSession(sid);
        return session
          ? resolve(session)
          : couchdb.getBasicSession(sid)
            .then(onUserCtx)
            .then(resolve)
            .catch(onUserCtxError);
      }

      // Cookie auth
      sid = request.cookie['AuthSession'];
      if (sid) {
        session = getSession(sid);
        return session
          ? resolve(session)
          : couchdb.getCookieSession('AuthSession=' + sid)
            .then(onUserCtx)
            .then(resolve)
            .catch(onUserCtxError);
      }

      function onUserCtx(userCtx) {
        return onSession(sid, userCtx);
      }
      function onUserCtxError(error) {
        log({
          message: 'Error on loading session',
          event: API_SESSION_ERROR,
          error
        });
        resolve(undefined);
      }

      return resolve(Object.clone(userCtxDef, true));
    });
  }

  return { loadSession, removeSession, close };
}

module.exports = Sessions;
