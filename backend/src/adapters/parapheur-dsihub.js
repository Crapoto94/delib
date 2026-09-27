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

  /** Message renvoyé par le Hub, quel que soit son format : texte, HTML, { error }, { message }, { errors[] }… */
  const messageDuHub = (data) => {
    if (!data) return '';
    if (typeof data === 'string') return data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const v = data.error || data.message || data.detail || data.errors;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x?.message || JSON.stringify(x))).join(' ; ').slice(0, 300);
    if (v && typeof v === 'object') return JSON.stringify(v).slice(0, 300);
    return v ? String(v).slice(0, 300) : '';
  };

  /**
   * Le Hub a répondu (HTTP non 2xx), ou il est réellement injoignable : deux situations très différentes, qu'il ne
   * faut pas confondre. Un refus (400, 401, 500…) est affiché avec son code ET le message du Hub — sans quoi
   * l'administration ne voit qu'« injoignable » alors que le serveur a bel et bien répondu pourquoi.
   */
  const failNet = (e) => {
    const r = e?.response;
    if (r) {
      const m = messageDuHub(r.data);
      return E.upstream(`Le parapheur DSIHUB a répondu HTTP ${r.status}${m ? ` : ${m}` : ''}`);
    }
    return E.upstream(`Hub DSI injoignable : ${e.code || e.message}`);
  };

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

    async creer(cfg, { titre, message, deadline, mode, signataires, documents, service }) {
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
        // Nom affiché comme expéditeur de la demande : le Hub écrit « <service> vous invite à signer un arrêté ».
        ...(service ? { service: String(service).slice(0, 200) } : {}),
        mode: mode || 'sequentiel', link_validity_minutes: 60,
        signataires: (signataires || []).map((s) => ({
          email: s.email, nom: s.nom, ...(s.qualite ? { title: s.qualite } : {}),
          signatureMode: s.mode || 'simple',
          ...(s.mode === 'sms' && s.telephone ? { smsPhone: String(s.telephone).replace(/\s/g, '') } : {}),
          // Position définie dans VibeDélib (mécanisme du Hub DSI : page 1-based, centre en %, w/h en points).
          // À défaut (document de test), on fournit une position par défaut en bas du document, sinon le Hub
          // n'expose pas le document (« Aucune position définie »).
          positions: (Array.isArray(s.positions) && s.positions.length) ? s.positions : docs.map((_d, i) => ({ documentIndex: i, page: 1, x: 75, y: 85, w: 150, h: 60 })),
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
      // Documents du dossier : le Hub indique, pour chacun, si une version signée existe (`has_signed`). Sert à
      // récupérer le PDF signé une fois la signature apposée (`telechargerDocument`).
      const documents = Array.isArray(brut.documents) ? brut.documents.map((d) => ({
        id: d.id, nom: d.original_name || d.nom || null, signe: !!(d.has_signed || d.signed),
      })) : [];
      // Signataires : qui a signé, et **par délégation de qui** le cas échéant. Le Hub met `signed_by_name` à null
      // quand le signataire a signé lui-même ; sinon c'est le nom du délégué (un agent ou l'adjoint désigné).
      const signataires = Array.isArray(brut.signataires) ? brut.signataires.map((s) => ({
        nom: s.nom || null, email: s.email || null, statut: s.status || null, mode: s.signature_mode || null,
        signeAt: s.signed_at || null, signePar: s.signed_by_name || null, motif: s.rejection_comment || null,
      })) : [];
      return { statut: map[st] || 'en_cours', signeAt: brut.signeAt || brut.date_signature || null, motif: brut.motif || brut.reason || null, documents, signataires, brut,
        _echange: { methode: 'GET', url: `/api/parapheur/${ref}`, httpStatus: r.status, reponse: brut } };
    },

    /** Récupère un document du dossier, dans sa version signée (`signed=1`) : GET /api/parapheur/:id/doc/:docId. */
    async telechargerDocument(cfg, ref, docId) {
      const client = clientOf(cfg); const token = await jeton(client, cfg);
      const r = await client.get(`/api/parapheur/${encodeURIComponent(ref)}/doc/${encodeURIComponent(docId)}`, {
        params: { signed: 1 }, headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer',
      }).catch((e) => { throw failNet(e); });
      if (r.status === 404) throw E.notFound('Le parapheur DSIHUB n’a pas de document signé pour ce dossier');
      if (r.status >= 400) throw E.upstream(`Le parapheur DSIHUB n’a pas renvoyé le document signé (HTTP ${r.status})`);
      const disposition = String(r.headers?.['content-disposition'] || '');
      const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
      let nom = m ? decodeURIComponent(m[1].trim()) : null;
      if (!nom) nom = `document-signe-${docId}.pdf`;
      return { buffer: Buffer.from(r.data), name: nom, mime: 'application/pdf' };
    },

    async annuler(cfg, ref) {
      const client = clientOf(cfg); const token = await jeton(client, cfg);
      const r = await client.post(`/api/parapheur/${encodeURIComponent(ref)}/annuler`, {}, { headers: { Authorization: `Bearer ${token}` } })
        .catch((e) => { throw failNet(e); });
      return { _echange: { methode: 'POST', url: `/api/parapheur/${ref}/annuler`, httpStatus: r.status, reponse: r.data } };
    },

    /**
     * Lien d'accès au Hub, déjà authentifié, pour un ÉLU consultant SON parapheur (pas l'envoi d'un acte) : le
     * compte technique (celui de `jeton`) obtient un jeton pour son propre compte, puis demande au Hub un jeton
     * DÉLÉGUÉ pour l'élu identifié par e-mail (`/api/auth/magapp-parapheur-access-pour`, restreint côté Hub aux
     * comptes techniques autorisés — jamais le mot de passe de l'élu). Même principe que le « magasin
     * d'applications » utilisé par les agents, un cran plus loin.
     */
    async accesDelegue(cfg, email) {
      const client = clientOf(cfg); const token = await jeton(client, cfg);
      const r = await client.post('/api/auth/magapp-parapheur-access-pour', { email }, { headers: { Authorization: `Bearer ${token}` } })
        .catch((e) => { throw failNet(e); });
      if (r.status === 404) throw E.notFound('Aucun compte Hub DSI ne correspond à cette adresse e-mail');
      if (r.status >= 400) throw E.upstream(`Le Hub DSI a refusé la délégation d’accès (HTTP ${r.status}${r.data?.message ? ` : ${r.data.message}` : ''})`);
      const url = r.data?.url;
      if (!url) throw E.upstream('Le Hub DSI n’a pas renvoyé de lien d’accès');
      return { url };
    },
  };
}

module.exports = { createDsihubParapheur };
