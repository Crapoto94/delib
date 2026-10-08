/**
 * Nourrit « Visas et références » à partir de l'HISTORIQUE des délibérations d'AIRS : lit le PDF « Délibération » de chaque délibération archivée (1 799 à ce jour,
 * 2018-2024) sur le partage de fichiers d'AIRS, en extrait les « vu … », et regroupe les références juridiques citées (code et article, loi, décret, arrêté) avec
 * le nombre de délibérations qui les citent.
 *
 *   node scripts/visas-depuis-airs.js                         analyse et écrit visas-candidats.json / .csv (essai : aucune écriture en base)
 *   node scripts/visas-depuis-airs.js --importer [--org 1]    crée en plus les entrées dans la bibliothèque de visas
 *   options : --min 2 (citations minimales)  --pages 8 (pages lues par PDF)  --limite N (n premiers PDF)  --share "\\serveur\partage"  --sortie nom
 *   node scripts/visas-depuis-airs.js --fichier a.pdf [b.pdf]  essai sur des PDF locaux (ni AIRS, ni base)
 *
 * Prérequis : accès à la base Oracle d'AIRS (.env.airs) ET partage de fichiers monté (« net use \\airsdelibv7\filesystem$ /user:DOMAINE\compte »,
 * ou Import AIRS › Fichiers › Tester l'accès). Ce script ne stocke AUCUN fichier : il ne lit que le texte et n'écrit en base que les entrées de bibliothèque.
 *
 * Rien n'est affirmé de mémoire (IA-05) : les entrées créées ne sont jamais « vérifiées » (verifie_le vide) ; le juridique les contrôle à la source, une par une.
 * Les entrées déjà présentes dans la bibliothèque ne sont jamais modifiées.
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { createAudit } = require('../src/modules/audit/audit.service');
const { normaliserCle } = require('../src/modules/ai/visas.service');
const V = require('../src/modules/ai/visas-historique');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const arg = (n, def = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const drapeau = (n) => process.argv.includes(`--${n}`);
const PAGES = Number(arg('pages', 8));
const MIN = Number(arg('min', 2));
const SHARE_DEFAUT = '\\\\airsdelibv7\\filesystem$';
let pdfjs = null;

/** Texte des premières pages d'un PDF (les visas sont en tête de délibération). */
async function texteDuPdf(buffer) {
  pdfjs = pdfjs || await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    let t = '';
    for (let i = 1; i <= Math.min(PAGES, doc.numPages); i++) { const p = await doc.getPage(i); t += ` ${(await p.getTextContent()).items.map((x) => x.str).join(' ')}`; p.cleanup(); }
    return t;
  } finally { await doc.destroy(); }
}

async function enParallele(liste, n, f) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < liste.length) { const k = i++; await f(liste[k], k); } }));
}

const csv = (c) => ['cle;type;intitule;delibs;premiere;derniere;exemple', ...c.map((e) => [e.cle, e.type, e.libelle, e.delibs, e.premiere ?? '', e.derniere ?? '', `"${e.exemple.replace(/"/g, '""')}"`].join(';'))].join('\n');

async function ecrireSorties(cumul, stats) {
  const cand = cumul.candidats({ min: MIN }); const nom = arg('sortie', 'visas-candidats');
  fs.writeFileSync(`${nom}.json`, JSON.stringify({ genereLe: new Date().toISOString(), min: MIN, stats, candidats: cand }, null, 2));
  fs.writeFileSync(`${nom}.csv`, `\uFEFF${csv(cand)}`);
  console.log(`\n${cumul.total} références distinctes, dont ${cand.length} citées dans au moins ${MIN} délibération(s) → ${nom}.json et ${nom}.csv`);
  for (const e of cand.slice(0, 12)) console.log(`  ${String(e.delibs).padStart(5)}  ${e.cle.padEnd(22)} ${e.libelle}`);
  return cand;
}

(async () => {
  // ---- essai sur des PDF locaux
  if (drapeau('fichier')) {
    const apres = process.argv.slice(process.argv.indexOf('--fichier') + 1); const fichiers = apres.slice(0, apres.findIndex((x) => x.startsWith('--')) === -1 ? undefined : apres.findIndex((x) => x.startsWith('--')));
    const cumul = V.creerCumul(); let lus = 0;
    for (const f of fichiers) {
      const refs = V.referencesDuTexte(await texteDuPdf(fs.readFileSync(f)));
      console.log(`${path.basename(f)} : ${refs.length} référence(s)${refs.length ? ` — ${refs.map((r) => r.cle).join(', ')}` : ''}`);
      cumul.ajouter(refs); lus++;
    }
    await ecrireSorties(cumul, { pdfLus: lus }); return;
  }

  const config = loadConfig(); const log = createLogger('warn');
  if (!config.airs.enabled) { console.error('AIRS non configuré : renseignez .env.airs (AIRS_ORACLE_HOST, _PORT, _SERVICE, _USER, _PASSWORD).'); process.exitCode = 2; return; }
  const db = createDb(config, log);
  let conn;
  try {
    // partage de fichiers : réglage de l'application (Import AIRS › Fichiers), sinon valeur par défaut ; --share l'emporte
    const r = await db.get("SELECT value FROM settings WHERE scope = 'organisme' AND key = 'airs.fichiers' ORDER BY scope_id LIMIT 1").catch(() => null);
    const share = arg('share') || r?.value?.share || SHARE_DEFAUT;
    // un partage réseau injoignable peut bloquer longtemps : on abandonne après 10 s
    try { await Promise.race([fs.promises.access(path.join(share, 'DEL_ARCHIVE')), new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), 10000))]); } catch {
      console.error(`Partage « ${share} » illisible. Montez-le d'abord :\n  net use "${share}" /user:DOMAINE\\compte\nou utilisez Import AIRS › Fichiers › Tester l'accès, puis relancez.`);
      process.exitCode = 2; return;
    }
    const oracledb = require('oracledb');
    conn = await oracledb.getConnection({ user: config.airs.user, password: config.airs.password, connectString: config.airs.connectString });
    // PDF « Délibération » (TFP 5) des délibérations archivées. L'année de la citation vient de l'horodatage du nom de fichier (« d1574868714633.pdf » = création, en ms).
    const q = await conn.execute(
      `SELECT f.FIC_CHEMIN_SERV AS CH, f.FIC_NOM AS NOM FROM AIRSUSER.FIC_PRIMAIRE f WHERE f.TFP_ID = 5 AND f.CTY_ID = 7 AND lower(f.FIC_NOM) LIKE '%.pdf' ORDER BY f.FIC_ID`,
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    await conn.close(); conn = null;
    const anneeDe = (nom) => { const m = /^d(\d{13})\./.exec(String(nom || '')); const a = m ? new Date(Number(m[1])).getUTCFullYear() : null; return a && a >= 2000 && a <= 2100 ? a : null; };
    let docs = q.rows.map((x) => ({ CH: x.CH, an: anneeDe(x.NOM) })); const limite = Number(arg('limite', 0)); if (limite > 0) docs = docs.slice(0, limite);
    console.log(`${docs.length} délibérations archivées (PDF « Délibération ») à analyser — partage : ${share}`);

    const rubriques = (await db.all("SELECT DISTINCT libelle FROM ref_items WHERE kind = 'rubrique' AND actif")).map((x) => x.libelle);
    const cumul = V.creerCumul(); const stats = { pdfTrouves: docs.length, lus: 0, sansVisa: 0, illisibles: 0, sansRubrique: 0 };
    await enParallele(docs, 4, async (d, k) => {
      try {
        const buf = await fs.promises.readFile(path.join(share, String(d.CH).replace(/^\//, '').split('/').join(path.sep)));
        const texte = await texteDuPdf(buf); const refs = V.referencesDuTexte(texte); const rub = V.rubriqueDuTexte(texte, rubriques);
        stats.lus++; if (!refs.length) stats.sansVisa++; if (!rub) stats.sansRubrique++;
        cumul.ajouter(refs, d.an, rub);
      } catch { stats.illisibles++; }
      if ((k + 1) % 100 === 0) process.stdout.write(`\r${k + 1}/${docs.length}  (${stats.illisibles} illisibles)   `);
    });
    const cand = await ecrireSorties(cumul, stats);
    console.log(`PDF lus : ${stats.lus} ; sans visa reconnu : ${stats.sansVisa} ; sans rubrique reconnue : ${stats.sansRubrique} ; illisibles : ${stats.illisibles}`);
    if (stats.lus < docs.length * 0.5) console.log('Attention : moins de la moitié des PDF ont pu être lus (partage ou droits ?). Vérifiez avant d\'importer.');

    // ---- création dans la bibliothèque (jamais vérifiée, jamais d'écrasement)
    if (!drapeau('importer')) { console.log('\nEssai terminé : rien n\'a été écrit en base. Relisez le fichier, puis relancez avec --importer.'); return; }
    const org = Number(arg('org')) || (await db.get('SELECT id FROM organismes WHERE is_default'))?.id;
    if (!org) throw new Error('Organisme introuvable (--org)');
    const audit = createAudit(db); let crees = 0; let existantes = 0; let rejetees = 0; let maj = 0;
    const annees = cand.flatMap((c) => [c.premiere, c.derniere]).filter(Boolean); const de = annees.length ? Math.min(...annees) : null; const a = annees.length ? Math.max(...annees) : null;
    await db.tx(async (t) => {
      for (const c of cand) {
        let cle; try { cle = normaliserCle(c.cle); } catch { rejetees++; continue; }
        const e = V.entreeBibliotheque({ ...c, cle }); const us = JSON.stringify(V.statsUsage(c, stats.lus));
        const res = await t.run(
          `INSERT INTO visa_library (organisme_id, cle, type, code, article, intitule, statut, source, note, created_by, citations, cite_de, cite_a, usage_stats) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'@historique',$10,$11,$12,$13::jsonb)
           ON CONFLICT (organisme_id, cle) DO NOTHING`, [org, e.cle, e.type, e.code, e.article, e.intitule, e.statut, e.source, e.note, c.delibs, c.premiere, c.derniere, us]);
        if (res.changes) crees++; else existantes++;
        // l'usage constaté (factuel) est rafraîchi pour toute entrée, y compris celles que le juridique a rédigées ; le reste de la fiche n'est jamais touché
        const m = await t.run('UPDATE visa_library SET citations = $3, cite_de = $4, cite_a = $5, usage_stats = $6::jsonb WHERE organisme_id = $1 AND cle = $2', [org, e.cle, c.delibs, c.premiere, c.derniere, us]);
        if (!res.changes && m.changes) maj++;
      }
      await t.run(`INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('organisme', $1, 'visas.historique', $2::jsonb, '@historique')
        ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [String(org), JSON.stringify({ total: stats.lus, de, a, le: new Date().toISOString() })]);
    }, { bypass: true });
    await audit.log({ username: '@historique' }, { organismeId: org, action: 'visa.import_historique', entity: 'visa_library', after: { crees, existantes, usageMisAJour: maj, rejetees, min: MIN, pdfLus: stats.lus } });
    console.log(`\nBibliothèque de visas : ${crees} entrée(s) créée(s), ${existantes} déjà présente(s) (fiche inchangée, usage constaté mis à jour), ${rejetees} rejetée(s). Les nouvelles sont « jamais vérifiées » : à contrôler par le juridique.`);
  } finally { if (conn) await conn.close().catch(() => {}); await db.close(); }
})().catch((e) => { console.error('ERREUR :', e.message); process.exitCode = 1; });
