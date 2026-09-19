/**
 * Authentification (lot 0) :
 *  - agents : identifiants AD vérifiés par l'APM (jamais stockés), puis JWT applicatif + session révocable ;
 *  - compte de secours local (SEC-15) : utilisable quand l'AD ou l'APM est indisponible, chaque usage est audité.
 * L'identifiant est normalisé en minuscules (l'AD est insensible à la casse : « MDupont » = « mdupont »).
 * Un refus ne dit jamais si le compte existe.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const bcrypt = require('bcryptjs');
const { E } = require('../../shared/errors');

const INVALID = 'Identifiant ou mot de passe incorrect';

function createAuthService({ db, config, log, ad, dir, sessions, audit, guard }) {
  const normalize = (u) => String(u || '').trim().toLowerCase();

  async function issue({ username, kind, ip, startedAt = new Date() }) {
    const t = Date.now();
    const maxEnd = startedAt.getTime() + config.jwt.sessionMaxSeconds * 1000;
    const end = Math.min(t + config.jwt.ttlSeconds * 1000, maxEnd);
    if (end <= t) throw E.unauthorized('Durée maximale de session atteinte : reconnectez-vous');
    const jti = crypto.randomUUID();
    const token = jwt.sign({ sub: username, jti, kind }, config.jwt.secret, { algorithm: 'HS256', expiresIn: Math.floor((end - t) / 1000) });
    await sessions.create({ jti, username, kind, startedAt, expiresAt: new Date(end), ip });
    return { token, tokenType: 'Bearer', expiresAt: new Date(end).toISOString(), jti };
  }

  /** Les administrateurs de plateforme initiaux (BOOTSTRAP_ADMINS) sont amorcés à la connexion. */
  async function ensureBootstrapAdmin(username, ctx) {
    if (!config.bootstrapAdmins.includes(username)) return;
    const r = await db.run(
      `INSERT INTO user_org_roles (username, organisme_id, role, created_by) VALUES ($1, NULL, 'platform_admin', 'bootstrap')
       ON CONFLICT DO NOTHING`, [username]);
    if (r.changes) await audit.log(ctx, { action: 'role.bootstrap', entity: 'user_org_roles', entityId: username, after: { role: 'platform_admin' } });
  }

  return {
    async loginAd({ username, password, ip }) {
      const name = normalize(username);
      guard.assertNotLocked(name);
      // Connexion de DÉVELOPPEMENT : un mot de passe commun (DEV_LOGIN_PASSWORD, jamais en production) valide n'importe quel
      // identifiant sans interroger l'AD. Chaque usage est journalisé et audité.
      const dev = !!config.devLoginPassword && config.env !== 'production' && safeEqual(password, config.devLoginPassword);
      const auth = dev ? { ok: true } : await ad.authenticate(name, password); // 502 si l'AD est indisponible : ce n'est pas un échec de mot de passe
      if (dev) { log.warn({ username: name }, 'connexion de développement (sans AD)'); await audit.log({ username: name, ip }, { action: 'auth.login_dev', entity: 'session', entityId: name }); }
      if (!auth.ok) {
        guard.recordFailure(name);
        await audit.log({ username: name, ip }, { action: 'auth.login_failed', entity: 'session', entityId: name });
        throw E.unauthorized(INVALID);
      }
      guard.reset(name);
      let adUser = null;
      try { adUser = await ad.getUser(name); } catch (e) { log.warn({ err: e.message }, 'fiche AD indisponible après authentification'); }
      const canonical = adUser?.username || name;
      const agent = await dir.syncOnLogin(adUser || { username: canonical, displayName: canonical, email: null });
      const ctx = { username: canonical, ip };
      await ensureBootstrapAdmin(canonical, ctx);
      const session = await issue({ username: canonical, kind: 'ad', ip });
      await audit.log(ctx, { action: 'auth.login', entity: 'session', entityId: session.jti });
      return { ...session, username: canonical, displayName: agent?.display_name || canonical };
    },

    async loginLocal({ username, password, ip }) {
      const name = normalize(username);
      guard.assertNotLocked('local:' + name);
      const acc = config.localAdmin.enabled ? await db.get('SELECT * FROM local_accounts WHERE username = $1 AND NOT disabled', [name]) : null;
      // comparaison faite même si le compte n'existe pas, pour ne pas révéler son existence par le temps de réponse
      const ok = await bcrypt.compare(String(password), acc?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
      if (!acc || !ok) {
        guard.recordFailure('local:' + name);
        await audit.log({ username: name, ip }, { action: 'auth.local_login_failed', entity: 'session', entityId: name });
        throw E.unauthorized(INVALID);
      }
      guard.reset('local:' + name);
      await db.run('UPDATE local_accounts SET last_login_at = now() WHERE username = $1', [name]);
      const session = await issue({ username: name, kind: 'local', ip });
      await audit.log({ username: name, ip }, { action: 'auth.local_login', entity: 'session', entityId: session.jti, after: { compteDeSecours: true } });
      return { ...session, username: name, displayName: name };
    },

    /** Renouvelle la session tant que la durée maximale (SESSION_MAX_HOURS) depuis la connexion initiale n'est pas atteinte. */
    async refresh(ctx, ip) {
      const current = await sessions.get(ctx.jti);
      const session = await issue({ username: ctx.username, kind: ctx.kind, ip, startedAt: new Date(current.started_at) });
      await sessions.revoke(ctx.jti);
      await audit.log({ username: ctx.username, ip }, { action: 'auth.refresh', entity: 'session', entityId: session.jti });
      return session;
    },

    async logout(ctx, ip) {
      await sessions.revoke(ctx.jti);
      await audit.log({ username: ctx.username, ip }, { action: 'auth.logout', entity: 'session', entityId: ctx.jti });
    },

    /** Crée le compte de secours s'il n'existe pas ; le mot de passe est haché et n'est plus relu depuis l'environnement. */
    async ensureLocalAdmin() {
      const { enabled, username, password } = config.localAdmin;
      if (!enabled) return false;
      const exists = await db.get('SELECT 1 AS x FROM local_accounts WHERE username = $1', [username]);
      if (exists) return false;
      const hash = await bcrypt.hash(password, 12);
      await db.run('INSERT INTO local_accounts (username, password_hash) VALUES ($1, $2)', [username, hash]);
      await db.run(`INSERT INTO user_org_roles (username, organisme_id, role, created_by) VALUES ($1, NULL, 'platform_admin', 'bootstrap') ON CONFLICT DO NOTHING`, [username]);
      await audit.log({ username: 'system' }, { action: 'auth.local_admin_created', entity: 'local_accounts', entityId: username });
      return true;
    },
  };
}

module.exports = { createAuthService };
