/**
 * Adaptateur AuthPort — Active Directory via l'API centrale APM (guide §3).
 *   POST /api/v1/ad/authenticate  (permission ad_auth)   401 = identifiants invalides
 *   GET  /api/v1/ad/user?identifier=  (ad_read)
 *   GET  /api/v1/ad/search?q=         (ad_search)
 * Toutes les données de l'AD sont normalisées ici ; le reste de l'application ne voit jamais le format brut.
 */
const { createHttpClient, call, asList } = require('./http-client');
const { E } = require('../shared/errors');

function normalizeUser(u) {
  if (!u || typeof u !== 'object') return null;
  const username = String(u.sAMAccountName || u.username || u.login || '').trim().toLowerCase();
  if (!username) return null;
  return {
    username,
    displayName: u.displayName || u.cn || username,
    givenName: u.givenName || null,
    surname: u.sn || null,
    email: (u.mail || u.email || '').toLowerCase() || null,
  };
}

function createApmAd(config) {
  const http = createHttpClient({ baseURL: config.apm.url, headers: { 'X-API-KEY': config.apm.key }, tls: config.tls });

  return {
    /** Vérifie un mot de passe. Distingue « identifiants invalides » (ok:false) de « service indisponible » (erreur 502). */
    async authenticate(username, password) {
      const r = await call('APM ad/authenticate', () => http.post('/api/v1/ad/authenticate', { username, password }));
      if (r.status === 200 && r.data?.success === true) return { ok: true };
      if (r.status === 401 || r.status === 400 || r.data?.success === false) return { ok: false };
      // 403/404… : la clé APM n'a pas la permission ad_auth, ou la route a changé : ce n'est PAS un mot de passe faux
      throw E.upstream(`APM ad/authenticate : HTTP ${r.status} (permission ad_auth ?)`);
    },

    async getUser(identifier) {
      const r = await call('APM ad/user', () => http.get('/api/v1/ad/user', { params: { identifier } }));
      if (r.status === 404) return null;
      if (r.status !== 200) throw E.upstream(`APM ad/user : HTTP ${r.status}`);
      return normalizeUser(r.data?.data && !Array.isArray(r.data.data) ? r.data.data : r.data);
    },

    async searchUsers(q) {
      const r = await call('APM ad/search', () => http.get('/api/v1/ad/search', { params: { q } }));
      if (r.status !== 200) throw E.upstream(`APM ad/search : HTTP ${r.status}`);
      return asList(r.data, 'users', 'results').map(normalizeUser).filter(Boolean);
    },

    async ping() {
      const t = Date.now();
      const r = await call('APM status', () => http.get('/api/status'));
      if (r.status !== 200) throw E.upstream(`APM status : HTTP ${r.status}`);
      return Date.now() - t;
    },
  };
}

module.exports = { createApmAd, normalizeUser };
