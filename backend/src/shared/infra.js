/**
 * Briques transverses : compteurs par organisme, stockage de fichiers (StoragePort local), contrôle des PDF,
 * bus d'événements interne. Chaque brique est petite et sans dépendance métier.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { E } = require('./errors');

/** Compteur atomique par (organisme, clé) : n° de suivi, numérotation… Ne réutilise jamais un numéro. `plancher` = plus grand numéro déjà utilisé ailleurs (ex. import AIRS), pour ne jamais entrer en collision. */
async function nextCounter(runner, organismeId, key, { plancher = 0 } = {}) {
  const r = await runner.get(
    `INSERT INTO counters (organisme_id, key, value) VALUES ($1, $2, GREATEST(1, $3::int + 1))
     ON CONFLICT (organisme_id, key) DO UPDATE SET value = GREATEST(counters.value + 1, $3::int + 1) RETURNING value`, [organismeId, key, plancher]);
  return Number(r.value);
}

/**
 * StoragePort — volume local OU Alfresco, au choix de chaque organisme (GED-09, D95).
 * La clé dit où est le fichier : « <organisme>/<catégorie>/<année>/<mois>/… » (volume local) ou « alf:<organisme>:<nœud> »
 * (Alfresco) ; les deux coexistent. Les clés sont générées par le serveur (jamais fournies par l'utilisateur).
 * Le backend Alfresco est branché après coup (`attach`) : il dépend de la configuration GED, qui elle-même dépend du
 * stockage. Pas de repli silencieux : si Alfresco est choisi et injoignable, `put` échoue.
 */
const ALF = /^alf:(\d+):([0-9a-fA-F-]{8,64})$/;
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function createStorage(config) {
  const root = config.storage.dir;
  const cacheDir = path.join(root, '.cache-alfresco');
  let alf = null; // { cible(orgId) -> { cfg, ad } | null, dossier(orgId, cible) -> id de dossier, ad(orgId) -> { cfg, ad } | null }
  const resolve = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw E.badRequest('Clé de stockage invalide');
    return full;
  };
  const cacheFile = (nodeId) => path.join(cacheDir, nodeId);

  const extSûre = (ext) => String(ext || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  const categorieSûre = (c) => String(c || 'divers').normalize('NFC').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'divers';
  /** Nom déposé dans la GED : nom lisible fourni + suffixe court (empreinte) pour rester unique, sinon nom opaque. */
  const nomGed = (fourni, sha256, ext) => {
    // eslint-disable-next-line no-control-regex
    const base = String(fourni || '').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim();
    const sansExt = base.replace(/\.[^.]+$/, '').slice(0, 100).trim();
    return `${sansExt ? `${sansExt}_` : ''}${sha256.slice(0, 8)}.${extSûre(ext)}`;
  };

  const local = {
    async put(buffer, { organismeId, ext = 'bin', categorie = 'divers' }) {
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const d = new Date();
      const key = `${organismeId}/${categorieSûre(categorie)}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${sha256.slice(0, 16)}-${crypto.randomBytes(4).toString('hex')}.${extSûre(ext)}`;
      const full = resolve(key);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, buffer, { flag: 'wx' });
      return { key, sha256, size: buffer.length };
    },
    get: (key) => fs.promises.readFile(resolve(key)),
    async remove(key) { await fs.promises.rm(resolve(key), { force: true }); },
    exists: (key) => fs.promises.access(resolve(key)).then(() => true, () => false),
  };

  return {
    /** Branche le backend Alfresco (appelé une fois par le conteneur, une fois la GED construite). */
    attach(backend) { alf = backend; },
    isAlfresco: (key) => ALF.test(String(key)),
    local,

    /**
     * Dépose un fichier. `opts` : `categorie` métier (organise l'arborescence GED), `nom` lisible, `titre` (cm:title),
     * `description` (cm:description) et `auteur`. Le nom déposé reste unique (suffixe d'empreinte) : un titre identique
     * n'écrase pas le précédent. Sans `nom`, le nom reste opaque (compatibilité).
     */
    async put(buffer, { organismeId, ext = 'bin', categorie = 'divers', nom, titre, description, auteur } = {}) {
      const cible = alf && organismeId ? await alf.cible(organismeId) : null;
      if (!cible) return local.put(buffer, { organismeId, ext, categorie });
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const nomDepot = nomGed(nom, sha256, ext);
      const dossierId = await alf.dossier(organismeId, cible, categorie);
      const r = await cible.ad.deposer(cible.cfg, dossierId, { nom: nomDepot, buffer, mime: MIME[extSûre(ext)] || 'application/octet-stream', titre, description: description || `Fichier de VibeDélib — ${categorie}`, auteur });
      try { await fs.promises.mkdir(cacheDir, { recursive: true }); await fs.promises.writeFile(cacheFile(r.nodeId), buffer); } catch { /* le cache est facultatif */ }
      return { key: `alf:${organismeId}:${r.nodeId}`, sha256, size: buffer.length };
    },

    async get(key) {
      const m = ALF.exec(String(key));
      if (!m) return local.get(key);
      try { return await fs.promises.readFile(cacheFile(m[2])); } catch { /* pas en cache : lecture en GED */ }
      const c = alf ? await alf.ad(Number(m[1])) : null;
      if (!c) throw E.conflict('Ce fichier est stocké dans la GED, dont la configuration n\'est plus active');
      const b = await c.ad.contenu(c.cfg, m[2]);
      if (!b) throw E.notFound('Fichier introuvable dans la GED');
      try { await fs.promises.mkdir(cacheDir, { recursive: true }); await fs.promises.writeFile(cacheFile(m[2]), b); } catch { /* facultatif */ }
      return b;
    },

    async remove(key) {
      const m = ALF.exec(String(key));
      if (!m) return local.remove(key);
      await fs.promises.rm(cacheFile(m[2]), { force: true });
      const c = alf ? await alf.ad(Number(m[1])) : null;
      if (c) await c.ad.supprimer(c.cfg, m[2]);
    },

    async exists(key) {
      const m = ALF.exec(String(key));
      if (!m) return local.exists(key);
      if (await fs.promises.access(cacheFile(m[2])).then(() => true, () => false)) return true;
      const c = alf ? await alf.ad(Number(m[1])) : null;
      return c ? c.ad.existe(c.cfg, m[2]) : false;
    },
  };
}

const FORBIDDEN_PDF_TOKENS = ['/JavaScript', '/JS ', '/JS(', '/EmbeddedFile', '/Launch', '/OpenAction'];

/** Contrôle d'un PDF déposé : signature %PDF (pas seulement l'extension), non chiffré, sans contenu actif, nombre de pages. */
async function inspectPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw E.badRequest("Le fichier n'est pas un PDF (signature %PDF absente)");
  const raw = buffer.toString('latin1');
  const bad = FORBIDDEN_PDF_TOKENS.find((t) => raw.includes(t));
  if (bad) throw E.badRequest(`PDF refusé : contenu actif ou pièce jointe intégrée (${bad.trim()})`);
  try {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    const pages = doc.getPageCount();
    if (pages < 1) throw new Error('vide');
    const first = doc.getPage(0).getSize();
    return { pages, width: first.width, height: first.height };
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw E.badRequest('PDF refusé : protégé par mot de passe');
    throw E.badRequest(`PDF illisible ou corrompu (${e.message})`);
  }
}

/** Bus d'événements interne : les abonnés (notifications, recherche…) ne font jamais échouer la requête. */
function createBus(log) {
  const handlers = new Map();
  return {
    on(type, fn) { (handlers.get(type) || handlers.set(type, []).get(type)).push(fn); },
    async emit(type, payload = {}) {
      for (const fn of [...(handlers.get(type) || []), ...(handlers.get('*') || [])]) {
        try { await fn(payload, { type }); } catch (e) { log.error({ err: e.message, type }, "abonné d'événement en erreur"); }
      }
    },
  };
}

module.exports = { nextCounter, createStorage, inspectPdf, createBus };
