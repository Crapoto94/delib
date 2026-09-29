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
      const forme = new FormData();
      forme.set('api', '1');
      const cl = (p.classif || []).map((x) => String(x));
      if (p.natureCode != null) forme.set('nature_code', String(p.natureCode));
      for (let i = 1; i <= 5; i++) if (cl[i - 1] != null && cl[i - 1] !== '') forme.set('classif' + i, String(Number(cl[i - 1])));
      forme.set('number', String(p.number));
      forme.set('decision_date', String(p.decisionDate));
      forme.set('subject', String(p.subject).slice(0, 500));
      forme.set('type_acte', String(p.typeActe || '99_DE'));
      if (p.enAttente) forme.set('en_attente', '1');
      const principal = await piece(p.file);
      forme.set('acte_pdf_file', new Blob([principal.buffer], { type: mimeDe(principal.nom, principal.mime) }), principal.nom);
      for (const a of p.annexes || []) {
        const f = await piece(a);
        forme.append('acte_attachments[]', new Blob([f.buffer], { type: mimeDe(f.nom, f.mime) }), f.nom);
        forme.append('type_pj[]', String(a.typePj || '99_AU'));
      }
      const r = await http(agent).post(url + '/modules/actes/actes_transac_create.php', forme);
      const t = reponseTexte(r.data);
      if (!t.ok) return { ok: false, message: (t.lignes[1] || 'refus de S²LOW').trim() };
      return { ok: true, id: (t.lignes[1] || '').trim() };
    },

    async confirmer(remoteId, organismeId) {
      const t = await appel(organismeId, 'GET', `/modules/actes/actes_transac_post_confirm_api.php?id=${encodeURIComponent(remoteId)}&url_return=${encodeURIComponent('about:blank')}`);
      return t.ok || (t.status >= 300 && t.status < 400) ? { ok: true } : { ok: false, message: (t.lignes[1] || 'confirmation refusée').trim() };
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
      const forme = new FormData();
      forme.set('api', '1'); forme.set('id', String(remoteId)); forme.set('type_envoie', String(typeEnvoie));
      if (file) { const f = await piece(file); forme.set('acte_pdf_file', new Blob([f.buffer], { type: mimeDe(f.nom, f.mime) }), f.nom); }
      const r = await http(agent).post(url + '/modules/actes/actes_transac_reponse_create.php', forme);
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
  };
}

module.exports = { createS2lowHttp, reponseTexte, lireClassification, SCENARIOS };
