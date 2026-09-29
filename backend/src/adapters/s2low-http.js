/**
 * Adaptateur TeletransmissionPort — S²LOW RÉEL (API ACTES v5.1, D20).
 * Même contrat que `s2low-simulateur.js` (testConnexion, classification, creer, confirmer, statut, arActe,
 * documentsPrefecture, marquerLu, repondre, annuler, bordereau).
 *
 * Authentification : CERTIFICAT CLIENT P12 (mutual TLS). Le certificat identifie l'utilisateur S²LOW et sa
 * collectivité (`/api/info-connexion.php`) ; aucun login/mot de passe n'est nécessaire. Le mot de passe de la
 * clé vient de l'environnement, jamais du code.
 *
 * Toutes les réponses de l'API ACTES suivent le même format texte :
 *   succès : « OK\n<donnée>… »   échec : « KO\n<message> »
 */
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { E } = require('../shared/errors');
const { SCENARIOS, STATUS } = require('./s2low-simulateur');

const TYPES_PJ = [['99_DE', 'Délibération'], ['99_AU', 'Autre document'], ['22_AN', 'Annexe'], ['99_CO', 'Convention'], ['99_PL', 'Plan']];
const NATURES = [[1, 'Délibérations'], [2, 'Actes réglementaires'], [3, 'Actes individuels'], [4, 'Contrats, conventions et avenants'], [5, 'Documents budgétaires et financiers'], [6, 'Autres']];
const CLASSIFICATION_TTL_MS = 60 * 60 * 1000; // la classification change rarement : on la garde une heure

/** « OK\n… » ou « KO\n<message> » → { ok, lignes } */
function reponseTexte(corps) {
  const lignes = String(corps ?? '').replace(/\r\n/g, '\n').split('\n');
  const ok = (lignes[0] || '').trim().toUpperCase() === 'OK';
  return { ok, entete: (lignes[0] || '').trim(), lignes, reste: lignes.slice(1).join('\n') };
}

/** Extrait les valeurs d'un XML de classification (tolérant : attributs Code/CodeNature/CodeTypePJ + libellés). */
function lireClassification(xml) {
  const elements = (tag) => [...String(xml).matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
  const attribut = (balise, noms) => { for (const n of noms) { const m = new RegExp(`${n}\\s*=\\s*"([^"]*)"`, 'i').exec(balise); if (m) return m[1].trim(); } return null; };
  const natures = elements('Nature').map((b) => ({ code: Number(attribut(b, ['Code', 'CodeNature', 'value'])) || attribut(b, ['Code', 'CodeNature']), label: attribut(b, ['Libelle', 'Label', 'value']) || '' })).filter((n) => n.code != null);
  const typesPj = elements('TypePJ').map((b) => ({ code: attribut(b, ['Code', 'CodeTypePJ']), label: attribut(b, ['Libelle', 'Label']) || '' })).filter((t) => t.code);
  return { natures, typesPj };
}

function createS2lowHttp({ db, storage, config, log, settings }) {
  const cfg = config.s2low || {};
  const pfx = cfg.p12File ? fs.readFileSync(cfg.p12File) : null;
  const ca = config.tls?.caFile ? fs.readFileSync(config.tls.caFile) : undefined;
  const agent = new https.Agent({ pfx: pfx || undefined, passphrase: cfg.p12Passphrase || undefined, ca, rejectUnauthorized: !!ca || !config.tls?.allowSelfSigned });
  const arParTransaction = new Map(); // ARActe renvoyé avec le statut 4 (l'API le fournit là, pas séparément)
  let cacheClassif = null; // { quand, valeur }

  // Adresse de l'instance : celle du paramétrage (par organisme) prime sur S2LOW_URL.
  const connexion = async (organismeId) => {
    if (!organismeId) return { url: cfg.url };
    try { const c = await settings.resolve(organismeId); return { url: c['tdt.s2low.url']?.value || cfg.url }; }
    catch { return { url: cfg.url }; }
  };
  const base = async (organismeId) => {
    const c = await connexion?.(organismeId).catch(() => null);
    const url = (c?.url || cfg.url || '').replace(/\/+$/, '');
    if (!url) throw E.conflict("Adresse de l'instance S²LOW absente (paramétrage Télétransmission ou S2LOW_URL)");
    if (!pfx) throw E.conflict('Certificat client S²LOW absent (S2LOW_P12_FILE) : la télétransmission réelle ne peut pas s’authentifier');
    return url;
  };
  const http = () => axios.create({ httpsAgent: agent, timeout: 60000, validateStatus: () => true, maxRedirects: 0, responseType: 'text', transformResponse: (x) => x });

  /** Appel texte simple (form-urlencoded), lève une erreur explicite si l'accès est refusé. */
  async function appel(organismeId, methode, chemin, params) {
    const url = await base(organismeId);
    const r = await http().request({ method: methode, url: url + chemin, data: params ? new URLSearchParams(params).toString() : undefined, headers: params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined });
    return { ...reponseTexte(r.data), status: r.status };
  }

  /** Récupère un fichier stocké (fileId → storage) pour l'attacher à l'appel. */
  async function fichier(fileId) {
    const f = await db.get('SELECT storage_key, original_name, mime FROM files WHERE id = $1', [fileId]);
    if (!f) throw E.conflict(`Pièce introuvable (fichier ${fileId})`);
    return { nom: f.original_name, mime: f.mime, buffer: await storage.get(f.storage_key) };
  }
  const mimeDe = (nom, mime) => mime || (String(nom).toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  return {
    mode: 'reel',

    async testConnexion(organismeId) {
      const url = await base(organismeId);
      const r = await http().get(url + '/api/test-connexion.php');
      const t = reponseTexte(r.data);
      return { ok: t.ok, message: t.ok ? `S²LOW joignable (${url})` : `S²LOW : ${t.reste.trim().split('\n')[0] || 'échec'}` };
    },

    /** Classification officielle : la demande est créée puis le fichier XML est récupéré et analysé. */
    async classification(organismeId) {
      if (cacheClassif && Date.now() - cacheClassif.quand < CLASSIFICATION_TTL_MS) return cacheClassif.valeur;
      try {
        await appel(organismeId, 'POST', '/modules/actes/actes_classification_request.php', { api: 1 });
        const url = await base(organismeId);
        const r = await http().get(url + '/modules/actes/actes_classification_fetch.php?api=1');
        const c = lireClassification(r.data);
        if (c.natures.length) { cacheClassif = { quand: Date.now(), valeur: c }; return c; }
        log?.warn?.('classification S²LOW illisible : listes de référence utilisées');
      } catch (e) { log?.warn?.({ err: e.message }, 'classification S²LOW indisponible : listes de référence utilisées'); }
      const valeur = { natures: NATURES.map(([code, label]) => ({ code, label })), typesPj: TYPES_PJ.map(([code, label]) => ({ code, label })) };
      cacheClassif = { quand: Date.now(), valeur };
      return valeur;
    },

    /** POST multipart actes_transac_create.php. Renvoie l'identifiant de transaction S²LOW. */
    async creer(p) {
      const url = await base(p.organismeId);
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
      const principal = await fichier(p.file.fileId);
      forme.set('acte_pdf_file', new Blob([principal.buffer], { type: mimeDe(principal.nom, principal.mime) }), principal.nom);
      for (const a of p.annexes || []) {
        const f = await fichier(a.fileId);
        forme.append('acte_attachments[]', new Blob([f.buffer], { type: mimeDe(a.name, a.mime) }), a.name);
        forme.append('type_pj[]', String(a.typePj || '99_AU'));
      }
      const r = await http().post(url + '/modules/actes/actes_transac_create.php', forme);
      const t = reponseTexte(r.data);
      if (!t.ok) return { ok: false, message: (t.lignes[1] || 'refus de S²LOW').trim() };
      return { ok: true, id: (t.lignes[1] || '').trim() };
    },

    /** Mode B : ordonne la télétransmission d'un acte « en attente d'être postée ». */
    async confirmer(remoteId, organismeId) {
      const t = await appel(organismeId, 'GET', `/modules/actes/actes_transac_post_confirm_api.php?id=${encodeURIComponent(remoteId)}&url_return=${encodeURIComponent('about:blank')}`);
      // l'API peut répondre « OK » ou rediriger vers url_return une fois la télétransmission ordonnée
      return t.ok || (t.status >= 300 && t.status < 400) ? { ok: true } : { ok: false, message: (t.lignes[1] || 'confirmation refusée').trim() };
    },

    /** Statut (et ARActe au statut 4) d'une transaction. */
    async statut(remoteId, organismeId) {
      let t;
      try { t = await appel(organismeId, 'GET', `/modules/actes/actes_transac_get_status.php?transaction=${encodeURIComponent(remoteId)}`); }
      catch (e) { log?.warn?.({ err: e.message, remoteId }, 'statut S²LOW indisponible'); return null; }
      if (!t.ok) return { remoteId, status: null, label: t.lignes[1] || 'Inconnu', message: t.lignes[1] || null, ar: null };
      const status = Number((t.lignes[1] || '').trim());
      const xml = t.lignes.slice(2).join('\n').trim();
      if (status === 4 && xml) {
        const at = (nom) => { const m = new RegExp(`\\b${nom}="([^"]*)"`).exec(xml); return m ? m[1] : null; };
        arParTransaction.set(String(remoteId), xml);
        return { remoteId, status, label: STATUS[status] || String(status), message: null, ar: { id: at('IDActe'), date: at('DateReception') } };
      }
      return { remoteId, status, label: STATUS[status] || String(status), message: status === -1 ? (t.lignes[2] || null) : null, ar: null };
    },

    /** Le XML de l'ARActe reçu lors du dernier statut. */
    async arActe(remoteId) { return arParTransaction.get(String(remoteId)) || null; },

    async annuler(remoteId, organismeId) {
      const t = await appel(organismeId, 'POST', '/modules/actes/actes_transac_cancel.php', { api: 1, id: remoteId });
      return t.ok ? { ok: true } : { ok: false, message: (t.lignes[1] || 'annulation refusée').trim() };
    },

    async documentsPrefecture(organismeId) {
      const url = await base(organismeId);
      const r = await http().get(url + '/modules/actes/api/list_document_prefecture.php');
      let liste; try { liste = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch { return []; }
      return (Array.isArray(liste) ? liste : []).map((d) => ({ id: String(d.id ?? d.transaction_id), remoteId: String(d.related_transaction ?? d.related_id ?? d.id), type: Number(d.type), titre: d.libelle || d.titre || `Document de la préfecture (${d.type})`, contenu: d.contenu || d.commentaire || '', date: d.date || d.created_at || null }));
    },

    async marquerLu(docId, organismeId) {
      await appel(organismeId, 'GET', `/modules/actes/api/document_prefecture_mark_as_read.php?transaction_id=${encodeURIComponent(docId)}`);
    },

    async repondre(remoteId, { typeEnvoie, message, fileId } = {}, organismeId) {
      const url = await base(organismeId);
      const forme = new FormData();
      forme.set('api', '1'); forme.set('id', String(remoteId)); forme.set('type_envoie', String(typeEnvoie));
      let nom = null;
      if (fileId) { const f = await fichier(fileId); nom = f.nom; forme.set('acte_pdf_file', new Blob([f.buffer], { type: mimeDe(f.nom, f.mime) }), f.nom); }
      const r = await http().post(url + '/modules/actes/actes_transac_reponse_create.php', forme);
      const t = reponseTexte(r.data);
      return t.ok ? { ok: true } : { ok: false, message: (t.lignes[1] || 'réponse refusée').trim() };
    },

    /** Bordereau d'acquittement (PDF). */
    async bordereau(remoteId, organismeId) {
      const url = await base(organismeId);
      const r = await http().get(url + `/modules/actes/actes_create_pdf.php?trans_id=${encodeURIComponent(remoteId)}`, { responseType: 'arraybuffer' });
      if (r.status !== 200 || !r.data?.byteLength) return null;
      return Buffer.from(r.data);
    },
  };
}

module.exports = { createS2lowHttp, reponseTexte, lireClassification, SCENARIOS };
