/**
 * Adaptateur TeletransmissionPort — S²LOW RÉEL (API ACTES v5.1, D20).
 * Même contrat que `s2low-simulateur.js` (testConnexion, classification, creer, confirmer, statut, arActe,
 * documentsPrefecture, marquerLu, repondre, annuler, bordereau).
 *
 * Authentification : CERTIFICAT CLIENT P12 (mutual TLS), UN PAR COLLECTIVITÉ. Le certificat est importé dans
 * Paramétrage → Télétransmission ; il identifie l'utilisateur et sa collectivité (`/api/info-connexion.php`).
 * À défaut d'import, on retombe sur le certificat de l'environnement (S2LOW_P12_FILE) — utile pour les tests.
 *
 * Format des réponses de l'API ACTES : « OK\n<donnée>… » (succès) ou « KO\n<message> » (échec).
 */
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const axios = require('axios');
const { E } = require('../shared/errors');
const { SCENARIOS, STATUS } = require('./s2low-simulateur');

const TYPES_PJ = [['99_DE', 'Délibération'], ['99_AU', 'Autre document'], ['22_AN', 'Annexe'], ['99_CO', 'Convention'], ['99_PL', 'Plan']];
const NATURES = [[1, 'Délibérations'], [2, 'Actes réglementaires'], [3, 'Actes individuels'], [4, 'Contrats, conventions et avenants'], [5, 'Documents budgétaires et financiers'], [6, 'Autres']];
const CLASSIFICATION_TTL_MS = 60 * 60 * 1000;

/** « OK\n… » ou « KO\n<message> » → { ok, lignes } */
function reponseTexte(corps) {
  const lignes = String(corps ?? '').replace(/\r\n/g, '\n').split('\n');
  const ok = (lignes[0] || '').trim().toUpperCase() === 'OK';
  return { ok, entete: (lignes[0] || '').trim(), lignes, reste: lignes.slice(1).join('\n') };
}

/** Extrait les valeurs d'un XML de classification (tolérant). */
function lireClassification(xml) {
  const elements = (tag) => [...String(xml).matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
  const attribut = (balise, noms) => { for (const n of noms) { const m = new RegExp(`${n}\\s*=\\s*"([^"]*)"`, 'i').exec(balise); if (m) return m[1].trim(); } return null; };
  const natures = elements('Nature').map((b) => ({ code: Number(attribut(b, ['Code', 'CodeNature'])) || attribut(b, ['Code', 'CodeNature']), label: attribut(b, ['Libelle', 'Label']) || '' })).filter((n) => n.code != null);
  const typesPj = elements('TypePJ').map((b) => ({ code: attribut(b, ['Code', 'CodeTypePJ']), label: attribut(b, ['Libelle', 'Label']) || '' })).filter((t) => t.code);
  return { natures, typesPj };
}

/**
 * Corps multipart/form-data construit à la main.
 * Raison : S²LOW lit les champs POST en ISO-8859-1 (il applique `utf8_encode()` côté PHP). Envoyés en UTF-8, les
 * accents se retrouvent doublés (« VibeDélib » devient « VibeDÃ©lib »). On encode donc les champs texte en Latin-1
 * et les fichiers en binaire, sans passer par FormData (qui impose l'UTF-8).
 */
const versLatin1 = (s) => String(s)
  .replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...').replace(/\u00A0/g, ' ')
  .replace(/\u0153/g, 'oe').replace(/\u0152/g, 'OE').replace(/\u20AC/g, 'EUR')
  .replace(/[^\x00-\xFF]/g, '?'); // hors ISO-8859-1 : remplacé plutôt que tronqué

function corpsMultipart(parties, frontiere) {
  const morceaux = [];
  for (const p of parties) {
    if (p.fichier) {
      const nom = String(p.fichier.nom || 'fichier').replace(/[\r\n"]/g, '');
      morceaux.push(Buffer.from(`--${frontiere}\r\nContent-Disposition: form-data; name="${p.nom}"; filename="${nom}"\r\nContent-Type: ${p.fichier.mime || 'application/octet-stream'}\r\n\r\n`, 'utf8'));
      morceaux.push(p.fichier.buffer);
      morceaux.push(Buffer.from('\r\n', 'utf8'));
    } else if (p.valeur !== undefined && p.valeur !== null) {
      morceaux.push(Buffer.from(`--${frontiere}\r\nContent-Disposition: form-data; name="${p.nom}"\r\n\r\n`, 'utf8'));
      morceaux.push(Buffer.from(String(versLatin1(p.valeur)), 'latin1'));
      morceaux.push(Buffer.from('\r\n', 'utf8'));
    }
  }
  morceaux.push(Buffer.from(`--${frontiere}--\r\n`, 'utf8'));
  return Buffer.concat(morceaux);
}

function createS2lowHttp({ db, storage, config, log, settings, certificat }) {
  const cfg = config.s2low || {};
  const ca = config.tls?.caFile ? fs.readFileSync(config.tls.caFile) : undefined;
  const agents = new Map(); // clé (organisme+empreinte+url) → https.Agent
  const arParTransaction = new Map();
  const cacheClassif = new Map(); // organismeId → { quand, valeur }

  const certificatEnvironnement = () => (cfg.p12File ? { pfx: fs.readFileSync(cfg.p12File), passphrase: cfg.p12Passphrase, empreinte: 'env' } : null);

  /** URL de l'instance + agent HTTPS portant le certificat de la collectivité. */
  const contexte = async (organismeId) => {
    let url = cfg.url;
    if (organismeId) { try { const c = await settings.resolve(organismeId); url = c['tdt.s2low.url']?.value || url; } catch { /* paramétrage indisponible */ } }
    url = String(url || '').replace(/\/+$/, '');
    if (!url) throw E.conflict("Adresse de l'instance S²LOW absente (Paramétrage → Télétransmission, ou S2LOW_URL)");
    let cert = null;
    try { cert = (await certificat?.(organismeId)) || null; } catch (e) { log?.warn?.({ err: e.message }, 'certificat S²LOW : lecture impossible'); }
    if (!cert) cert = certificatEnvironnement();
    if (!cert?.pfx) throw E.conflict("Certificat client S²LOW absent : importez-le dans Paramétrage → Télétransmission");
    const cle = `${organismeId || 0}|${cert.empreinte || ''}|${url}`;
    let agent = agents.get(cle);
    if (!agent) { agent = new https.Agent({ pfx: cert.pfx, passphrase: cert.passphrase || undefined, ca, rejectUnauthorized: !!ca || !config.tls?.allowSelfSigned }); agents.set(cle, agent); }
    return { url, agent };
  };
  const http = (agent) => axios.create({ httpsAgent: agent, timeout: 60000, validateStatus: () => true, maxRedirects: 0, responseType: 'text', transformResponse: (x) => x });

  /** Cookie PHPSESSID d'une réponse S²LOW. */
  function extraireCookie(setCookie) {
    return (Array.isArray(setCookie) ? setCookie : [setCookie])
      .filter(Boolean)
      .map((c) => String(c).split(';')[0])
      .filter((c) => c.startsWith('PHPSESSID='))
      .join('; ');
  }

  /**
   * Sessions S²LOW, indispensables pour le nonce : `SimpleCertificateAuthenticator` et `NounceAuthenticator`
   * refusent toute requête portant un header `Authorization: Basic` (test sur PHP_AUTH_USER), et
   * `/api/get-nounce.php` n'est atteint que si une session est DÉJÀ authentifiée — sans quoi Symfony
   * redirige vers `/`. On ouvre donc une session par `POST /login.php` (login + mot de passe du compte S²LOW
   * de la collectivité), puis on la réutilise pour demander le nonce.
   */
  const sessions = new Map();
  async function sessionS2low(organismeId, agent, url, login, password) {
    const cle = `${organismeId || 0}|${login}`;
    const oublier = () => sessions.delete(cle);
    if (sessions.has(cle)) return { cookie: sessions.get(cle), oublier };
    const r = await http(agent).post(url + '/login.php', new URLSearchParams({ login, password }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = extraireCookie(r.headers['set-cookie']);
    if (!cookie) {
      const err = /error=([^&]+)/.exec(String(r.headers.location || ''));
      throw E.conflict(`Connexion au compte S²LOW « ${login} » refusée${err ? ` : ${decodeURIComponent(err[1].replace(/\+/g, ' '))}` : ''}.`);
    }
    sessions.set(cle, cookie);
    return { cookie, oublier };
  }

  async function appel(organismeId, methode, chemin, params) {
    const { url, agent } = await contexte(organismeId);
    const r = await http(agent).request({ method: methode, url: url + chemin, data: params ? new URLSearchParams(params).toString() : undefined, headers: params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined });
    return { ...reponseTexte(r.data), status: r.status };
  }

  /** Pièce à joindre : buffer fourni directement (acte de test) ou récupéré du stockage par fileId. */
  async function piece(f) {
    if (f?.buffer) return { nom: f.name || 'acte.pdf', mime: f.mime || 'application/pdf', buffer: f.buffer };
    const row = await db.get('SELECT storage_key, original_name, mime FROM files WHERE id = $1', [f.fileId]);
    if (!row) throw E.conflict(`Pièce introuvable (fichier ${f.fileId})`);
    return { nom: row.original_name, mime: row.mime, buffer: await storage.get(row.storage_key) };
  }
  const mimeDe = (nom, mime) => mime || (String(nom).toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  return {
    mode: 'reel',

    /** Vérifie l'instance ET le certificat : renvoie aussi l'utilisateur et la collectivité reconnus. */
    async testConnexion(organismeId) {
      const { url, agent } = await contexte(organismeId);
      const t = await http(agent).get(url + '/api/test-connexion.php');
      const r = reponseTexte(t.data);
      if (!r.ok) return { ok: false, message: `S²LOW : ${(r.lignes[1] || 'connexion refusée').trim()}` };
      let identite = null;
      try {
        const info = await http(agent).get(url + '/api/info-connexion.php');
        const d = typeof info.data === 'string' ? JSON.parse(info.data) : info.data;
        const u = d?.user_info || {}; const a = d?.authority_info || {};
        identite = { utilisateur: u.name || u.email || null, email: u.email || null, collectivite: a.name || null, siren: a.siren || null, departement: a.department || null };
      } catch (e) { log?.warn?.({ err: e.message }, 'identité S²LOW illisible'); }
      return { ok: true, message: identite?.collectivite ? `Certificat reconnu : ${identite.utilisateur} — ${identite.collectivite}` : `S²LOW joignable (${url})`, identite };
    },

    async classification(organismeId) {
      const c = cacheClassif.get(organismeId);
      if (c && Date.now() - c.quand < CLASSIFICATION_TTL_MS) return c.valeur;
      try {
        await appel(organismeId, 'POST', '/modules/actes/actes_classification_request.php', { api: 1 });
        const { url, agent } = await contexte(organismeId);
        const r = await http(agent).get(url + '/modules/actes/actes_classification_fetch.php?api=1');
        const res = lireClassification(r.data);
        if (res.natures.length) { cacheClassif.set(organismeId, { quand: Date.now(), valeur: res }); return res; }
        log?.warn?.('classification S²LOW illisible : listes de référence utilisées');
      } catch (e) { log?.warn?.({ err: e.message }, 'classification S²LOW indisponible : listes de référence utilisées'); }
      const valeur = { natures: NATURES.map(([code, label]) => ({ code, label })), typesPj: TYPES_PJ.map(([code, label]) => ({ code, label })) };
      cacheClassif.set(organismeId, { quand: Date.now(), valeur });
      return valeur;
    },

    /** POST multipart actes_transac_create.php → identifiant de transaction S²LOW. */
    async creer(p) {
      const { url, agent } = await contexte(p.organismeId);
      const cl = (p.classif || []).map((x) => String(x));
      const parties = [{ nom: 'api', valeur: '1' }];
      if (p.natureCode != null) parties.push({ nom: 'nature_code', valeur: String(p.natureCode) });
      for (let i = 1; i <= 5; i++) if (cl[i - 1] != null && cl[i - 1] !== '') parties.push({ nom: 'classif' + i, valeur: String(Number(cl[i - 1])) });
      parties.push({ nom: 'number', valeur: String(p.number) });
      parties.push({ nom: 'decision_date', valeur: String(p.decisionDate) });
      parties.push({ nom: 'subject', valeur: String(p.subject).slice(0, 500) });
      parties.push({ nom: 'type_acte', valeur: String(p.typeActe || '99_DE') });
      if (p.enAttente) parties.push({ nom: 'en_attente', valeur: '1' });
      const principal = await piece(p.file);
      parties.push({ nom: 'acte_pdf_file', fichier: { nom: principal.nom, buffer: principal.buffer, mime: mimeDe(principal.nom, principal.mime) } });
      for (const a of p.annexes || []) {
        const f = await piece(a);
        parties.push({ nom: 'acte_attachments[]', fichier: { nom: f.nom, buffer: f.buffer, mime: mimeDe(f.nom, f.mime) } });
        parties.push({ nom: 'type_pj[]', valeur: String(a.typePj || '99_AU') });
      }
      const frontiere = '----VibeDelib' + crypto.randomBytes(12).toString('hex');
      const corps = corpsMultipart(parties, frontiere);
      const r = await http(agent).post(url + '/modules/actes/actes_transac_create.php', corps, { headers: { 'Content-Type': `multipart/form-data; boundary=${frontiere}`, 'Content-Length': corps.length } });
      const t = reponseTexte(r.data);
      if (!t.ok) return { ok: false, message: (t.lignes[1] || 'refus de S²LOW').trim() };
      return { ok: true, id: (t.lignes[1] || '').trim() };
    },

    /**
     * Mode B : ordonne la télétransmission d'un acte « en attente d'être postée ».
     * S²LOW n'authentifie CETTE route que par NONCE (NounceAuthenticator), et exige en plus un certificat
     * valide ainsi qu'une session déjà ouverte. Flux : `POST /login.php` (session) → `GET /api/get-nounce.php`
     * (Basic login:mot de passe + cookie de session) → `GET …/actes_transac_post_confirm_api.php` avec
     * `nounce`, `login` et `hash = sha256("motdepasse:nounce")` (sans Basic ni cookie : route « stateless »).
     * S²LOW répond toujours par une redirection vers `url_return`, avec `%%ERROR%%` (0 = succès, 1 = échec) et
     * `%%MESSAGE%%` (motif).
     */
    async confirmer(remoteId, organismeId, identifiants) {
      const { url, agent } = await contexte(organismeId);
      const login = identifiants?.login; const password = identifiants?.password;
      if (!login || !password) throw E.conflict("La confirmation exige l’identifiant technique et le mot de passe S²LOW (authentification par nonce) : renseignez-les dans Paramétrage → Télétransmission.");
      const { cookie, oublier } = await sessionS2low(organismeId, agent, url, login, password);
      const n = await http(agent).get(url + '/api/get-nounce.php', { headers: { Authorization: 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64'), Cookie: cookie } });
      let nounce = null; try { nounce = (typeof n.data === 'string' ? JSON.parse(n.data) : n.data)?.nounce || null; } catch { nounce = null; }
      if (!nounce) { oublier(); return { ok: false, message: `Nonce S²LOW indisponible (HTTP ${n.status}) : la session n’a pas pu être ouverte.` }; }
      const hash = crypto.createHash('sha256').update(`${password}:${nounce}`).digest('hex');
      const retour = 'https://vibedelib.invalid/retour?e=%%ERROR%%&m=%%MESSAGE%%';
      const q = new URLSearchParams({ id: String(remoteId), url_return: retour, nounce, login, hash });
      const r = await http(agent).get(url + '/modules/actes/actes_transac_post_confirm_api.php?' + q.toString());
      const loc = String(r.headers?.location || '');
      const drapeau = /[?&]e=(\d+)/.exec(loc);
      if (drapeau && drapeau[1] === '0') return { ok: true };
      const brut = (/[?&]m=([^&]*)/.exec(loc) || [])[1] || reponseTexte(r.data).lignes[1] || '';
      const message = decodeURIComponent(String(brut).replace(/\+/g, ' ')).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
      return { ok: false, message: message || 'confirmation refusée par S²LOW' };
    },

    async statut(remoteId, organismeId) {
      let t;
      try { t = await appel(organismeId, 'GET', `/modules/actes/actes_transac_get_status.php?transaction=${encodeURIComponent(remoteId)}`); }
      catch (e) { log?.warn?.({ err: e.message, remoteId }, 'statut S²LOW indisponible'); return null; }
      if (!t.ok) return { remoteId, status: null, label: (t.lignes[1] || 'Inconnu').trim(), message: (t.lignes[1] || '').trim() || null, ar: null };
      const status = Number((t.lignes[1] || '').trim());
      const xml = t.lignes.slice(2).join('\n').trim();
      if (status === 4 && xml) {
        const at = (nom) => { const m = new RegExp(`\\b${nom}="([^"]*)"`).exec(xml); return m ? m[1] : null; };
        arParTransaction.set(String(remoteId), xml);
        return { remoteId, status, label: STATUS[status] || String(status), message: null, ar: { id: at('IDActe'), date: at('DateReception') } };
      }
      return { remoteId, status, label: STATUS[status] || String(status), message: status === -1 ? (t.lignes[2] || null) : null, ar: null };
    },

    async arActe(remoteId) { return arParTransaction.get(String(remoteId)) || null; },

    async annuler(remoteId, organismeId) {
      const t = await appel(organismeId, 'POST', '/modules/actes/actes_transac_cancel.php', { api: 1, id: remoteId });
      return t.ok ? { ok: true } : { ok: false, message: (t.lignes[1] || 'annulation refusée').trim() };
    },

    async documentsPrefecture(organismeId) {
      const { url, agent } = await contexte(organismeId);
      const r = await http(agent).get(url + '/modules/actes/api/list_document_prefecture.php');
      let liste; try { liste = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch { return []; }
      return (Array.isArray(liste) ? liste : []).map((d) => ({ id: String(d.id ?? d.transaction_id), remoteId: String(d.related_transaction ?? d.related_id ?? d.id), type: Number(d.type), titre: d.libelle || d.titre || `Document de la préfecture (${d.type})`, contenu: d.contenu || d.commentaire || '', date: d.date || d.created_at || null }));
    },

    async marquerLu(docId, organismeId) {
      await appel(organismeId, 'GET', `/modules/actes/api/document_prefecture_mark_as_read.php?transaction_id=${encodeURIComponent(docId)}`);
    },

    async repondre(remoteId, { typeEnvoie, message, file } = {}, organismeId) {
      const { url, agent } = await contexte(organismeId);
      void message;
      const parties = [{ nom: 'api', valeur: '1' }, { nom: 'id', valeur: String(remoteId) }, { nom: 'type_envoie', valeur: String(typeEnvoie) }];
      if (file) { const f = await piece(file); parties.push({ nom: 'acte_pdf_file', fichier: { nom: f.nom, buffer: f.buffer, mime: mimeDe(f.nom, f.mime) } }); }
      const frontiere = '----VibeDelib' + crypto.randomBytes(12).toString('hex');
      const corps = corpsMultipart(parties, frontiere);
      const r = await http(agent).post(url + '/modules/actes/actes_transac_reponse_create.php', corps, { headers: { 'Content-Type': `multipart/form-data; boundary=${frontiere}`, 'Content-Length': corps.length } });
      const t = reponseTexte(r.data);
      return t.ok ? { ok: true } : { ok: false, message: (t.lignes[1] || 'réponse refusée').trim() };
    },

    async bordereau(remoteId, organismeId) {
      const { url, agent } = await contexte(organismeId);
      const r = await http(agent).get(url + `/modules/actes/actes_create_pdf.php?trans_id=${encodeURIComponent(remoteId)}`, { responseType: 'arraybuffer' });
      if (r.status !== 200 || !r.data?.byteLength) return null;
      return Buffer.from(r.data);
    },

    /** Acte (ou annexe) tamponné par S²LOW (retour de la préfecture). */
    async tampon(remoteId, organismeId) {
      const { url, agent } = await contexte(organismeId);
      const r = await http(agent).get(url + `/modules/actes/actes_transac_get_tampon.php?transaction=${encodeURIComponent(remoteId)}`, { responseType: 'arraybuffer' });
      if (r.status !== 200 || !r.data?.byteLength) return null;
      return Buffer.from(r.data);
    },

    /**
     * PDF de l'acte TAMPONNÉ PAR S²LOW (le tampon est émis par S²LOW, pas par nous) :
     * récupère la liste des fichiers de la transaction (l'« acquittement » doit être reçu) puis télécharge le
     * fichier principal avec `tampon=true`. C'est la version qui fait foi dans la bibliothèque.
     */
    async fichierTamponne(remoteId, organismeId, dateAffichage) {
      const { url, agent } = await contexte(organismeId);
      const l = await http(agent).get(url + `/modules/actes/actes_transac_get_files_list.php?transaction=${encodeURIComponent(remoteId)}`);
      const corps = String(l.data || '');
      if (!/^OK/.test(corps.trim())) return null; // « KO\nPas d'acquittement recu »
      let liste; try { liste = JSON.parse(corps.replace(/^OK\n?/, '')); } catch { return null; }
      if (!Array.isArray(liste) || !liste.length) return null;
      const principal = liste.find((f) => String(f.code_pj || '').startsWith('99_DE')) || liste[0];
      const q = new URLSearchParams({ file: String(principal.id), tampon: 'true' });
      if (dateAffichage) q.set('date_affichage', String(dateAffichage));
      const p = await http(agent).get(url + '/modules/actes/actes_download_file.php?' + q.toString(), { responseType: 'arraybuffer' });
      if (p.status !== 200 || !p.data?.byteLength) return null;
      return Buffer.from(p.data);
    },
  };
}

module.exports = { createS2lowHttp, reponseTexte, lireClassification, SCENARIOS };
