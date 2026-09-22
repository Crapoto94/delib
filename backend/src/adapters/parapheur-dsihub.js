/**
 * Adaptateur ParapheurPort — DSIHUB (« Hub DSI », c:\dev\dsihub / c:\dev\AppDSI).
 *
 * L'API du parapheur du Hub est appelée en machine-à-machine :
 *   POST /api/login              { username, password } -> { token }        (compte technique du paramétrage)
 *   POST /api/parapheur          multipart (payload JSON + documents PDF)   -> { id, reference }
 *   GET  /api/parapheur/:id      état du dossier (en_cours / termine / refuse / annule)
 *   POST /api/parapheur/:id/annuler
 * Aucun webhook n'existe côté Hub : l'état est obtenu par interrogation (polling). Les échanges sont renvoyés dans
 * `_echange` pour que le service les journalise (ce qui est envoyé et ce qui revient). Les identifiants ne sont
 * jamais journalisés. `http` (axios-like) est injectable pour les tests ; `tls` porte l'autorité interne de la Ville.
 */
const { createHttpClient } = require('./http-client');
const { E } = require('../shared/errors');

function createDsihubParapheur({ tls, http: injected } = {}) {
  const clientOf = (cfg) => injected || createHttpClient({ baseURL: String(cfg.url || '').replace(/\/+$/, ''), tls, timeoutMs: 30000, headers: { Accept: 'application/json' } });
  const failNet = (e) => E.upstream(`Hub DSI injoignable : ${e.code || e.message}`);

  /** Obtient un jeton de session (compte technique) : POST /api/login. */
  async function jeton(client, cfg) {
    if (!cfg.url || !cfg.utilisateur || !cfg.secret) throw E.conflict('Renseignez l’URL, le compte et le mot de passe du Hub DSI (Paramétrages / Parapheur)');
    const r = await client.post('/api/login', { username: cfg.utilisateur, password: cfg.secret }).catch((e) => { throw failNet(e); });
    if (r.status >= 400) throw E.upstream(`Authentification au Hub DSI refusée (HTTP ${r.status})`);
    const token = r.data?.token || r.data?.accessToken || r.data?.jwt;
    if (!token) throw E.upstream('Le Hub DSI n’a pas renvoyé de jeton de session');
    return token;
  }

  return {
    fournisseur: 'dsihub',

    async testConnexion(cfg) {
      const t = Date.now();
      try {
        const client = clientOf(cfg); const token = await jeton(client, cfg);
        const r = await client.get('/api/parapheur/', { headers: { Authorization: `Bearer ${token}` } }).catch((e) => { throw failNet(e); });
        if (r.status === 401 || r.status === 403) return { ok: false, message: 'Compte authentifié, mais sans accès au parapheur', details: { etape: 'droits', http: r.status } };
        if (r.status >= 400) return { ok: false, message: `Le Hub DSI a répondu HTTP ${r.status} sur /api/parapheur/`, details: { etape: 'parapheur', http: r.status } };
        return { ok: true, message: 'Connexion au parapheur DSIHUB réussie', details: { ms: Date.now() - t } };
      } catch (e) { return { ok: false, message: e.message, details: { etape: 'connexion' } }; }
    },

    async creer(cfg, { titre, message, deadline, mode, signataires, documents }) {
      const client = clientOf(cfg); const token = await jeton(client, cfg);
      const docs = documents || [];
      const form = new FormData();
      for (const d of docs) {
        // Un Buffer Node ne suffit pas toujours (nom de fichier perdu, « blob ») : on l'enveloppe dans un Blob
        // nommé — le Hub enregistre alors le vrai titre du document. Repli sur le Buffer si Blob est absent.
        const bytes = d.buffer instanceof Uint8Array ? d.buffer : new Uint8Array(d.buffer);
        const nom = d.nom || 'document.pdf';
        const corps = typeof Blob !== 'undefined' ? new Blob([bytes], { type: d.mime || 'application/pdf' }) : bytes;
        form.append('documents', corps, nom);
      }
      const payload = {
        title: titre, ...(message ? { message } : {}), ...(deadline ? { deadline } : {}),
        mode: mode || 'sequentiel', link_validity_minutes: 60,
        signataires: (signataires || []).map((s) => ({
          email: s.email, nom: s.nom, ...(s.qualite ? { title: s.qualite } : {}),
          signatureMode: s.mode || 'simple',
          ...(s.mode === 'sms' && s.telephone ? { smsPhone: String(s.telephone).replace(/\s/g, '') } : {}),
          // Le Hub n'expose le document (et ne pose le cadre) que s'il reçoit une position de signature :
          // on en fournit systématiquement une (bas de la dernière page), sinon « Aucune position définie ».
          positions: (s.positions || docs.map((_d, i) => ({ documentIndex: i, page: 0, x: 75, y: 85, w: 150, h: 60 }))),
        })),
      };
      form.append('payload', JSON.stringify(payload));
      const r = await client.post('/api/parapheur', form, { headers: { Authorization: `Bearer ${token}` }, maxBodyLength: Infinity, maxContentLength: Infinity })
        .catch((e) => { throw failNet(e); });
      if (r.status >= 400) throw E.upstream(`Le parapheur DSIHUB a refusé l’envoi (HTTP ${r.status}${r.data?.error ? ` : ${r.data.error}` : ''})`);
      const id = r.data?.id ?? r.data?.parapheur?.id ?? null;
      const reference = r.data?.reference ?? r.data?.parapheur?.reference ?? (id != null ? String(id) : null);
      return { id, reference, lien: r.data?.lien || r.data?.url || null, brut: r.data,
        _echange: { methode: 'POST', url: '/api/parapheur', httpStatus: r.status, corps: { ...payload, signataires: payload.signataires.map((s) => ({ ...s, positions: `${(s.positions || []).length} position(s)` })) }, reponse: r.data } };
    },

    async statut(cfg, ref) {
      const client = clientOf(cfg); const token = await jeton(client, cfg);
      const r = await client.get(`/api/parapheur/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${token}` } }).catch((e) => { throw failNet(e); });
      if (r.status >= 400) throw E.upstream(`Le parapheur DSIHUB a répondu HTTP ${r.status}`);
      const brut = r.data?.parapheur || r.data?.dossier || r.data || {};
      const st = String(brut.statut || brut.status || '').toLowerCase();
      const map = { termine: 'signe', signe: 'signe', refuse: 'refuse', annule: 'annule', en_cours: 'en_cours' };
      return { statut: map[st] || 'en_cours', signeAt: brut.signeAt || brut.date_signature || null, motif: brut.motif || brut.reason || null, brut,
        _echange: { methode: 'GET', url: `/api/parapheur/${ref}`, httpStatus: r.status, reponse: brut } };
    },

    async annuler(cfg, ref) {
      const client = clientOf(cfg); const token = await jeton(client, cfg);
      const r = await client.post(`/api/parapheur/${encodeURIComponent(ref)}/annuler`, {}, { headers: { Authorization: `Bearer ${token}` } })
        .catch((e) => { throw failNet(e); });
      return { _echange: { methode: 'POST', url: `/api/parapheur/${ref}/annuler`, httpStatus: r.status, reponse: r.data } };
    },
  };
}

module.exports = { createDsihubParapheur };
