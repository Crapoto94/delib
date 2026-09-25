/**
 * Reclassement du stockage GED (GED-11). Le stockage applicatif était rangé par date d'import, avec des noms opaques
 * et sans métadonnées. Ce module calcule, à partir des données métier de VibeDélib, pour chaque fichier déjà déposé :
 * sa catégorie (reprise AIRS, annexes, convocations, ordres-du-jour, cahiers, parapheurs, contrôle de légalité,
 * gabarits, logos…), son nom lisible, son titre et une description riche (acte, séance, type, nature, matière,
 * rubrique, organisme, déposant). Les documents issus de la reprise AIRS (acte marqué `custom.airs`) sont regroupés
 * dans « Reprise AIRS », par année de séance. Le rattrapage DÉPLACE le nœud dans le bon dossier et met à jour ses
 * métadonnées — sans re-téléversement, car l'identifiant du nœud ne change pas. Idempotent : un fichier déjà classé
 * n'est pas retraité.
 */
/** Catégories de stockage → libellé du dossier dans la GED. */
const CATEGORIES = {
  'reprise-airs': 'Reprise AIRS',
  annexes: 'Annexes',
  'annexes-pdf': 'Annexes (PDF converti)',
  'pieces-seance': 'Pièces de séance',
  convocations: 'Convocations',
  'ordres-du-jour': 'Ordres du jour',
  cahiers: 'Cahiers de séance',
  parapheur: 'Parapheur',
  'controle-legalite': 'Contrôle de légalité',
  'documents-source': 'Documents source des actes',
  gabarits: 'Gabarits',
  logos: 'Logos',
  collecteurs: "Collecteurs d'arrêtés",
  divers: 'Divers',
};
const categorieLabel = (c) => CATEGORIES[String(c || 'divers')] || CATEGORIES.divers;

const sur = (x, max = 110) => Array.from(String(x || '').normalize('NFC'), (ch) => (ch.charCodeAt(0) < 32 ? '-' : ch)).join('')
  .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, max).trim() || 'fichier';
const anneeDe = (dateSeance, creeLe) => (jour(dateSeance) || jour(creeLe) || String(new Date().getFullYear())).slice(0, 4);
const jour = (d) => (d ? new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : null);

/** Requêtes de contexte : chaque fichier est rattaché à sa catégorie métier (priorité = ordre d'exécution). */
function requetes() {
  return [
    // annexes (fichier d'origine et PDF converti) rattachées à un acte
    { prio: 1, sql: `SELECT a.file_id AS fid, a.pdf_file_id AS pfid, a.titre AS piece, t.libelle AS type_acte, (ac.custom ? 'airs') AS airs,
        ac.numero_suivi, ac.titre AS acte_titre, r.libelle AS rubrique, m.libelle AS matiere, na.libelle AS nature,
        COALESCE(
          s.date_seance,
          (SELECT (rr.payload->>'date')::timestamptz FROM airs_raw_rows rr WHERE rr.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1),
          (SELECT (rs.payload->>'date')::timestamptz FROM airs_raw_rows ra JOIN airs_raw_rows rs ON rs.table_name = 'seances' AND rs.source_key = ra.payload->>'seance' WHERE ra.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1)
        ) AS date_seance,
        COALESCE(
          i.nom,
          (SELECT rr.payload->>'instance' FROM airs_raw_rows rr WHERE rr.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1),
          (SELECT rs.payload->>'instance' FROM airs_raw_rows ra JOIN airs_raw_rows rs ON rs.table_name = 'seances' AND rs.source_key = ra.payload->>'seance' WHERE ra.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1)
        ) AS instance
      FROM annexes a JOIN actes ac ON ac.id = a.acte_id
      LEFT JOIN ref_items t ON t.id = ac.type_id LEFT JOIN ref_items r ON r.id = ac.rubrique_id
      LEFT JOIN ref_items m ON m.id = ac.matiere_id LEFT JOIN ref_items na ON na.id = ac.nature_id
      LEFT JOIN seances s ON s.id = ac.seance_id LEFT JOIN instances i ON i.id = s.instance_id
      WHERE ac.organisme_id = $1`, cat: 'annexes', catPdf: 'annexes-pdf' },
    // versions historiques d'annexes (l'annexe pointée a été remplacée)
    { prio: 2, sql: `SELECT av.file_id AS fid, a.titre AS piece, t.libelle AS type_acte, (ac.custom ? 'airs') AS airs, ac.numero_suivi, ac.titre AS acte_titre,
        r.libelle AS rubrique, m.libelle AS matiere, na.libelle AS nature,
        COALESCE(
          s.date_seance,
          (SELECT (rr.payload->>'date')::timestamptz FROM airs_raw_rows rr WHERE rr.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1),
          (SELECT (rs.payload->>'date')::timestamptz FROM airs_raw_rows ra JOIN airs_raw_rows rs ON rs.table_name = 'seances' AND rs.source_key = ra.payload->>'seance' WHERE ra.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1)
        ) AS date_seance,
        COALESCE(
          i.nom,
          (SELECT rr.payload->>'instance' FROM airs_raw_rows rr WHERE rr.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1),
          (SELECT rs.payload->>'instance' FROM airs_raw_rows ra JOIN airs_raw_rows rs ON rs.table_name = 'seances' AND rs.source_key = ra.payload->>'seance' WHERE ra.source_key = ac.custom->'airs'->>'sourceKey' LIMIT 1)
        ) AS instance
      FROM annexe_versions av JOIN annexes a ON a.id = av.annexe_id JOIN actes ac ON ac.id = a.acte_id
      LEFT JOIN ref_items t ON t.id = ac.type_id LEFT JOIN ref_items r ON r.id = ac.rubrique_id
      LEFT JOIN ref_items m ON m.id = ac.matiere_id LEFT JOIN ref_items na ON na.id = ac.nature_id
      LEFT JOIN seances s ON s.id = ac.seance_id LEFT JOIN instances i ON i.id = s.instance_id
      WHERE ac.organisme_id = $1`, cat: 'annexes' },
    // convocations et ordres du jour
    { prio: 3, sql: `SELECT c.convocation_file_id AS fid, c.odj_file_id AS pfid, c.version_no, s.date_seance, i.nom AS instance
      FROM convocations c JOIN seances s ON s.id = c.seance_id LEFT JOIN instances i ON i.id = s.instance_id
      WHERE c.organisme_id = $1`, cat: 'convocations', catPdf: 'ordres-du-jour' },
    // cahiers de séance
    { prio: 4, sql: `SELECT cb.file_id AS fid, cb.profil, cb.version_no, s.date_seance, i.nom AS instance
      FROM cahier_builds cb JOIN seances s ON s.id = cb.seance_id LEFT JOIN instances i ON i.id = s.instance_id
      WHERE cb.organisme_id = $1`, cat: 'cahiers' },
    // contrôle de légalité (bordereau transmis, accusé de réception)
    { prio: 5, sql: `SELECT t.file_id AS fid, t.ar_file_id AS pfid, t.numero_transmis, s.date_seance
      FROM tlt_transactions t LEFT JOIN seances s ON s.id = t.seance_id WHERE t.organisme_id = $1`, cat: 'controle-legalite' },
    // parapheur (document signé)
    { prio: 6, sql: `SELECT pe.document_signe_file_id AS fid, ac.numero_suivi, ac.titre AS acte_titre, s.date_seance
      FROM parapheur_envois pe LEFT JOIN actes ac ON ac.id = pe.acte_id LEFT JOIN seances s ON s.id = ac.seance_id
      WHERE pe.organisme_id = $1`, cat: 'parapheur' },
    // documents source des actes (original Word/PDF + PDF de consultation)
    { prio: 7, sql: `SELECT ac.document_source_file_id AS fid, ac.document_source_pdf_file_id AS pfid, ac.numero_suivi, ac.titre AS acte_titre, s.date_seance
      FROM actes ac LEFT JOIN seances s ON s.id = ac.seance_id
      WHERE ac.organisme_id = $1 AND (ac.document_source_file_id IS NOT NULL OR ac.document_source_pdf_file_id IS NOT NULL)`, cat: 'documents-source' },
    // gabarits (modèle Word, fonds de page)
    { prio: 8, sql: `SELECT docx_file_id AS fid, bg_first_file_id AS pfid, bg_next_file_id AS fb, doc_type
      FROM render_templates WHERE organisme_id = $1`, cat: 'gabarits', extra: ['fb'] },
    // pièces jointes d'un point libre de séance
    { prio: 9, sql: `SELECT sif.file_id AS fid, sif.titre AS piece, s.date_seance, i.nom AS instance
      FROM seance_item_fichiers sif JOIN seance_items it ON it.id = sif.item_id JOIN seances s ON s.id = it.seance_id
      LEFT JOIN instances i ON i.id = s.instance_id WHERE it.organisme_id = $1`, cat: 'pieces-seance' },
  ];
}

function decrire(c) {
  const l = [];
  if (c.type_acte) l.push(`Type d'acte : ${c.type_acte}`);
  if (c.numero_suivi) l.push(`Acte : ${c.numero_suivi}${c.acte_titre ? ` — ${c.acte_titre}` : ''}`);
  if (c.nature) l.push(`Nature : ${c.nature}`);
  if (c.matiere) l.push(`Matière : ${c.matiere}`);
  if (c.rubrique) l.push(`Rubrique : ${c.rubrique}`);
  if (c.date_seance) l.push(`Séance : ${jour(c.date_seance)}${c.instance ? ` (${c.instance})` : ''}`);
  if (c.profil) l.push(`Profil : ${c.profil}`);
  if (c.version_no) l.push(`Version : ${c.version_no}`);
  if (c.numero_transmis) l.push(`Transmis : ${c.numero_transmis}`);
  if (c.doc_type) l.push(`Gabarit : ${c.doc_type}`);
  if (c.original_name) l.push(`Fichier d'origine : ${c.original_name}`);
  if (c.created_by) l.push(`Déposé par : ${c.created_by}`);
  return l.join('\n');
}

/** Construit la table des métadonnées pour un organisme : fileId → { categorie, annee, nom, titre, description }. */
async function planifier(db, organismeId) {
  const org = Number(organismeId);
  const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
  const contexte = new Map();
  const poser = (fid, cat, m, extra = {}) => {
    if (!fid || contexte.has(fid)) return;
    contexte.set(fid, { categorie: cat, ...m, ...extra });
  };
  for (const r of requetes()) {
    const rows = await db.all(r.sql, [org]);
    for (const row of rows) {
      const cat = row.airs ? 'reprise-airs' : r.cat;
      poser(row.fid, cat, row);
      if (row.pfid) poser(row.pfid, row.airs ? 'reprise-airs' : (r.catPdf || r.cat), row);
      if (r.extra) for (const col of r.extra) poser(row[col], r.cat, row);
    }
  }
  const files = await db.all("SELECT id, storage_key, original_name, sha256, created_at, created_by, categorie AS cat_actuelle, ged_nom FROM files WHERE organisme_id = $1 AND storage_key LIKE 'alf:%' ORDER BY id", [org]);
  const plan = [];
  for (const f of files) {
    const c = contexte.get(f.id) || {};
    const cat = c.categorie || f.cat_actuelle || 'divers';
    const d = jour(c.date_seance) || (cat === 'reprise-airs' ? null : jour(f.created_at));
    const annee = c.date_seance ? String(jour(c.date_seance)).slice(0, 4) : (cat === 'reprise-airs' ? 'sans date' : anneeDe(null, f.created_at));
    const ext = (String(f.original_name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'bin').toLowerCase();
    const base = sur(c.piece || String(f.original_name || '').replace(/\.[^.]+$/, '') || 'fichier', 90);
    const nom = `${d ? `${d}_` : ''}${base}_${String(f.sha256 || '').slice(0, 8)}-${f.id}.${ext}`;
    const titre = sur(c.piece || String(f.original_name || '').replace(/\.[^.]+$/, ''), 200) || nom;
    const description = [categorieLabel(cat), orgRow?.nom ? `Organisme : ${orgRow.nom}` : null, decrire({ ...c, original_name: f.original_name, created_by: f.created_by })].filter(Boolean).join('\n');
    plan.push({ fileId: f.id, tracked: true, storageKey: f.storage_key, nodeId: String(f.storage_key).split(':')[2], categorie: cat, annee, nom, titre, description, deja: f.cat_actuelle === cat && f.ged_nom === nom });
  }
  return plan;
}

/** Logo de chaque organisme (hors table `files`) : clé de stockage directe sur `organismes.logo_path`. */
async function logos(db, organismeId) {
  const rows = await db.all("SELECT id, nom, logo_path, logo_sha256 FROM organismes WHERE id = $1 AND logo_path LIKE 'alf:%'", [Number(organismeId)]);
  return rows.map((o) => ({
    fileId: null, tracked: false, storageKey: o.logo_path, nodeId: String(o.logo_path).split(':')[2], categorie: 'logos',
    annee: String(new Date().getFullYear()), nom: `logo_${sur(o.nom, 60)}_${String(o.logo_sha256 || '').slice(0, 8)}.png`,
    titre: `Logo — ${o.nom}`, description: `Logos\nOrganisme : ${o.nom}`, deja: false,
  }));
}

/**
 * Exécute (ou simule) le reclassement : déplace les nœuds par catégorie, renomme et pose les métadonnées.
 * `appliquer=false` (défaut) n'écrit rien : renvoie le plan et la répartition par catégorie.
 */
async function reclasser({ db, log, ged, organismeId, appliquer = false, limite = 0 }) {
  const org = Number(organismeId);
  const cible = await ged.cibleStockage(org);
  if (!cible) throw new Error("Le stockage Alfresco n'est pas actif : renseignez Paramétrages / GED (mode Alfresco, actif, stockage Alfresco)");
  const plan = [...(await planifier(db, org)), ...(await logos(db, org))];
  // les fichiers suivis en base (`files`) déjà classés ne sont pas retraités ; pour les autres (logo), on
  // interroge la GED : un nœud déjà dans son dossier de catégorie, sous son nom lisible, est laissé tel quel.
  for (const x of plan) {
    if (x.deja || x.tracked || typeof cible.ad.nodeInfo !== 'function') continue;
    try {
      const info = await cible.ad.nodeInfo(cible.cfg, x.nodeId);
      if (info && info.nom === x.nom) x.deja = true; // déjà renommé : le nom lisible est la marque du classement
    } catch { /* GED momentanément injoignable : on tentera le reclassement */ }
  }
  const aFaire = plan.filter((x) => !x.deja);
  const liste = limite > 0 ? aFaire.slice(0, limite) : aFaire;
  const parCategorie = {};
  for (const x of liste) parCategorie[x.categorie] = (parCategorie[x.categorie] || 0) + 1;
  const parAnnee = {};
  for (const x of liste.filter((v) => v.categorie === 'reprise-airs')) parAnnee[x.annee] = (parAnnee[x.annee] || 0) + 1;
  if (!appliquer) return { simule: true, restant: aFaire.length, total: plan.length, parCategorie, parAnnee, exemple: liste.slice(0, 15).map((x) => ({ fileId: x.fileId, categorie: x.categorie, annee: x.annee, nom: x.nom, titre: x.titre })) };

  const out = { restantAvant: aFaire.length, total: plan.length, deplaces: 0, renommes: 0, ignores: plan.length - aFaire.length, erreurs: [], parCategorie };
  for (const x of liste) {
    try {
      const dossierId = await ged.dossierCategorie(org, cible, x.categorie, x.annee);
      await cible.ad.deplacer(cible.cfg, x.nodeId, dossierId);
      out.deplaces++;
      await cible.ad.majNode(cible.cfg, x.nodeId, { name: x.nom, titre: x.titre, description: x.description });
      out.renommes++;
      if (x.fileId) await db.run('UPDATE files SET categorie = $2, ged_nom = $3 WHERE id = $1', [x.fileId, x.categorie, x.nom]);
    } catch (e) {
      out.erreurs.push({ fileId: x.fileId, nodeId: x.nodeId, categorie: x.categorie, erreur: String(e.message).slice(0, 200) });
      if (out.erreurs.length <= 5) log?.warn?.({ fileId: x.fileId, err: e.message }, 'reclassement GED : échec (rejouable)');
    }
  }
  return out;
}

module.exports = { CATEGORIES, categorieLabel, planifier, logos, reclasser, sur, anneeDe };
