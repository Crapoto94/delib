/**
 * Briques transverses : compteurs par organisme, stockage de fichiers (StoragePort local), contrôle des PDF,
 * bus d'événements interne. Chaque brique est petite et sans dépendance métier.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { E } = require('./errors');

/** Compteur atomique par (organisme, clé) : n° de suivi, numérotation… Ne réutilise jamais un numéro. */
async function nextCounter(runner, organismeId, key) {
  const r = await runner.get(
    `INSERT INTO counters (organisme_id, key, value) VALUES ($1, $2, 1)
     ON CONFLICT (organisme_id, key) DO UPDATE SET value = counters.value + 1 RETURNING value`, [organismeId, key]);
  return Number(r.value);
}

/** StoragePort — volume local hors du code. Les clés sont générées par le serveur (jamais fournies par l'utilisateur). */
function createStorage(config) {
  const root = config.storage.dir;
  const resolve = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw E.badRequest('Clé de stockage invalide');
    return full;
  };
  return {
    async put(buffer, { organismeId, ext = 'bin' }) {
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const d = new Date();
      const key = `${organismeId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${sha256.slice(0, 16)}-${crypto.randomBytes(4).toString('hex')}.${ext.replace(/[^a-z0-9]/gi, '')}`;
      const full = resolve(key);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, buffer, { flag: 'wx' });
      return { key, sha256, size: buffer.length };
    },
    get: (key) => fs.promises.readFile(resolve(key)),
    async remove(key) { await fs.promises.rm(resolve(key), { force: true }); },
    exists: (key) => fs.promises.access(resolve(key)).then(() => true, () => false),
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
