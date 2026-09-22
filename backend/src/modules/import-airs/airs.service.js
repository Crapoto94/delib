/**
 * Import de l'historique AIRS DELIB (section 25 bis, D111, IMP-01 à IMP-20).
 *
 * Trois zones : le SAS (`airs_*`, lignes brutes en JSONB), les CONCORDANCES (valeur AIRS -> entité VibeDélib, validées
 * par l'admin/SCC) et la PUBLICATION (actes historiques). Tant que le MCD d'AIRS n'est pas connu, tout passe par un
 * mapping déclaratif (`airs_source_tables`) : brancher une table AIRS est de la configuration, jamais du code.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { convertirEnPdf, EXT_CONVERTIBLES } = require('../../shared/convert');

const ETATS = ['a_faire', 'proposee', 'automatique', 'manuelle', 'ignoree'];
const REF_KINDS = { type_acte: 'type_acte', nature: 'nature', rubrique: 'rubrique', matiere: 'matiere' };
const BLOQUANTS = []; // direction/service ne bloquent plus l'import : enregistrés tels quels s'ils ne sont pas rapprochés (reprise historique)
// Types de conseil (séance) proposés à la concordance : le « type » d'une séance n'est jamais un type d'acte.
const TYPES_SEANCE = ['ordinaire', 'extraordinaire', 'budgetaire', 'autre'];
const LIBELLES_SEANCE = { ordinaire: 'Ordinaire', extraordinaire: 'Extraordinaire', budgetaire: 'Budgétaire', autre: 'Autre' };
// champ canonique -> axe de concordance
const CHAMP_AXE = { type: 'type_acte', nature: 'nature', rubrique: 'rubrique', matiere: 'matiere', direction: 'direction', service: 'service', redacteur: 'agent', rapporteur: 'elu', rapporteur_compl: 'elu', instance: 'instance', commission: 'commission' };
const AXES = ['organisme', 'instance', 'type_seance', 'direction', 'service', 'agent', 'elu', 'commission', 'type_acte', 'nature', 'rubrique', 'matiere'];
const CANON = ['numero', 'sous_numero', 'num_suivi', 'num_chrono', 'rap_id', 'origine', 'titre', 'objet', 'type', 'type_seance', 'nature', 'rubrique', 'matiere', 'direction', 'service', 'redacteur', 'redacteur_nom', 'rapporteur', 'rapporteur_compl', 'resultat', 'date', 'expose', 'considere', 'visas', 'dispositif', 'seance', 'instance', 'lieu', 'commission', 'incidence_financiere', 'montant'];

// Catalogue de départ aligné sur le MCD d'AIRS Delib (voir `airs_mcd.md`) : `seances` et `actes` reçoivent
// les lignes extraites de la base Oracle ; `rapports` reste disponible pour un export JSON du HUB DSI.
const DEFAULT_MAPPING = [
  { table_name: 'seances', libelle: 'Séances AIRS', entite_cible: 'seance', cle_colonne: 'id', ordre: 1, colonnes: [{ source: 'id', cible: 'id_source' }, { source: 'instance', cible: 'instance' }, { source: 'type_seance', cible: 'type_seance' }, { source: 'date', cible: 'date' }, { source: 'lieu', cible: 'lieu' }, { source: 'titre', cible: 'titre' }, { source: 'numero', cible: 'numero' }] },
  { table_name: 'rapports', libelle: 'Rapports / dossiers AIRS', entite_cible: 'acte', cle_colonne: 'id', ordre: 2, colonnes: [{ source: 'id', cible: 'numero' }, { source: 'objet', cible: 'titre' }, { source: 'seance', cible: 'seance' }, { source: 'type', cible: 'type' }, { source: 'nature', cible: 'nature' }, { source: 'rubrique', cible: 'rubrique' }, { source: 'matiere', cible: 'matiere' }, { source: 'direction', cible: 'direction' }, { source: 'service', cible: 'service' }, { source: 'redacteur', cible: 'redacteur' }, { source: 'rapporteur', cible: 'rapporteur' }, { source: 'resultat', cible: 'resultat' }, { source: 'expose', cible: 'expose' }, { source: 'considere', cible: 'considere' }, { source: 'dispositif', cible: 'dispositif' }] },
  { table_name: 'actes', libelle: 'Actes AIRS (séances passées)', entite_cible: 'acte', cle_colonne: 'id', ordre: 3, colonnes: [{ source: 'titre', cible: 'titre' }, { source: 'numero', cible: 'numero' }, { source: 'num_suivi', cible: 'num_suivi' }, { source: 'num_chrono', cible: 'num_chrono' }, { source: 'type', cible: 'type' }, { source: 'nature', cible: 'nature' }, { source: 'matiere', cible: 'matiere' }, { source: 'rubrique', cible: 'rubrique' }, { source: 'direction', cible: 'direction' }, { source: 'service', cible: 'service' }, { source: 'redacteur', cible: 'redacteur' }, { source: 'redacteur_nom', cible: 'redacteur_nom' }, { source: 'rapporteur', cible: 'rapporteur' }, { source: 'resultat', cible: 'resultat' }, { source: 'date', cible: 'date' }, { source: 'seance', cible: 'seance' }, { source: 'commission', cible: 'commission' }, { source: 'instance', cible: 'instance' }, { source: 'incidence_financiere', cible: 'incidence_financiere' }, { source: 'montant', cible: 'montant' }] },
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const str = (v) => (v === null || v === undefined ? '' : String(v));
const slug = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 60);
/** Retire une civilité en tête (« Monsieur », « Madame », « M. »…) : l'annuaire n'en porte pas. */
const sansCivilite = (s) => str(s).replace(/^(monsieur|madame|mademoiselle|mme|mlle|mr|m)\b[.\s-]*/i, '').trim();
/** Code d'une direction/service AIRS : la partie après le dernier « - » (« Service X - BB2 » → « BB2 »). */
const codeDepuis = (v) => { const s = str(v).trim(); const parts = s.split(/\s[-–—]\s/); return parts.length > 1 ? parts.pop().trim() : null; };
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex');

/**
 * Rapproche une valeur AIRS (libellé libre, ex. « Service Conseil et Contentieux - BB2 ») d'un code VibeDélib.
 * Le code passe avant le libellé. Pour une **direction**, le code est privé de ses chiffres (BF1 → BF) ; pour un
 * **service**, le code est pris tel quel (BF1). La confiance ≥ 0,99 vaut « automatique ».
 */
function rapprocher(valeur, candidats, axe = '') {
  const n = norm(valeur); if (!n) return null;
  const cle = axe === 'direction' ? (x) => norm(x).replace(/[0-9]/g, '') : (x) => norm(x);
  const apres = String(valeur).split(/\s[-–—]\s/).pop().trim();
  const jetons = new Set(String(valeur).split(/[^A-Za-z0-9]+/).filter(Boolean).map(cle));
  const parCode = (f) => candidats.find((c) => c.code && f(cle(c.code)));
  const hit = parCode((c) => c === cle(valeur)) || (apres !== String(valeur) ? parCode((c) => c === cle(apres)) : null) || parCode((c) => jetons.has(c));
  if (hit) return { cibleCode: hit.code, cibleLibelle: hit.label, confiance: 0.95 };
  const exact = candidats.find((c) => c.label && norm(c.label) === n);
  if (exact) return { cibleCode: exact.code, cibleLibelle: exact.label, confiance: 0.9 };
  const contenu = candidats.filter((c) => c.label && (n.includes(norm(c.label)) || norm(c.label).includes(n))).sort((a, b) => norm(b.label).length - norm(a.label).length)[0];
  return contenu ? { cibleCode: contenu.code, cibleLibelle: contenu.label, confiance: 0.8 } : null;
}

function createAirs({ db, audit, dir, source, ad, storage }) {
  const svc = {};

  // --------------------------------------------------------------------------------------------------------- mapping
  /** Complète le mapping de l'organisme avec les tables par défaut manquantes (ex. `actes` ajouté après coup). */
  async function ensureMapping(org) {
    const existantes = new Set((await db.all('SELECT table_name FROM airs_source_tables WHERE organisme_id = $1', [org])).map((r) => r.table_name));
    for (const m of DEFAULT_MAPPING) {
      if (existantes.has(m.table_name)) continue;
      await db.run(
        `INSERT INTO airs_source_tables (organisme_id, table_name, libelle, entite_cible, cle_colonne, colonnes, ordre) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (COALESCE(organisme_id, 0), table_name) DO NOTHING`,
        [org, m.table_name, m.libelle, m.entite_cible, m.cle_colonne, JSON.stringify(m.colonnes), m.ordre]);
    }
    return db.all('SELECT * FROM airs_source_tables WHERE organisme_id = $1 ORDER BY ordre, table_name', [org]);
  }
  async function getMapping(ctx, org) { return { items: await ensureMapping(requireOrg(org)) }; }

  async function setMapping(ctx, org, items) {
    const o = requireOrg(org);
    for (const m of items || []) {
      if (!/^[a-z0-9_]{2,64}$/.test(m.tableName || '')) continue;
      await db.run(
        `INSERT INTO airs_source_tables (organisme_id, table_name, libelle, entite_cible, cle_colonne, colonnes, obligatoire, ordre, actif)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         ON CONFLICT (COALESCE(organisme_id, 0), table_name) DO UPDATE SET libelle = EXCLUDED.libelle, entite_cible = EXCLUDED.entite_cible,
           cle_colonne = EXCLUDED.cle_colonne, colonnes = EXCLUDED.colonnes, obligatoire = EXCLUDED.obligatoire, ordre = EXCLUDED.ordre, actif = EXCLUDED.actif,
           valide = false, valide_par = NULL, valide_at = NULL`,
        [o, m.tableName, m.libelle || m.tableName, m.entiteCible || 'brut', m.cleColonne || 'id', JSON.stringify(m.colonnes || []), !!m.obligatoire, Number(m.ordre) || 0, m.actif !== false]);
    }
    await audit.log(ctx, { organismeId: o, action: 'airs.mapping', entity: 'airs_source_tables' });
    return getMapping(ctx, o);
  }

  // --------------------------------------------------------------------------- tables source (validation)
  /** Liste des tables source avec leur état de validation (aucune table non validée n'est importée). */
  async function tablesSource(ctx, org) {
    const o = requireOrg(org);
    const items = await ensureMapping(o);
    return {
      items: items.map((m) => ({
        tableName: m.table_name, libelle: m.libelle, entiteCible: m.entite_cible, cleColonne: m.cle_colonne,
        actif: m.actif, valide: m.valide, validePar: m.valide_par, valideAt: m.valide_at, colonnes: m.colonnes,
        supportee: !(source && source.tablesSupportees) || source.tablesSupportees.includes(m.table_name),
      })),
    };
  }

  /** Aperçu en lecture seule d'une table source : données brutes + transposition canonique, pour validation. */
  async function apercuTable(ctx, org, tableName, { limite = 10 } = {}) {
    const o = requireOrg(org);
    const m = (await ensureMapping(o)).find((x) => x.table_name === tableName);
    if (!m) throw E.notFound(`Table source inconnue : ${tableName}`);
    const disponible = !!(source && source.configuree && source.configuree() && typeof source.apercu === 'function');
    const base = { tableName, libelle: m.libelle, entiteCible: m.entite_cible, valide: m.valide, colonnes: m.colonnes || [] };
    if (source && source.tablesSupportees && !source.tablesSupportees.includes(tableName)) return { ...base, apercu: [], message: "Aperçu Oracle non applicable : cette table sert à un export JSON du HUB (l'import Oracle lit « seances » et « actes »)." };
    if (!disponible) return { ...base, apercu: [], message: "Aperçu indisponible : source Oracle non configurée ou non joignable." };
    let rows;
    try { rows = await source.apercu(tableName, Math.min(Math.max(Number(limite) || 10, 1), 50)); }
    catch (e) { return { ...base, apercu: [], message: `Aperçu indisponible pour cette table : ${e.message}` }; }
    let nbLignes = null;
    if (typeof source.compter === 'function') { try { nbLignes = await source.compter(tableName); } catch { nbLignes = null; } }
    await db.run(`UPDATE airs_source_tables SET apercu_at = now() WHERE organisme_id = $1 AND table_name = $2`, [o, tableName]);
    return { ...base, nbLignes, apercu: rows.map((r) => ({ brut: r, transpose: canonise(r, m) })) };
  }

  /** Valide (ou invalide) une table source : condition nécessaire à son import. N'écrit jamais le paramétrage. */
  async function validerTable(ctx, org, tableName, { valide = true } = {}) {
    const o = requireOrg(org);
    const m = (await ensureMapping(o)).find((x) => x.table_name === tableName);
    if (!m) throw E.notFound(`Table source inconnue : ${tableName}`);
    await db.run(`UPDATE airs_source_tables SET valide = $3, valide_par = $4, valide_at = now() WHERE organisme_id = $1 AND table_name = $2`,
      [o, tableName, !!valide, ctx.username]);
    await audit.log(ctx, { organismeId: o, action: valide ? 'airs.table.validee' : 'airs.table.invalidee', entity: 'airs_source_tables', after: { table: tableName, valide: !!valide } });
    return (await tablesSource(ctx, o)).items.find((x) => x.tableName === tableName);
  }

  // ------------------------------------------------------------------------------------------------------------- lots
  const toLot = (r) => r && ({ id: r.id, label: r.label, sourceKind: r.source_kind, mode: r.mode, statut: r.statut, inventaire: r.inventaire, meta: r.meta, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

  async function creerLot(ctx, org, { label, sourceKind = 'json', mode = 'passes' }) {
    const o = requireOrg(org);
    await ensureMapping(o);
    if (!label || !str(label).trim()) throw E.badRequest('Libellé du lot requis');
    if (!['json', 'tables'].includes(sourceKind)) throw E.badRequest('Source inconnue : json ou tables');
    if (!['passes', 'preparation'].includes(mode)) throw E.badRequest('Mode inconnu : passes ou preparation');
    const r = await db.get(`INSERT INTO airs_imports (organisme_id, label, source_kind, mode, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [o, str(label).trim().slice(0, 200), sourceKind, mode, ctx.username]);
    await event(o, r.id, ctx.username, 'lot.cree', { label: r.label, sourceKind, mode });
    return toLot(r);
  }

  async function lister(ctx, org) {
    const o = requireOrg(org);
    await ensureMapping(o);
    const lots = await db.all(`SELECT * FROM airs_imports WHERE organisme_id = $1 ORDER BY id DESC LIMIT 100`, [o]);
    const items = [];
    for (const l of lots) {
      const c = await db.get(`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE kind = 'acte')::int AS actes,
        count(*) FILTER (WHERE statut = 'publie')::int AS publies FROM airs_import_items WHERE import_id = $1`, [l.id]);
      items.push({ ...toLot(l), items: c });
    }
    return { items, axes: AXES.map((a) => ({ code: a })), bloquants: BLOQUANTS };
  }

  async function charger(ctx, org, importId, { data }) {
    const o = requireOrg(org); const lot = await lotDe(o, importId);
    if (lot.statut === 'annule') throw E.conflict('Lot annulé');
    if (lot.statut === 'publie') throw E.conflict('Lot déjà publié : créez un nouveau lot');
    if (!data || typeof data !== 'object') throw E.badRequest('Données manquantes (objet { table: [lignes] })');
    return persistRows(ctx, o, importId, data, 'json');
  }

  /** État de la source Oracle AIRS (configuration + joignabilité), sans divulguer de secret. */
  async function etatSource() {
    const cible = source?.cible?.() ?? null;
    if (!source || !source.configuree || !source.configuree()) {
      return { configuree: false, joignable: false, cible, message: 'Connexion Oracle AIRS non configurée (AIRS_ORACLE_* dans .env.airs).' };
    }
    try { return { configuree: true, joignable: true, cible, latenceMs: await source.ping() }; }
    catch (e) { return { configuree: true, joignable: false, cible, message: e.message }; }
  }

  /** Charge le sas depuis la base Oracle AIRS Delib (lecture seule) : séances et actes. */
  async function chargerOracle(ctx, org, importId, { annee } = {}) {
    const o = requireOrg(org); const lot = await lotDe(o, importId);
    if (lot.statut === 'annule') throw E.conflict('Lot annulé');
    if (lot.statut === 'publie') throw E.conflict('Lot déjà publié : créez un nouveau lot');
    if (!source || !source.configuree || !source.configuree()) throw E.incomplete('Connexion Oracle AIRS non configurée : renseignez AIRS_ORACLE_* (fichier .env.airs)');
    const data = await source.extraire({ annee: annee ?? null, mode: lot.mode });
    return persistRows(ctx, o, importId, data, 'oracle');
  }

  /** Écrit la progression d'un travail long (chargement, analyse) : l'écran la lit sans bloquer. */
  const majProgression = (importId, p) => db.run('UPDATE airs_imports SET progression = $2::jsonb WHERE id = $1', [importId, JSON.stringify(p)]);

  /** Écrit les lignes brutes dans le sas (partagé entre l'export JSON et la lecture Oracle), par lots.
   *  Seules les tables source VALIDÉES sont importées : aucune table non contrôlée n'entre dans le sas. */
  async function persistRows(ctx, o, importId, data, origine, { forcer = false } = {}) {
    const mapping = await ensureMapping(o);
    const valides = new Set(mapping.filter((m) => m.valide || forcer).map((m) => m.table_name));
    const plan = []; const ignorees = []; let total = 0;
    for (const [table, rows] of Object.entries(data)) {
      const m = mapping.find((x) => x.table_name === table); if (!m) { ignorees.push(table); continue; }
      if (!valides.has(table)) { ignorees.push(table); continue; }
      if (!Array.isArray(rows)) throw E.badRequest(`« ${table} » doit être une liste de lignes`);
      plan.push([m, rows]); total += rows.length;
    }
    if (total === 0 && !forcer) {
      throw E.incomplete('Aucune table validée : contrôlez puis validez les tables source avant de charger le sas',
        { missing: ignorees.map((t) => ({ code: t, label: `Table « ${t} » à valider` })) });
    }
    let fait = 0; let nbSeances = 0; let nbActes = 0; const inventaire = {};
    await majProgression(importId, { enCours: true, phase: 'chargement', fait, total, seances: 0, actes: 0 });
    for (const [m, rows] of plan) {
      const tranche = []; let n = 0;
      const vider = async () => {
        if (!tranche.length) return;
        const p = []; const v = [];
        for (const row of tranche) {
          const b = p.length;
          p.push(importId, o, m.table_name, str(row[m.cle_colonne] ?? row.id ?? sha(row)), JSON.stringify(row), sha(row));
          v.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::jsonb,$${b + 6})`);
        }
        n += tranche.length; fait += tranche.length;
        if (m.entite_cible === 'seance') nbSeances += tranche.length; else if (m.entite_cible === 'acte') nbActes += tranche.length;
        tranche.length = 0;
        await db.run(`INSERT INTO airs_raw_rows (import_id, organisme_id, table_name, source_key, payload, empreinte) VALUES ${v.join(',')}
          ON CONFLICT (import_id, table_name, source_key) DO UPDATE SET payload = EXCLUDED.payload, empreinte = EXCLUDED.empreinte`, p);
        await majProgression(importId, { enCours: true, phase: 'chargement', fait, total, seances: nbSeances, actes: nbActes });
      };
      for (const row of rows) { if (!row || typeof row !== 'object') continue; tranche.push(row); if (tranche.length >= 300) await vider(); }
      await vider(); inventaire[m.table_name] = n;
    }
    const progression = { enCours: false, phase: 'termine', fait, total, seances: nbSeances, actes: nbActes };
    await db.run(`UPDATE airs_imports SET statut = 'charge', inventaire = inventaire || $2::jsonb, progression = $3::jsonb WHERE id = $1`,
      [importId, JSON.stringify({ tables: inventaire, lignes: total, origine: origine || 'json' }), JSON.stringify(progression)]);
    await event(o, importId, ctx.username, 'lot.charge', { tables: inventaire, lignes: total, origine: origine || 'json', ignorees });
    return { lot: toLot(await db.get('SELECT * FROM airs_imports WHERE id = $1', [importId])), inventaire, ignorees };
  }

  /** Jeu d'essai (IMP-19) : permet de dérouler tout le processus en recette sans source réelle (table validée d'office). */
  async function chargerDemo(ctx, org, importId) {
    const o = requireOrg(org); const lot = await lotDe(o, importId);
    if (['annule', 'publie'].includes(lot.statut)) throw E.conflict('Lot publié ou annulé');
    return persistRows(ctx, o, importId, demo(), 'demo', { forcer: true });
  }

  async function annuler(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    await dePublier(ctx, o, importId);
    await db.run(`UPDATE airs_imports SET statut = 'annule' WHERE id = $1`, [importId]);
    await event(o, importId, ctx.username, 'lot.annule', {});
    return toLot(await db.get('SELECT * FROM airs_imports WHERE id = $1', [importId]));
  }

  /**
   * Supprime définitivement un lot d'essai (démarche essai/erreur) : retire d'abord ses publications
   * (jamais de suppression physique des actes — IMP-16), puis efface le sas, les concordances, le journal
   * et les liens du lot. Avec `parametrage`, réinitialise aussi la définition des tables source (mapping).
   */
  async function supprimerLot(ctx, org, importId, { parametrage = false } = {}) {
    const o = requireOrg(org); const lot = await lotDe(o, importId);
    await dePublier(ctx, o, importId); // marque « abandonnés » les actes publiés par ce lot
    await db.run('DELETE FROM airs_links WHERE organisme_id = $1 AND import_id = $2', [o, importId]); // permet une reprise propre
    await db.run('DELETE FROM airs_imports WHERE id = $1 AND organisme_id = $2', [importId, o]); // cascade : sas, items, concordances, événements
    if (parametrage) await db.run('DELETE FROM airs_source_tables WHERE organisme_id = $1', [o]); // le mapping par défaut sera recréé
    await audit.log(ctx, { organismeId: o, action: 'airs.lot.supprime', entity: 'airs_imports', entityId: importId, after: { label: lot.label, parametrage: !!parametrage } });
    return { supprime: true, parametrageReinitialise: !!parametrage };
  }

  // --------------------------------------------------------------------------------------------------------- analyse
  async function analyser(ctx, org, importId) {
    const o = requireOrg(org); const lot = await lotDe(o, importId);
    if (['annule', 'publie'].includes(lot.statut)) throw E.conflict('Lot publié ou annulé : analyse impossible');
    const mapping = await ensureMapping(o);
    const byTable = new Map(mapping.map((m) => [m.table_name, m]));
    const rows = await db.all('SELECT table_name, source_key, payload FROM airs_raw_rows WHERE import_id = $1 AND organisme_id = $2', [importId, o]);
    // Ré-analyse sans perdre l'existant : les items déjà importés (statut, liens acte/séance) sont conservés par (kind, source_key).
    const anciens = new Map((await db.all('SELECT kind, source_key, statut, acte_id, seance_id, pubie_at, pubie_par FROM airs_import_items WHERE import_id = $1', [importId])).map((x) => [`${x.kind}|${x.source_key}`, x]));
    await db.run('DELETE FROM airs_import_items WHERE import_id = $1', [importId]);
    let nbSeances = 0; let nbActes = 0; let fait = 0; const tranche = [];
    await majProgression(importId, { enCours: true, phase: 'analyse', fait, total: rows.length, seances: 0, actes: 0 });
    const vider = async () => {
      if (!tranche.length) return;
      const p = []; const v = [];
      for (const x of tranche) {
        const b = p.length;
        p.push(importId, o, x.kind, x.sourceKey, JSON.stringify(x.payload), x.old?.statut ?? 'en_attente', x.old?.acte_id ?? null, x.old?.seance_id ?? null, x.old?.pubie_at ?? null, x.old?.pubie_par ?? null);
        v.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::jsonb,$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
      }
      fait += tranche.length; tranche.length = 0;
      await db.run(`INSERT INTO airs_import_items (import_id, organisme_id, kind, source_key, payload, statut, acte_id, seance_id, pubie_at, pubie_par) VALUES ${v.join(',')}`, p);
      await majProgression(importId, { enCours: true, phase: 'analyse', fait, total: rows.length, seances: nbSeances, actes: nbActes });
    };
    for (const kind of ['seance', 'acte']) {
      for (const r of rows) {
        const m = byTable.get(r.table_name); if (!m || m.entite_cible !== kind) continue;
        const payload = canonise(r.payload, m); const old = anciens.get(`${kind}|${r.source_key}`);
        tranche.push({ kind, sourceKey: r.source_key, payload, old });
        if (kind === 'seance') nbSeances++; else nbActes++;
        if (tranche.length >= 300) await vider();
      }
    }
    await vider();
    await majProgression(importId, { enCours: true, phase: 'concordances', fait: 0, total: 0, seances: nbSeances, actes: nbActes });
    await enregistrerConcordances(o, importId);
    await majProgression(importId, { enCours: true, phase: 'proposition', fait: 0, total: 0, seances: nbSeances, actes: nbActes });
    await svc.proposer(o, importId);
    const progression = { enCours: false, phase: 'termine', fait, total: rows.length, seances: nbSeances, actes: nbActes };
    await db.run(`UPDATE airs_imports SET statut = 'concordances', inventaire = inventaire || $2::jsonb, progression = $3::jsonb WHERE id = $1`,
      [importId, JSON.stringify({ seances: nbSeances, actes: nbActes }), JSON.stringify(progression)]);
    await event(o, importId, ctx.username, 'lot.analyse', { seances: nbSeances, actes: nbActes });
    return detail(ctx, o, importId);
  }

  function canonise(payload, mapping) {
    const out = {};
    for (const c of mapping.colonnes || []) { const src = c.source ?? c.cible; const dst = c.cible ?? c.source; if (payload[src] !== undefined) out[dst] = payload[src]; }
    for (const k of CANON) if (payload[k] !== undefined && out[k] === undefined) out[k] = payload[k];
    return out;
  }

  async function enregistrerConcordances(org, importId) {
    const counters = new Map();
    const items = await db.all('SELECT kind, payload FROM airs_import_items WHERE import_id = $1', [importId]);
    const compter = (axe, champ, val, libelle) => {
      if (val === null || val === undefined || str(val).trim() === '') return;
      const key = `${axe}|${champ}|${norm(val)}`;
      const c = counters.get(key) || { axe, champ, code: str(val), libelle: str(libelle || val), occurrence: 0 }; c.occurrence++; counters.set(key, c);
    };
    for (const it of items) {
      if (it.kind === 'acte') {
        for (const [champ, axe] of Object.entries(CHAMP_AXE)) { if (axe === 'agent') continue; compter(axe, champ, it.payload[champ]); }
        // Agent : l'identifiant s'il existe — avec le nom en libellé (« Serge MELARAGNI ») pour la recherche annuaire/AD.
        const login = str(it.payload.redacteur).trim(); const nom = str(it.payload.redacteur_nom).trim();
        if (login) compter('agent', 'redacteur', login, nom || login); else if (nom) compter('agent', 'redacteur_nom', nom, nom);
        continue;
      }
      // Une séance porte l'axe « instance » et son « type de conseil » (Ordinaire / Extra-ordinaire) :
      // ce dernier n'est jamais un type d'acte, il alimente l'axe « type_seance ».
      compter('instance', 'instance', it.payload.instance);
      const champType = str(it.payload.type_seance).trim() ? 'type_seance' : (str(it.payload.type).trim() ? 'type' : null);
      if (champType) compter('type_seance', champType, it.payload[champType]);
    }
    // Purge les concordances obsolètes (axe ou valeur qui n'existe plus après ré-analyse), sans perdre les décisions
    // prises sur les valeurs toujours présentes (mise à jour par ON CONFLICT ci-dessous).
    for (const r of await db.all('SELECT id, axe, source_colonne, source_code FROM airs_concordances WHERE import_id = $1', [importId]))
      if (!counters.has(`${r.axe}|${r.source_colonne}|${norm(r.source_code)}`)) await db.run('DELETE FROM airs_concordances WHERE id = $1', [r.id]);
    for (const c of counters.values()) {
      await db.run(`INSERT INTO airs_concordances (organisme_id, import_id, axe, source_table, source_colonne, source_code, source_libelle, bloquant, occurrence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (COALESCE(import_id, 0), axe, source_table, source_colonne, source_code)
        DO UPDATE SET occurrence = EXCLUDED.occurrence, source_libelle = EXCLUDED.source_libelle`,
      [org, importId, c.axe, 'airs', c.champ, c.code, c.libelle, BLOQUANTS.includes(c.axe), c.occurrence]);
    }
  }

  // ------------------------------------------------------------------------------------------------------ concordances
  /** Propose une cible pour une valeur AIRS (IMP-09) : code identique, libellé normalisé, puis similarité. */
  async function proposeValeur(org, axe, code, libelle) {
    const value = libelle || code; const n = norm(value);
    const tryMatch = (rows, getCode, getLabel) => rows.find((r) => norm(getCode(r)) === norm(code) && code) || rows.find((r) => norm(getLabel(r)) === n);
    // Type de conseil : valeur déterministe, jamais un référentiel (un acte de type « Ordinaire » est une séance).
    if (axe === 'type_seance') { const t = n.includes('EXTRA') ? 'extraordinaire' : n.includes('BUDGET') ? 'budgetaire' : 'ordinaire'; return { cibleType: 'seance_types', cibleCode: t, cibleLibelle: LIBELLES_SEANCE[t], confiance: 0.99 }; }
    if (REF_KINDS[axe]) {
      const rows = await db.all('SELECT id, code, libelle, ordre FROM ref_items WHERE kind = $1 AND (organisme_id IS NULL OR organisme_id = $2) ORDER BY organisme_id NULLS LAST, ordre', [REF_KINDS[axe], org]);
      const hit = tryMatch(rows, (r) => r.code, (r) => r.libelle);
      if (hit) return { cibleType: 'ref_items', cibleId: hit.id, cibleCode: hit.code, cibleLibelle: hit.libelle, confiance: norm(hit.code) === norm(code) && code ? 1 : 0.9 };
      // Nature AIRS = code numérique (1, 4, 5, 6) : équivalence avec l'ORDRE des natures VibeDélib (MCD §8).
      if (axe === 'nature' && /^\d+$/.test(str(code).trim())) {
        const parOrdre = rows.find((r) => Number(r.ordre) === Number(code));
        if (parOrdre) return { cibleType: 'ref_items', cibleId: parOrdre.id, cibleCode: parOrdre.code, cibleLibelle: parOrdre.libelle, confiance: 0.99 };
      }
      return null;
    }
    if (axe === 'instance') { const rows = await db.all('SELECT id, code, nom FROM instances WHERE organisme_id = $1', [org]); const hit = rows.find((r) => norm(r.code) === norm(code) && code) || rows.find((r) => norm(r.nom) === n); return hit && { cibleType: 'instances', cibleId: hit.id, cibleCode: hit.code, cibleLibelle: hit.nom, confiance: 0.95 }; }
    if (axe === 'commission') { const rows = await db.all('SELECT id, nom FROM commissions WHERE organisme_id = $1', [org]); const hit = rows.find((r) => norm(r.nom) === n); return hit && { cibleType: 'commissions', cibleId: hit.id, cibleCode: null, cibleLibelle: hit.nom, confiance: 0.9 }; }
    if (axe === 'elu') { const rows = await db.all('SELECT id, nom, prenom FROM elus WHERE organisme_id = $1', [org]); const nv = norm(sansCivilite(value)); const hit = rows.find((r) => norm(`${r.prenom} ${r.nom}`) === nv) || rows.find((r) => norm(r.nom) === nv); return hit && { cibleType: 'elus', cibleId: hit.id, cibleCode: null, cibleLibelle: `${hit.prenom} ${hit.nom}`.trim(), confiance: 0.9 }; }
    if (axe === 'direction' || axe === 'service') {
      let dirs; try { dirs = await dir.directions(); } catch { dirs = []; }
      if (axe === 'direction') {
        // Les directions générales (organigramme RH) ne figurent pas toujours dans l'arbre des services : on les ajoute.
        let chart; try { chart = await dir.organisationChart(); } catch { chart = []; }
        const parCode = new Map();
        for (const d of [...dirs, ...chart]) if (d?.code && !parCode.has(d.code)) parCode.set(d.code, { code: d.code, label: d.label });
        const candidats = [...parCode.values()];
        const r = rapprocher(value, candidats, 'direction');
        if (r) return { cibleType: 'directions', cibleCode: r.cibleCode, cibleLibelle: r.cibleLibelle, confiance: r.confiance };
        // Regroupement « Direction Générale (Adjointe) … » : proposer la direction générale, à valider par un humain.
        if (norm(value).startsWith('DIRECTION GENERALE')) {
          const dg = candidats.find((c) => norm(c.label).startsWith('DIRECTION GENERALE'));
          if (dg) return { cibleType: 'directions', cibleCode: dg.code, cibleLibelle: dg.label, confiance: 0.7 };
        }
        return null;
      }
      const candidats = dirs.flatMap((d) => (d.services || []).map((s) => ({ code: s.code, label: s.label })));
      const r = rapprocher(value, candidats, 'service');
      return r && { cibleType: 'services', cibleCode: r.cibleCode, cibleLibelle: r.cibleLibelle, confiance: r.confiance };
    }
    if (axe === 'agent') {
      const login = str(code).trim().toLowerCase().replace(/^@/, '');
      const libNom = sansCivilite(str(libelle || code).trim());
      // 1) référentiel local.
      const local = await db.get(`SELECT username, display_name FROM agent_ref WHERE lower(username) = $1 OR upper(display_name) = upper($2) LIMIT 1`, [login, libNom]);
      if (local) return { cibleType: 'agents', cibleCode: local.username, cibleLibelle: local.display_name || local.username, confiance: norm(local.username) === norm(code) ? 1 : 0.9 };
      // 2) AD par identifiant exact (« JAujouannet » → Julian Aujouannet).
      if (login && ad) {
        try { const u = await ad.getUser(login); if (u?.username) return { cibleType: 'agents', cibleCode: u.username, cibleLibelle: u.displayName || `${u.givenName || ''} ${u.surname || ''}`.trim() || u.username, confiance: 0.99 }; } catch { /* AD indisponible */ }
      }
      if (login) { try { const hits = await dir.searchLogins(login, 3); if (hits[0]) return { cibleType: 'agents', cibleCode: hits[0].username, cibleLibelle: hits[0].displayName, confiance: hits.length === 1 ? 0.9 : 0.5 }; } catch { /* annuaire indisponible */ } }
      // 3) noms candidats : le nom du sas, et les mots capitalisés d'un identifiant « InitialeNom » (NHoudart → Houdart).
      const noms = new Set();
      if (libNom && /\s/.test(libNom)) noms.add(libNom);
      for (const p of (str(code).match(/[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,}/g) || [])) noms.add(p);
      for (const nom of noms) {
        if (ad) { try { const hits = await ad.searchUsers(nom); const exact = hits.filter((u) => norm(u.surname || '') === norm(nom) || norm(u.displayName) === norm(nom) || norm(u.displayName).includes(norm(nom))); if (exact.length === 1) return { cibleType: 'agents', cibleCode: exact[0].username, cibleLibelle: exact[0].displayName || nom, confiance: 0.95 }; } catch { /* AD indisponible */ } }
        try { const hits = await dir.searchByName(nom); if (hits.length === 1) return { cibleType: 'agents', cibleCode: (hits[0].email || '').split('@')[0].toLowerCase() || null, cibleLibelle: hits[0].displayName, confiance: 0.9 }; } catch { /* annuaire indisponible */ }
      }
      return null;
    }
    return null;
  }

  async function proposer(org, importId) {
    const rows = await db.all(`SELECT * FROM airs_concordances WHERE import_id = $1 AND (etat = 'a_faire' OR (etat = 'ignoree' AND decide_par IS NULL))`, [importId]);
    let n = 0;
    await majProgression(importId, { enCours: true, phase: 'proposition', fait: 0, total: rows.length, libelle: 'Propositions automatiques' });
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      if (idx % 10 === 0 || idx === rows.length - 1) await majProgression(importId, { enCours: true, phase: 'proposition', fait: idx + 1, total: rows.length, libelle: 'Propositions automatiques' });
      const p = await proposeValeur(org, r.axe, r.source_code, r.source_libelle);
      if (!p) {
        // Agent introuvable dans l'annuaire : il est parti — pas d'utilisateur, mais le nom est conservé (valeur ignorée).
        if (r.axe === 'agent') { await db.run(`UPDATE airs_concordances SET etat = 'ignoree', cible_type = 'agents', cible_libelle = $2, confiance = 1 WHERE id = $1`, [r.id, r.source_code]); n++; }
        continue;
      }
      await db.run(`UPDATE airs_concordances SET etat = $2, cible_type = $3, cible_id = $4, cible_code = $5, cible_libelle = $6, confiance = $7 WHERE id = $1`,
        [r.id, p.confiance >= 0.99 ? 'automatique' : 'proposee', p.cibleType, p.cibleId ?? null, p.cibleCode ?? null, p.cibleLibelle ?? null, p.confiance]);
      n++;
    }
    await majProgression(importId, { enCours: false, phase: 'termine', fait: rows.length, total: rows.length, libelle: 'Propositions automatiques' });
    return n;
  }

  async function concordances(org, importId, { axe } = {}) {
    const p = [importId]; let w = 'import_id = $1';
    if (axe) { p.push(axe); w += ` AND axe = $${p.length}`; }
    const rows = await db.all(`SELECT * FROM airs_concordances WHERE ${w} ORDER BY axe, occurrence DESC, source_code`, p);
    const parAxe = {};
    for (const r of rows) { const a = (parAxe[r.axe] = parAxe[r.axe] || { total: 0, resolues: 0 }); a.total++; if (['automatique', 'manuelle', 'ignoree'].includes(r.etat)) a.resolues++; }
    return {
      items: rows.map((r) => ({ id: r.id, axe: r.axe, sourceColonne: r.source_colonne, sourceCode: r.source_code, sourceLibelle: r.source_libelle, cibleType: r.cible_type, cibleId: r.cible_id, cibleCode: r.cible_code, cibleLibelle: r.cible_libelle, etat: r.etat, confiance: r.confiance === null ? null : Number(r.confiance), bloquant: r.bloquant, occurrence: r.occurrence })),
      parAxe, bloquants: BLOQUANTS,
    };
  }

  async function decider(ctx, org, importId, id, body) {
    const o = requireOrg(org); await lotDe(o, importId);
    const r = await db.get('SELECT * FROM airs_concordances WHERE id = $1 AND import_id = $2', [id, importId]);
    if (!r) throw E.notFound('Concordance introuvable');
    let etat = body.etat;
    if (etat && !ETATS.includes(etat)) throw E.badRequest('État inconnu');
    if (!etat) etat = body.cibleCode || body.cibleId ? 'manuelle' : 'ignoree';
    await db.run(`UPDATE airs_concordances SET etat = $2, cible_type = COALESCE($3, cible_type), cible_id = $4, cible_code = $5, cible_libelle = COALESCE($6, cible_libelle), decide_par = $7, decide_at = now() WHERE id = $1`,
      [id, etat, body.cibleType ?? null, body.cibleId ?? null, body.cibleCode ?? null, body.cibleLibelle ?? null, ctx.username]);
    await event(o, importId, ctx.username, 'concordance.decidee', { axe: r.axe, sourceCode: r.source_code, etat, cibleCode: body.cibleCode ?? null });
    return (await concordances(o, importId)).items.find((x) => String(x.id) === String(id));
  }

  /** Valide en une fois toutes les assignations proposées ou automatiques (éventuellement d'un seul axe). */
  async function validerTout(ctx, org, importId, { axe } = {}) {
    const o = requireOrg(org); await lotDe(o, importId);
    const p = [ctx.username, importId];
    let w = "import_id = $2 AND etat IN ('proposee', 'automatique') AND (cible_code IS NOT NULL OR cible_id IS NOT NULL)";
    if (axe) { p.push(axe); w += ` AND axe = $${p.length}`; }
    const r = await db.run(`UPDATE airs_concordances SET etat = 'manuelle', decide_par = $1, decide_at = now() WHERE ${w}`, p);
    await event(o, importId, ctx.username, 'concordances.validees', { axe: axe ?? null, nombre: r.changes });
    return { validees: r.changes };
  }

  const toEntite = (r) => ({ id: r.id, type: r.type, code: r.code, libelle: r.libelle });

  /** Crée (ou retrouve) une direction/service HISTORIQUE (ancienne organisation, sans code hiérarchique). */
  async function creerHistorique(ctx, org, { type, code, libelle }) {
    const o = requireOrg(org);
    if (!['direction', 'service'].includes(type)) throw E.badRequest('Type attendu : direction ou service');
    const l = str(libelle).trim(); if (!l) throw E.badRequest('Libellé obligatoire');
    const exist = await db.get('SELECT * FROM entites_historiques WHERE organisme_id = $1 AND type = $2 AND lower(libelle) = lower($3)', [o, type, l]);
    if (exist) return toEntite(exist);
    const r = await db.get('INSERT INTO entites_historiques (organisme_id, type, code, libelle, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [o, type, str(code).trim() || null, l, ctx.username]);
    await audit.log(ctx, { organismeId: o, action: 'entite.historique.create', entity: 'entites_historiques', entityId: r.id, after: toEntite(r) });
    return toEntite(r);
  }

  /** Crée l'entité historique correspondant à une concordance (direction/service) et la concordée. */
  async function creerConcordanceHistorique(ctx, org, importId, cid, { code, libelle }) {
    const o = requireOrg(org); await lotDe(o, importId);
    const c = await db.get('SELECT * FROM airs_concordances WHERE id = $1 AND import_id = $2', [cid, importId]);
    if (!c) throw E.notFound('Concordance introuvable');
    const type = c.axe === 'direction' ? 'direction' : c.axe === 'service' ? 'service' : null;
    if (!type) throw E.badRequest('Création possible seulement pour une direction ou un service');
    const h = await creerHistorique(ctx, o, { type, code, libelle });
    const cibleType = type === 'direction' ? 'directions_historiques' : 'services_historiques';
    const cibleCode = h.code || `hist:${h.id}`;
    await db.run(`UPDATE airs_concordances SET etat = 'manuelle', cible_type = $2, cible_id = $3, cible_code = $4, cible_libelle = $5, decide_par = $6, decide_at = now() WHERE id = $1`,
      [cid, cibleType, h.id, cibleCode, h.libelle, ctx.username]);
    await event(o, importId, ctx.username, 'concordance.historique', { axe: c.axe, sourceCode: c.source_code, libelle: h.libelle, code: h.code ?? null });
    return { entite: h, cibleCode };
  }

  /**
   * Crée les agents non rapprochés (partis de l'annuaire) dans le référentiel local `agent_ref` (source « airs »),
   * pour conserver leur nom sans en faire des utilisateurs, puis concorde leur valeur.
   */
  async function creerAgentsNonRappropries(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const rows = await db.all(`SELECT * FROM airs_concordances WHERE import_id = $1 AND axe = 'agent' AND cible_id IS NULL AND cible_code IS NULL AND etat != 'manuelle'`, [importId]);
    let crees = 0;
    for (const r of rows) {
      const src = str(r.source_code).trim(); if (!src) continue;
      const parLogin = /\s/.test(src) ? null : await db.get(`SELECT payload->>'redacteur_nom' AS nom FROM airs_import_items WHERE import_id = $1 AND kind = 'acte' AND lower(payload->>'redacteur') = lower($2) AND nullif(trim(payload->>'redacteur_nom'), '') IS NOT NULL LIMIT 1`, [importId, src]);
      const nom = str(parLogin?.nom).trim() || src;
      const username = (/\s/.test(src) ? slug(src) : src.toLowerCase().replace(/^@/, '')).slice(0, 60);
      if (!username) continue;
      await db.run(`INSERT INTO agent_ref (username, display_name, source, actif) VALUES ($1,$2,'airs',true) ON CONFLICT (username) DO NOTHING`, [username, nom]);
      await db.run(`UPDATE airs_concordances SET etat = 'manuelle', cible_type = 'agents', cible_code = $2, cible_libelle = $3, decide_par = $4, decide_at = now() WHERE id = $1`, [r.id, username, nom, ctx.username]);
      crees++;
    }
    await event(o, importId, ctx.username, 'agents.crees', { nombre: crees });
    return { crees };
  }

  /** Crée les élus non rapprochés (rapporteurs AIRS absents) dans le référentiel local comme ANCIENS élus (actif = false), puis concorde leur valeur. */
  async function creerElusNonRappropries(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const rows = await db.all(`SELECT * FROM airs_concordances WHERE import_id = $1 AND axe = 'elu' AND cible_id IS NULL AND cible_code IS NULL AND etat != 'manuelle'`, [importId]);
    let crees = 0;
    for (const r of rows) {
      const nomComplet = sansCivilite(str(r.source_code).trim()); if (!nomComplet) continue;
      const mots = nomComplet.split(/\s+/).filter(Boolean);
      const caps = mots.filter((m) => m === m.toUpperCase() && /\p{L}/u.test(m));
      let nom; let prenom;
      if (caps.length) { nom = caps.join(' '); prenom = mots.filter((m) => !caps.includes(m)).join(' '); }
      else { nom = mots.length > 1 ? mots[mots.length - 1] : mots[0]; prenom = mots.slice(0, -1).join(' '); }
      nom = nom.toUpperCase();
      const exist = await db.get('SELECT id, nom, prenom FROM elus WHERE organisme_id = $1 AND upper(nom) = upper($2) AND upper(prenom) = upper($3)', [o, nom, prenom]);
      const e = exist || await db.get("INSERT INTO elus (organisme_id, source, nom, prenom, actif) VALUES ($1,'manual',$2,$3,false) RETURNING id, nom, prenom", [o, nom, prenom]);
      await db.run(`UPDATE airs_concordances SET etat = 'manuelle', cible_type = 'elus', cible_id = $2, cible_code = NULL, cible_libelle = $3, decide_par = $4, decide_at = now() WHERE id = $1`,
        [r.id, e.id, `${e.prenom} ${e.nom}`.trim(), ctx.username]);
      crees++;
    }
    await event(o, importId, ctx.username, 'elus.crees', { nombre: crees });
    return { crees };
  }

  /** Crée en une fois les directions/services non rapprochés comme entités HISTORIQUES (anciennes organisations). */
  async function creerDsNonRappropries(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const rows = await db.all(`SELECT * FROM airs_concordances WHERE import_id = $1 AND axe IN ('direction', 'service') AND etat = 'a_faire'`, [importId]);
    let crees = 0;
    for (const r of rows) {
      const type = r.axe === 'direction' ? 'direction' : 'service';
      const brut = str(r.source_code).trim();
      const parts = brut.split(/\s[-–—]\s/);
      const code = parts.length > 1 ? parts.pop().trim() : null;
      const libelle = parts.join(' - ').trim() || brut;
      const h = await creerHistorique(ctx, o, { type, code, libelle });
      const cibleCode = h.code || `hist:${h.id}`;
      await db.run(`UPDATE airs_concordances SET etat = 'manuelle', cible_type = $2, cible_id = $3, cible_code = $4, cible_libelle = $5, decide_par = $6, decide_at = now() WHERE id = $1`,
        [r.id, type === 'direction' ? 'directions_historiques' : 'services_historiques', h.id, cibleCode, h.libelle, ctx.username]);
      crees++;
    }
    await event(o, importId, ctx.username, 'ds.crees', { nombre: crees });
    return { crees };
  }

  /** Marque les valeurs de commission restantes comme « hors commission » (commission absente de l'application). */
  async function horsCommission(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const r = await db.run(`UPDATE airs_concordances SET etat = 'manuelle', cible_type = 'hors_commission', cible_code = 'hors_commission', cible_libelle = source_code, decide_par = $1, decide_at = now()
      WHERE import_id = $2 AND axe = 'commission' AND etat != 'manuelle'`, [ctx.username, importId]);
    await event(o, importId, ctx.username, 'commission.hors', { nombre: r.changes });
    return { horsCommission: r.changes };
  }

  /** Exemples de données source portant une valeur de concordance : pour décider en connaissance de cause. */
  async function exemplesConcordance(ctx, org, importId, cid, { limite = 10 } = {}) {
    const o = requireOrg(org); await lotDe(o, importId);
    const c = await db.get('SELECT * FROM airs_concordances WHERE id = $1 AND import_id = $2', [cid, importId]);
    if (!c) throw E.notFound('Concordance introuvable');
    const n = Math.min(Math.max(Number(limite) || 10, 1), 50);
    const rows = await db.all(
      `SELECT kind, source_key, payload FROM airs_import_items
       WHERE import_id = $1 AND payload->>$2 = $3 ORDER BY kind DESC, source_key LIMIT $4`,
      [importId, c.source_colonne, c.source_code, n]);
    return {
      axe: c.axe, colonne: c.source_colonne, code: c.source_code,
      exemples: rows.map((r) => ({
        kind: r.kind, sourceKey: r.source_key, titre: r.payload.titre ?? r.payload.objet ?? null,
        date: r.payload.date ?? null, direction: r.payload.direction ?? null, service: r.payload.service ?? null,
        instance: r.payload.instance ?? null, resultat: r.payload.resultat ?? null,
      })),
    };
  }

  /** Catalogue de cibles proposées à l'écran (référentiels, directions, services, agents, élus, instances, commissions). */
  async function cibles(org, axe, q) {
    const o = requireOrg(org); const like = `%${str(q).replace(/[%_]/g, '')}%`;
    if (axe === 'type_seance') return { items: TYPES_SEANCE.map((t) => ({ code: t, libelle: LIBELLES_SEANCE[t] })) };
    if (REF_KINDS[axe]) return { items: (await db.all(`SELECT id, code, libelle FROM ref_items WHERE kind = $1 AND (organisme_id IS NULL OR organisme_id = $2) AND (code ILIKE $3 OR libelle ILIKE $3) ORDER BY ordre, libelle LIMIT 50`, [REF_KINDS[axe], o, like])).map((r) => ({ id: r.id, code: r.code, libelle: r.libelle })) };
    if (axe === 'instance') return { items: (await db.all(`SELECT id, code, nom AS libelle FROM instances WHERE organisme_id = $1 AND (code ILIKE $2 OR nom ILIKE $2) LIMIT 50`, [o, like])).map((r) => ({ id: r.id, code: r.code, libelle: r.libelle })) };
    if (axe === 'commission') {
      const items = (await db.all(`SELECT id, nom AS libelle FROM commissions WHERE organisme_id = $1 AND nom ILIKE $2 LIMIT 50`, [o, like])).map((r) => ({ id: r.id, code: null, libelle: r.libelle }));
      // Un acte passé peut relever d'une commission qui n'existe pas (ou plus) dans l'application : hors commission.
      items.push({ code: 'hors_commission', libelle: 'Hors commission (hors application)' });
      return { items };
    }
    if (axe === 'elu') return { items: (await db.all(`SELECT id, nom, prenom FROM elus WHERE organisme_id = $1 AND (nom ILIKE $2 OR prenom ILIKE $2) LIMIT 50`, [o, like])).map((r) => ({ id: r.id, code: null, libelle: `${r.prenom} ${r.nom}`.trim() })) };
    if (axe === 'direction' || axe === 'service') {
      let dirs; try { dirs = await dir.directions(); } catch { dirs = []; }
      let items;
      if (axe === 'direction') {
        let chart; try { chart = await dir.organisationChart(); } catch { chart = []; }
        const parCode = new Map();
        for (const d of [...dirs, ...chart]) if (d?.code && !parCode.has(d.code)) parCode.set(d.code, { code: d.code, libelle: d.label });
        items = [...parCode.values()];
      } else {
        items = dirs.flatMap((d) => (d.services || []).map((s) => ({ code: s.code, libelle: s.label, direction: d.code })));
      }
      if (axe === 'direction') {
        // Directions générales adjointes définies dans l'app (« DGA … ») : proposées comme cibles de direction.
        const dgas = await db.all('SELECT id, libelle FROM dga_postes WHERE organisme_id = $1 ORDER BY libelle', [o]);
        for (const p of dgas) items.push({ code: p.libelle, libelle: p.libelle, dga: true });
      }
      // Directions/services HISTORIQUES (anciennes organisations) : sans code hiérarchique, marqués « ancienne ».
      const hist = await db.all('SELECT id, code, libelle FROM entites_historiques WHERE organisme_id = $1 AND type = $2 ORDER BY libelle', [o, axe]);
      for (const h of hist) items.push({ id: h.id, code: h.code || `hist:${h.id}`, libelle: h.libelle, historique: true });
      if (str(q).trim()) items = items.filter((s) => norm(s.libelle).includes(norm(q)) || norm(s.code).includes(norm(q)));
      items.sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }));
      return { items };
    }
    if (axe === 'agent') { const hits = await dir.searchLogins(q, 20).catch(() => []); return { items: hits.map((a) => ({ code: a.username, libelle: a.displayName })) }; }
    if (axe === 'organisme') { const r = await db.get('SELECT id, nom FROM organismes WHERE id = $1', [o]); return { items: [{ code: String(o), libelle: r?.nom || String(o) }] }; }
    return { items: [] };
  }

  // ------------------------------------------------------------------------------------------------------------ items
  /** Index mémoire (concordances résolues + séances) : évite une requête par item lors de l'affichage d'un lot. */
  async function indexer(importId, rows) {
    const concordances = new Map();
    for (const r of await db.all(`SELECT axe, source_code, cible_id, cible_code FROM airs_concordances WHERE import_id = $1 AND etat IN ('manuelle', 'automatique')`, [importId]))
      concordances.set(`${r.axe}|${str(r.source_code)}`, r);
    const seances = new Map();
    for (const r of rows || await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'seance'`, [importId])) seances.set(r.source_key, r);
    return { concordances, seances };
  }

  async function resoudre(org, importId, item, index) {
    const p = item.payload;
    const conc = async (axe, val) => {
      if (val === undefined || val === null || str(val).trim() === '') return null;
      if (index) return index.concordances.get(`${axe}|${str(val)}`) ?? null;
      return db.get(`SELECT * FROM airs_concordances WHERE import_id = $1 AND axe = $2 AND source_code = $3 AND etat IN ('manuelle', 'automatique') ORDER BY id LIMIT 1`, [importId, axe, str(val)]);
    };
    const [type, nature, rubrique, matiere, direction, service, agent, rapporteur, rapporteurCompl, instance] = await Promise.all([
      conc('type_acte', p.type), conc('nature', p.nature), conc('rubrique', p.rubrique), conc('matiere', p.matiere), conc('direction', p.direction),
      conc('service', p.service), conc('agent', p.redacteur ?? p.redacteur_nom), conc('elu', p.rapporteur), conc('elu', p.rapporteur_compl), conc('instance', p.instance),
    ]);
    const typeSeance = await conc('type_seance', p.type_seance ?? p.type);
    let seanceItem = null;
    if (p.seance !== undefined && p.seance !== null && str(p.seance) !== '') {
      seanceItem = index ? (index.seances.get(str(p.seance)) ?? null) : await db.get(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'seance' AND source_key = $2`, [importId, str(p.seance)]);
    }
    const problemes = [];
    if (!str(p.titre ?? p.objet).trim()) problemes.push({ code: 'objet', label: 'Titre / objet manquant' });
    if (p.seance !== undefined && str(p.seance) !== '' && !seanceItem) problemes.push({ code: 'seance', label: `Séance « ${p.seance} » introuvable dans le lot` });
    if (p.date && Number.isNaN(Date.parse(p.date))) problemes.push({ code: 'date', label: `Date illisible : ${p.date}` });
    for (const [champ, axe] of Object.entries(CHAMP_AXE)) {
      if (!BLOQUANTS.includes(axe)) continue;
      const val = p[champ]; if (val === undefined || val === null || str(val).trim() === '') continue;
      const resolved = { direction, service }[axe];
      if (!resolved) problemes.push({ code: `${axe}:${str(val)}`, label: `Concordance « ${axe} » à valider : ${val}` });
    }
    return {
      resolved: {
        typeId: type?.cible_id ?? null, natureId: nature?.cible_id ?? null, matiereId: matiere?.cible_id ?? null, rubriqueId: rubrique?.cible_id ?? null,
        directionCode: direction?.cible_code ?? null, serviceCode: service?.cible_code ?? null, redacteur: agent?.cible_code ?? null,
        directionLabel: direction?.cible_libelle ?? null, serviceLabel: service?.cible_libelle ?? null,
        redacteurNom: str(p.redacteur_nom).trim() || str(p.redacteur).trim() || null,
        rapporteurId: rapporteur?.cible_id ?? null, rapporteurComplId: rapporteurCompl?.cible_id ?? null, instanceId: instance?.cible_id ?? null,
        typeSeance: TYPES_SEANCE.includes(typeSeance?.cible_code) ? typeSeance.cible_code : null,
      }, problemes, seanceItem,
    };
  }

  async function items(ctx, org, importId, { kind } = {}) {
    const o = requireOrg(org); await lotDe(o, importId);
    const p = [importId]; let w = 'import_id = $1'; if (kind) { p.push(kind); w += ` AND kind = $${p.length}`; }
    const rows = await db.all(`SELECT * FROM airs_import_items WHERE ${w} ORDER BY kind DESC, id`, p);
    const index = await indexer(importId, rows);
    const out = [];
    for (const r of rows) {
      if (r.statut !== 'publie') { const { problemes } = await resoudre(o, importId, r, index); out.push({ id: r.id, kind: r.kind, statut: problemes.length ? 'en_attente' : 'pret', sourceKey: r.source_key, payload: r.payload, problemes, acteId: r.acte_id, seanceId: r.seance_id, pubieAt: r.pubie_at }); }
      else out.push({ id: r.id, kind: r.kind, statut: r.statut, sourceKey: r.source_key, payload: r.payload, problemes: r.problemes, acteId: r.acte_id, seanceId: r.seance_id, pubieAt: r.pubie_at });
    }
    return { items: out };
  }

  /** Progression d'un travail long (chargement, analyse) : phase, entités traitées, total, compteurs séances/actes. */
  async function progression(org, importId) {
    const o = requireOrg(org);
    const r = await db.get('SELECT progression, statut FROM airs_imports WHERE id = $1 AND organisme_id = $2', [importId, o]);
    if (!r) throw E.notFound('Lot d’import introuvable');
    return { ...(r.progression || {}), statut: r.statut };
  }

  async function detail(ctx, org, importId) {
    const o = requireOrg(org); const lot = toLot(await lotDe(o, importId));
    const conc = await concordances(o, importId);
    const it = (await items(ctx, o, importId)).items;
    const events = await db.all('SELECT actor, action, detail, at FROM airs_import_events WHERE import_id = $1 ORDER BY id DESC LIMIT 50', [importId]);
    const aFaire = (await db.get(`SELECT count(*)::int AS n FROM airs_concordances WHERE import_id = $1 AND bloquant AND etat NOT IN ('manuelle', 'ignoree')`, [importId])).n;
    return {
      lot, mapping: await ensureMapping(o), concordances: conc,
      items: it, events, blocage: { bloquantesNonResolues: aFaire },
      compteurs: { seances: it.filter((x) => x.kind === 'seance').length, actes: it.filter((x) => x.kind === 'acte').length, prets: it.filter((x) => x.statut === 'pret').length, publies: it.filter((x) => x.statut === 'publie').length },
    };
  }

  // ------------------------------------------------------------------------------------------------------- publication
  async function prochainNumeroSuivi(q, org) {
    // Le compteur ne doit jamais repasser sous le plus grand n° de suivi déjà attribué (actes créés hors import).
    const max = (await q.get('SELECT COALESCE(MAX(numero_suivi), 0)::int AS m FROM actes WHERE organisme_id = $1', [org])).m;
    await q.run(`INSERT INTO counters (organisme_id, key, value) VALUES ($1, 'airs.numero_suivi', $2) ON CONFLICT (organisme_id, key) DO NOTHING`, [org, max]);
    return Number((await q.get(`UPDATE counters SET value = GREATEST(value + 1, $2 + 1) WHERE organisme_id = $1 AND key = 'airs.numero_suivi' RETURNING value`, [org, max])).value);
  }

  const mapResultat = (r) => { const v = norm(r); if (!v) return null; if (v.includes('REJET')) return 'rejete'; if (v.includes('UNANIM')) return 'adopte_unanimite'; if (v.includes('ADOPT')) return 'adopte_majorite'; return null; };

  /**
   * Une séance reprise d'AIRS ne doit jamais rester close par l'import (AIRS ne transmet pas la clôture) : on rouvre
   * une séance close qui ne porte aucune saisie de suivi (ni présence, ni vote, ni amendement, ni journal).
   */
  async function reparerClotureImport(o, seanceId) {
    const s = await db.get('SELECT statut FROM seances WHERE id = $1 AND organisme_id = $2', [seanceId, o]);
    if (!s || s.statut !== 'close') return;
    const activite = await db.get(`SELECT 1 AS x WHERE
      EXISTS (SELECT 1 FROM seance_journal WHERE seance_id = $1)
      OR EXISTS (SELECT 1 FROM seance_presences WHERE seance_id = $1)
      OR EXISTS (SELECT 1 FROM seance_amendements WHERE seance_id = $1)
      OR EXISTS (SELECT 1 FROM seance_votes v JOIN seance_items i ON i.id = v.item_id WHERE i.seance_id = $1)`, [seanceId]);
    if (activite) return;
    await db.run("UPDATE seance_tenue SET statut = 'ouverte', close_at = NULL, close_par = NULL WHERE seance_id = $1", [seanceId]);
    await db.run("UPDATE seances SET statut = 'tenue' WHERE id = $1", [seanceId]);
  }

  async function publierSeance(ctx, o, importId, item, { implicite = false } = {}) {
    const link = await db.get(`SELECT entity_id FROM airs_links WHERE organisme_id = $1 AND kind = 'seance' AND source_key = $2`, [o, item.source_key]);
    if (link) {
      // Séance déjà reprise : on corrige une éventuelle clôture laissée par un import antérieur.
      if ((await db.get('SELECT mode FROM airs_imports WHERE id = $1', [importId])).mode === 'passes') await reparerClotureImport(o, link.entity_id);
      // Import implicite (via un acte) : la séance est créée, mais le conseil n'est PAS marqué « importé ».
      if (implicite) await db.run(`UPDATE airs_import_items SET seance_id = $2 WHERE id = $1`, [item.id, link.entity_id]);
      else await db.run(`UPDATE airs_import_items SET seance_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, link.entity_id, ctx.username]);
      return link.entity_id;
    }
    const { resolved } = await resoudre(o, importId, item);
    const instanceId = resolved.instanceId ?? (await db.get('SELECT id FROM instances WHERE organisme_id = $1 ORDER BY id LIMIT 1', [o]))?.id;
    if (!instanceId) throw E.incomplete('Aucune instance de séance : paramétrez une instance avant de publier', { missing: [{ code: 'instance', label: 'Instance de séance' }] });
    const date = item.payload.date && !Number.isNaN(Date.parse(item.payload.date)) ? item.payload.date : new Date().toISOString();
    // Reprise d'historique : la séance est marquée « tenue » mais JAMAIS « close ». AIRS ne dit pas qu'une séance
    // est clôturée et une séance close est verrouillée (aucune saisie) : le SCC clôturera le suivi s'il y a lieu.
    const passe = (await db.get('SELECT mode FROM airs_imports WHERE id = $1', [importId])).mode === 'passes';
    const seance = await db.get(`INSERT INTO seances (organisme_id, instance_id, type, date_seance, lieu, statut, odj_statut, odj_arrete_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [o, instanceId, resolved.typeSeance ?? 'ordinaire', date, item.payload.lieu ?? null, passe ? 'tenue' : 'planifiee', passe ? 'tenue' : 'en_preparation', passe ? date : null, ctx.username]);
    await db.run(`INSERT INTO airs_links (organisme_id, kind, source_key, entity_id, import_id) VALUES ($1,'seance',$2,$3,$4) ON CONFLICT (organisme_id, kind, source_key) DO UPDATE SET entity_id = EXCLUDED.entity_id`, [o, item.source_key, seance.id, importId]);
    if (implicite) await db.run(`UPDATE airs_import_items SET seance_id = $2 WHERE id = $1`, [item.id, seance.id]);
    else await db.run(`UPDATE airs_import_items SET seance_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, seance.id, ctx.username]);
    return seance.id;
  }

  async function publierActe(ctx, o, importId, item, { documents = true } = {}) {
    const lot = await db.get('SELECT mode FROM airs_imports WHERE id = $1', [importId]);
    const { resolved, problemes, seanceItem } = await resoudre(o, importId, item);
    if (problemes.length) throw E.incomplete('Item incomplet : résolvez les blocages avant publication', { missing: problemes });
    const link = await db.get(`SELECT entity_id FROM airs_links WHERE organisme_id = $1 AND kind = 'acte' AND source_key = $2`, [o, item.source_key]);
    if (link) { await db.run(`UPDATE actes SET statut = $3 WHERE id = $1 AND organisme_id = $2`, [link.entity_id, o, lot.mode === 'passes' ? 'archive' : 'brouillon']); await db.run(`UPDATE airs_import_items SET acte_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, link.entity_id, ctx.username]); return link.entity_id; }
    const p = item.payload;
    const typeId = resolved.typeId ?? (await db.get(`SELECT id FROM ref_items WHERE kind = 'type_acte' AND code = 'deliberation' AND (organisme_id IS NULL OR organisme_id = $1) ORDER BY organisme_id NULLS LAST LIMIT 1`, [o]))?.id;
    if (!typeId) throw E.incomplete('Type d’acte introuvable', { missing: [{ code: 'type_acte', label: 'Type d’acte' }] });
    const seanceId = seanceItem ? await publierSeance(ctx, o, importId, await db.get('SELECT * FROM airs_import_items WHERE id = $1', [seanceItem.id]), { implicite: true }) : null;
    const titre = str(p.titre ?? p.objet).trim();
    const statut = lot.mode === 'passes' ? 'archive' : 'brouillon';
    const numeroBrut = str(p.numero).trim();
    // Numéro de délibération à la mode AIRS : DEL<AAAAMMJJ>_<n° chrono><suffixe éventuel>.
    // La date est celle de l'acte, sinon celle de la séance (les actes archivés n'ont pas de date de vote).
    const dateSrc = p.date || seanceItem?.payload?.date || null;
    const dateNum = dateSrc ? new Date(dateSrc) : null; const dateCompact = dateNum && !Number.isNaN(dateNum.getTime()) ? `${dateNum.getFullYear()}${String(dateNum.getMonth() + 1).padStart(2, '0')}${String(dateNum.getDate()).padStart(2, '0')}` : null;
    const chrono = str(p.num_chrono).trim();
    let numeroDelib = dateCompact && chrono && chrono !== '0' ? `DEL${dateCompact}_${chrono}${str(p.sous_numero).trim()}` : (numeroBrut && numeroBrut !== '0' ? numeroBrut : null);
    // Un même n° de délibération (chrono) porte souvent plusieurs sous-points (A/, B/, C/…) : on rend le n° de point
    // unique (suffixe) au lieu de perdre l'acte. Seul un vrai doublon (même titre) est écarté.
    if (seanceId && numeroDelib) {
      const ex = await db.get('SELECT titre FROM seance_items WHERE seance_id = $1 AND numero = $2 LIMIT 1', [seanceId, numeroDelib]);
      if (ex) {
        if ((ex.titre || '').trim().toLowerCase() === (titre || '').trim().toLowerCase()) throw E.conflict(`Doublon : le point n° ${numeroDelib} existe déjà dans cette séance`);
        const n = (await db.get("SELECT count(*)::int AS n FROM seance_items WHERE seance_id = $1 AND (numero = $2 OR numero LIKE $2 || '-%')", [seanceId, numeroDelib])).n;
        numeroDelib = `${numeroDelib}-${n + 1}`;
      }
    }
      const custom = { airs: { importId, sourceKey: item.source_key, origine: item.payload?.origine ?? null, numero: p.numero ?? null, numSuivi: p.num_suivi ?? null, numChrono: p.num_chrono ?? null, resultat: p.resultat ?? null, direction: p.direction ?? null, service: p.service ?? null, commission: p.commission ?? null, redacteurNom: resolved.redacteurNom ?? null } };
    const acte = await db.tx(async (q) => {
      const numeroSuivi = await prochainNumeroSuivi(q, o);
      const a = await q.get(`INSERT INTO actes (organisme_id, numero_suivi, type_id, titre, statut, redacteur, direction_code, direction_label, service_code, service_label,
          nature_id, matiere_id, rubrique_id, incidence_financiere, montant, rapporteur_id, rapporteur_compl_id, seance_id, custom, participants)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,'[]'::jsonb) RETURNING *`,
      [o, numeroSuivi, typeId, titre || `Acte importé ${item.source_key}`, statut, resolved.redacteur || resolved.redacteurNom || 'import.airs', resolved.directionCode || codeDepuis(p.direction) || 'AIRS',
        resolved.directionLabel || str(p.direction) || null, resolved.serviceCode || codeDepuis(p.service) || null, resolved.serviceLabel || str(p.service) || null, resolved.natureId, resolved.matiereId, resolved.rubriqueId,
        p.incidence_financiere ?? null, p.montant ?? null, resolved.rapporteurId, resolved.rapporteurComplId, seanceId, JSON.stringify(custom)]);
      const delib = await q.get(`INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1,1,$2) RETURNING id`, [a.id, titre || 'Délibération']);
      const texts = [['expose', null, str(p.expose)], ['visas', delib.id, str(p.visas ?? p.considere)], ['dispositif', delib.id, str(p.dispositif)]];
      for (const [kind, delibId, markdown] of texts) if (markdown) await q.run(`INSERT INTO tracked_texts (organisme_id, acte_id, deliberation_id, kind, markdown, updated_by) VALUES ($1,$2,$3,$4,$5,$6)`, [o, a.id, delibId, kind, markdown, ctx.username]);
      if (seanceId) {
        const item2 = await q.get(`INSERT INTO seance_items (organisme_id, seance_id, position, kind, acte_id, deliberation_id, titre, numero, statut, created_by)
          SELECT $1,$2, COALESCE(MAX(position),0)+1, 'deliberation', $3,$4,$5,$6, $7, $8 FROM seance_items WHERE seance_id = $2 RETURNING *`, [o, seanceId, a.id, delib.id, titre, numeroDelib, statut === 'archive' ? 'a_traiter' : 'a_traiter', ctx.username]);
        const res = mapResultat(p.resultat);
        await q.run(`INSERT INTO seance_points (item_id, seance_id, etat, resultat, close_at, close_par) VALUES ($1,$2,$3,$4,$5,$6)`,
          [item2.id, seanceId, statut === 'archive' ? 'traite' : 'a_traiter', statut === 'archive' ? (res || 'adopte_majorite') : null, statut === 'archive' ? new Date().toISOString() : null, statut === 'archive' ? ctx.username : null]);
      }
      return a;
    });
    if (documents) await attacherDocuments(ctx, o, item, acte.id);
    await db.run(`INSERT INTO airs_links (organisme_id, kind, source_key, entity_id, import_id) VALUES ($1,'acte',$2,$3,$4) ON CONFLICT (organisme_id, kind, source_key) DO UPDATE SET entity_id = EXCLUDED.entity_id`, [o, item.source_key, acte.id, importId]);
    await db.run(`UPDATE airs_import_items SET acte_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, acte.id, ctx.username]);
    await event(o, importId, ctx.username, 'acte.publie', { sourceKey: item.source_key, acteId: acte.id });
    return acte.id;
  }

  async function publierItem(ctx, org, importId, itemId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const item = await db.get(`SELECT * FROM airs_import_items WHERE id = $1 AND import_id = $2`, [itemId, importId]);
    if (!item) throw E.notFound('Item introuvable');
    if (item.kind === 'seance') {
      // Importer un conseil importe aussi ses actes rattachés (échecs collectés, jamais bloquants pour la séance).
      await majProgression(importId, { enCours: true, phase: 'import', fait: 0, total: 0, libelle: 'Import du conseil' });
      const seanceId = await publierSeance(ctx, o, importId, item);
      const actes = await db.all("SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'acte' AND payload->>'seance' = $2 AND statut != 'publie' ORDER BY id", [importId, item.source_key]);
      let n = 0; const erreurs = [];
      await majProgression(importId, { enCours: true, phase: 'import', fait: 0, total: actes.length, libelle: "Import des actes du conseil" });
      for (let i = 0; i < actes.length; i++) { try { await publierActe(ctx, o, importId, actes[i]); n++; } catch (e) { erreurs.push({ sourceKey: actes[i].source_key, motif: e.message, missing: e.details?.missing || null }); } if (i % 3 === 0 || i === actes.length - 1) await majProgression(importId, { enCours: true, phase: 'import', fait: i + 1, total: actes.length, libelle: "Import des actes du conseil" }); }
      await majProgression(importId, { enCours: false, phase: 'termine', fait: actes.length, total: actes.length, libelle: "Import des actes du conseil" });
      await majStatutLot(o, importId);
      return { item: { ...item, statut: 'publie', seanceId }, seanceId, actes: n, erreurs };
    }
    await majProgression(importId, { enCours: true, phase: 'import', fait: 0, total: 1, libelle: 'Import de l’acte' });
    const acteId = await publierActe(ctx, o, importId, item);
    await majProgression(importId, { enCours: false, phase: 'termine', fait: 1, total: 1, libelle: 'Import de l’acte' });
    await majStatutLot(o, importId);
    return { item: { ...item, statut: 'publie', acteId } };
  }

  async function publierTout(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const result = { publies: 0, ignores: [] };
    const seances = await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'seance' AND statut != 'publie'`, [importId]);
    for (const s of seances) { try { await publierSeance(ctx, o, importId, s); } catch { /* séance sans instance : signalée via les actes */ } }
    const actes = await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'acte' AND statut != 'publie' ORDER BY id`, [importId]);
    await majProgression(importId, { enCours: true, phase: 'import', fait: 0, total: actes.length, libelle: 'Import des conseils et des actes' });
    for (let i = 0; i < actes.length; i++) { try { await publierActe(ctx, o, importId, actes[i]); result.publies++; } catch (e) { result.ignores.push({ sourceKey: actes[i].source_key, motif: e.message, missing: e.details?.missing || null }); } if (i % 3 === 0 || i === actes.length - 1) await majProgression(importId, { enCours: true, phase: 'import', fait: i + 1, total: actes.length, libelle: 'Import des conseils et des actes' }); }
    await majProgression(importId, { enCours: false, phase: 'termine', fait: actes.length, total: actes.length, libelle: 'Import des conseils et des actes' });
    await majStatutLot(o, importId);
    return result;
  }

  async function ignorerItem(ctx, org, importId, itemId) {
    const o = requireOrg(org); await lotDe(o, importId);
    await db.run(`UPDATE airs_import_items SET statut = 'ignore' WHERE id = $1 AND import_id = $2`, [itemId, importId]);
    return { ok: true };
  }

  async function dePublier(ctx, org, importId) {
    const items = await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND statut = 'publie'`, [importId]);
    for (const it of items) {
      if (it.acte_id) {
        await db.run(`UPDATE actes SET statut = 'abandonne', custom = custom || '{"airs_annule": true}'::jsonb WHERE id = $1 AND organisme_id = $2`, [it.acte_id, org]);
        if (it.seance_id) await db.run(`UPDATE seance_items SET statut = 'retire', retire_motif = 'Import AIRS DELIB annulé' WHERE acte_id = $1`, [it.acte_id]);
      }
      await db.run(`UPDATE airs_import_items SET statut = 'ignore' WHERE id = $1`, [it.id]);
    }
    await majStatutLot(org, importId);
    return { retires: items.filter((x) => x.acte_id).length };
  }

  /** Annule l'import d'un élément (conseil — et ses actes — ou acte seul) et le remet « à importer ». */
  async function dePublierItem(ctx, org, importId, itemId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const item = await db.get(`SELECT * FROM airs_import_items WHERE id = $1 AND import_id = $2`, [itemId, importId]);
    if (!item) throw E.notFound('Item introuvable');
    if (item.statut !== 'publie' && !item.seance_id && !item.acte_id) return { annule: false };
    const cibles = item.kind === 'seance'
      ? await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'acte' AND payload->>'seance' = $2`, [importId, item.source_key])
      : [item];
    let actes = 0;
    for (const a of cibles) {
      if (!a.acte_id) continue;
      await db.run(`UPDATE actes SET statut = 'abandonne', custom = custom || '{"airs_annule": true}'::jsonb WHERE id = $1 AND organisme_id = $2`, [a.acte_id, o]);
      if (a.seance_id) await db.run(`UPDATE seance_items SET statut = 'retire', retire_motif = 'Import AIRS DELIB annulé' WHERE acte_id = $1`, [a.acte_id]);
      await db.run(`DELETE FROM airs_links WHERE organisme_id = $1 AND kind = 'acte' AND source_key = $2`, [o, a.source_key]);
      await db.run(`UPDATE airs_import_items SET statut = 'en_attente', acte_id = NULL, pubie_at = NULL, pubie_par = NULL WHERE id = $1`, [a.id]);
      actes++;
    }
    if (item.kind === 'seance') {
      const link = await db.get(`SELECT entity_id FROM airs_links WHERE organisme_id = $1 AND kind = 'seance' AND source_key = $2`, [o, item.source_key]);
      if (link) {
        await db.run(`DELETE FROM seances WHERE id = $1 AND organisme_id = $2`, [link.entity_id, o]);
        await db.run(`DELETE FROM airs_links WHERE organisme_id = $1 AND kind = 'seance' AND source_key = $2`, [o, item.source_key]);
      }
      await db.run(`UPDATE airs_import_items SET statut = 'en_attente', seance_id = NULL, pubie_at = NULL, pubie_par = NULL WHERE id = $1`, [item.id]);
    }
    await majStatutLot(o, importId);
    await event(o, importId, ctx.username, 'import.annule', { kind: item.kind, sourceKey: item.source_key, actes });
    return { annule: true, actes };
  }

  /** Importe TOUS les actes du sas (séances créées au besoin), et renvoie le détail des échecs. */
  async function importerTousLesActes(ctx, org, importId, { documents = true } = {}) {
    const o = requireOrg(org); await lotDe(o, importId);
    const result = { publies: 0, ignores: [] };
    const actes = await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'acte' AND statut != 'publie' ORDER BY id`, [importId]);
    await majProgression(importId, { enCours: true, phase: 'import', fait: 0, total: actes.length, libelle: documents ? 'Import de tous les actes' : 'Import de tous les actes (documents en différé)' });
    for (let i = 0; i < actes.length; i++) { try { await publierActe(ctx, o, importId, actes[i], { documents }); result.publies++; } catch (e) { const doublon = /Doublon/.test(e.message); if (doublon) await db.run("UPDATE airs_import_items SET statut = 'ignore' WHERE id = $1", [actes[i].id]).catch(() => {}); result.ignores.push({ sourceKey: actes[i].source_key, motif: e.message, doublon, missing: e.details?.missing || null }); } if (i % 3 === 0 || i === actes.length - 1) await majProgression(importId, { enCours: true, phase: 'import', fait: i + 1, total: actes.length, libelle: documents ? 'Import de tous les actes' : 'Import de tous les actes (documents en différé)' }); }
    await majProgression(importId, { enCours: false, phase: 'termine', fait: actes.length, total: actes.length, libelle: 'Import de tous les actes' });
    await majStatutLot(o, importId);
    return result;
  }

  /**
   * Passe différée : rattache les documents d'origine (et leur PDF) aux actes importés qui n'en ont pas encore.
   * Sert après une reprise « rapide » (actes d'abord) — la lecture des fichiers sur le partage AIRS est longue.
   */
  async function attacherDocumentsManquants(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const items = await db.all(`SELECT i.* FROM airs_import_items i
      WHERE i.import_id = $1 AND i.kind = 'acte' AND i.acte_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM annexes an WHERE an.acte_id = i.acte_id AND an.titre ILIKE '%document d''origine%')
      ORDER BY i.id`, [importId]);
    let n = 0;
    await majProgression(importId, { enCours: true, phase: 'import', fait: 0, total: items.length, libelle: 'Rattachement des documents' });
    for (let i = 0; i < items.length; i++) { try { await attacherDocuments(ctx, o, items[i], items[i].acte_id); n++; } catch { /* document absent : on continue */ } if (i % 3 === 0 || i === items.length - 1) await majProgression(importId, { enCours: true, phase: 'import', fait: i + 1, total: items.length, libelle: 'Rattachement des documents' }); }
    await majProgression(importId, { enCours: false, phase: 'termine', fait: items.length, total: items.length, libelle: 'Rattachement des documents' });
    return { actes: n, total: items.length };
  }

  /** Importe en masse tous les conseils ARCHIVÉS du sas (et leurs actes / documents d'origine). */
  async function importerConseilsArchives(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const seances = await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'seance' AND payload->>'origine' = 'archive' AND statut != 'publie' ORDER BY payload->>'date'`, [importId]);
    const result = { conseils: 0, actes: 0, erreurs: [] };
    await majProgression(importId, { enCours: true, phase: 'import', fait: 0, total: seances.length, libelle: 'Import des conseils archivés' });
    for (let i = 0; i < seances.length; i++) {
      try { const r = await publierItem(ctx, o, importId, seances[i].id); result.conseils++; result.actes += (r.actes || 0); }
      catch (e) { result.erreurs.push({ sourceKey: seances[i].source_key, motif: e.message }); }
      await majProgression(importId, { enCours: true, phase: 'import', fait: i + 1, total: seances.length, libelle: 'Import des conseils archivés' });
    }
    await majProgression(importId, { enCours: false, phase: 'termine', fait: seances.length, total: seances.length, libelle: 'Import des conseils archivés' });
    await majStatutLot(o, importId);
    return result;
  }

  async function majStatutLot(org, importId) {
    const r = await db.get(`SELECT count(*) FILTER (WHERE statut = 'publie')::int AS p, count(*) FILTER (WHERE statut != 'publie' AND statut != 'ignore')::int AS reste FROM airs_import_items WHERE import_id = $1`, [importId]);
    const statut = r.p > 0 && r.reste === 0 ? 'publie' : 'concordances';
    await db.run(`UPDATE airs_imports SET statut = $2 WHERE id = $1 AND statut != 'annule'`, [importId, statut]);
  }

  // --------------------------------------------------------------------------------------------------------- agents
  /** Contrôle AD / RH d'agents jamais connectés (IMP-12) : jamais de création, seulement un diagnostic. */
  async function verifierAgents(ctx, org, valeurs) {
    const o = requireOrg(org); const out = [];
    for (const v of (valeurs || []).slice(0, 50)) {
      const identifiant = str(v.identifiant).trim().toLowerCase().replace(/^@/, '');
      const libelle = str(v.nom).trim();
      let statut = 'absent'; let trouves = [];
      if (identifiant) { const local = await dir.getAgent(identifiant); if (local?.actif) { statut = 'connu'; trouves = [{ username: identifiant, libelle: local.displayName }]; } }
      if (statut === 'absent' && libelle) { try { const hits = await dir.searchByName(libelle); if (hits.length === 1) { statut = 'jamais_connecte'; trouves = hits.map((h) => ({ username: (h.email || '').split('@')[0], libelle: h.displayName })); } else if (hits.length > 1) { statut = 'ambigu'; trouves = hits.map((h) => ({ username: (h.email || '').split('@')[0], libelle: h.displayName })); } } catch { statut = 'annuaire_indisponible'; } }
      out.push({ identifiant: identifiant || null, nom: libelle || null, statut, trouves });
    }
    return { items: out, sansCreation: true, organismeId: o };
  }

  // --------------------------------------------------------------------------------------------------------- helpers
  async function lotDe(org, importId) {
    const lot = await db.get('SELECT * FROM airs_imports WHERE id = $1 AND organisme_id = $2', [importId, org]);
    if (!lot) throw E.notFound('Lot d’import introuvable');
    return lot;
  }
  const event = (org, importId, actor, action, detail) => db.run(`INSERT INTO airs_import_events (import_id, organisme_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5::jsonb)`, [importId, org, actor, action, JSON.stringify(detail || {})]);

  function demo() {
    return {
      seances: [
        { id: 'S-2023-03', instance: 'Conseil municipal', date: '2023-03-15T19:00:00', lieu: 'Hôtel de ville' },
        { id: 'S-2023-06', instance: 'Conseil municipal', date: '2023-06-22T19:00:00', lieu: 'Hôtel de ville' },
      ],
      rapports: [
        { id: 'R-1001', numero: '2023-03-15-001', seance: 'S-2023-03', objet: "Attribution d'une subvention à l'association Les Amis du Sport", type: 'deliberation', nature: 'Delibérations', rubrique: 'SPORTS', matiere: '7.5 Subventions', direction: 'DIRECTION DES FINANCES', service: 'BUDGET', redacteur: 'dupont', rapporteur: 'Martine Rapporteuse', resultat: 'Adoptée à l’unanimité', expose: "Il est proposé d'attribuer une subvention de fonctionnement.", considere: 'Vu le code général des collectivités territoriales ;', dispositif: 'Article 1 : une subvention de 1 500 € est attribuée.' },
        { id: 'R-1002', numero: '2023-06-22-004', seance: 'S-2023-06', objet: 'Convention avec le CCAS pour l’aide alimentaire', type: 'deliberation', nature: 'Contrats, conventions et avenants', rubrique: 'ACTION SOCIALE', matiere: '7.5 Subventions', direction: 'DIRECTION CCAS', service: 'AIDE SOCIALE', redacteur: 'martin', rapporteur: 'Martine Rapporteuse', resultat: 'Adoptée à la majorité', expose: 'Une convention annuelle encadre l’aide alimentaire.', considere: 'Vu le code de l’action sociale et des familles ;', dispositif: 'Article 1 : la convention est approuvée.' },
      ],
    };
  }

  // ------------------------------------------------------------------------------------------------ source fichiers AIRS
  const FIC_CFG_KEY = 'airs.fichiers';
  const FIC_SHARE_DEFAUT = '\\\\airsdelibv7\\filesystem$';

  /** État d'accès au partage de fichiers AIRS (d'où sont tirés les documents d'origine). */
  async function etatFichiers(org) {
    const o = requireOrg(org);
    const r = await db.get("SELECT value FROM settings WHERE scope = 'organisme' AND scope_id = $1 AND key = $2", [o, FIC_CFG_KEY]).catch(() => null);
    const cfg = r?.value || {};
    const share = cfg.share || FIC_SHARE_DEFAUT;
    let joignable; let exemples = [];
    try { exemples = (await fs.promises.readdir(path.join(share, 'DEL_ARCHIVE'))).slice(0, 5); joignable = true; } catch { joignable = false; }
    return { share, domaine: cfg.domaine || '', utilisateur: cfg.utilisateur || '', monte: !!cfg.monte, joignable, exemples, dossierBase: 'DEL_ARCHIVE' };
  }

  /** Teste l'accès au partage avec les identifiants fournis (`net use`), puis vérifie la lecture de DEL_ARCHIVE. */
  async function testerFichiers(ctx, org, { share, domaine, utilisateur, motDePasse }) {
    const o = requireOrg(org);
    if (process.platform !== 'win32') throw E.conflict('Montage SMB non géré sur ce système');
    const sh = str(share).trim() || FIC_SHARE_DEFAUT;
    const dom = str(domaine).trim();
    const user = `${dom ? `${dom}\\` : ''}${str(utilisateur).trim()}`;
    if (!user || !motDePasse) throw E.badRequest('Indiquez le compte (domaine\\utilisateur) et le mot de passe');
    const netUse = (args) => execFileP('cmd', ['/c', 'net', 'use', ...args], { windowsHide: true });
    try { await netUse([sh, motDePasse, `/user:${user}`]); }
    catch {
      await netUse([sh, '/delete', '/y']).catch(() => {});
      try { await netUse([sh, motDePasse, `/user:${user}`]); }
      catch (e2) { throw E.conflict(`Accès refusé au partage « ${sh} » : ${String(e2.message).split('\n').map((x) => x.trim()).filter(Boolean).pop() || e2.message}`); }
    }
    const base = path.join(sh, 'DEL_ARCHIVE');
    try { await fs.promises.access(base); } catch { throw E.conflict(`Partage monté mais dossier « ${base} » illisible`); }
    const exemples = (await fs.promises.readdir(base)).slice(0, 5);
    await db.run(`INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('organisme',$1,$2,$3::jsonb,$4)
      ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [o, FIC_CFG_KEY, JSON.stringify({ share: sh, domaine: dom, utilisateur: str(utilisateur).trim(), monte: true }), ctx.username]);
    await audit.log(ctx, { organismeId: o, action: 'airs.fichiers.acces', entity: 'settings', after: { share: sh, utilisateur: user } });
    return { ok: true, share: sh, exemples };
  }

  /** Lit un fichier du partage AIRS à partir du chemin service (`FIC_CHEMIN_SERV`, séparateurs « / »). */
  async function lireFichierAir(org, cheminServ) {
    const o = requireOrg(org);
    const r = await db.get("SELECT value FROM settings WHERE scope = 'organisme' AND scope_id = $1 AND key = $2", [o, FIC_CFG_KEY]).catch(() => null);
    const share = r?.value?.share || FIC_SHARE_DEFAUT;
    const rel = str(cheminServ).replace(/^\//, '').split('/').join(path.sep);
    return fs.promises.readFile(path.join(share, rel));
  }

  const MIME_FIC = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  const LIBELLE_FIC = { 4: "Exposé des motifs (document d'origine AIRS)", 5: "Délibération (document d'origine AIRS)" };
  /** Borne une promesse (connexion/lecture réseau) pour qu'un import ne reste jamais bloqué. */
  const avecDelai = (p, ms, msg = 'délai dépassé') => Promise.race([p, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(msg)), ms); if (t.unref) t.unref(); })]);

  /** Récupère les fichiers d'origine d'AIRS et les rattache à l'acte importé (annexes publiables), avec conversion PDF si possible. */
  async function attacherDocuments(ctx, o, item, acteId) {
    if (!storage || !source) return { ajoutes: 0 };
    const docId = String(item.source_key || '').replace(/^act:/, '');
    const archive = String(item.payload?.origine || '').toLowerCase() === 'archive';
    const liste = [];
    if (archive) {
      if (typeof source.fichiers !== 'function') return { ajoutes: 0 };
      let fichiers; try { fichiers = await avecDelai(source.fichiers({ docId, archive: true }), 20000, 'AIRS injoignable'); } catch { return { ajoutes: 0, erreur: 'AIRS injoignable' }; }
      for (const f of (fichiers || [])) liste.push({ nom: f.nom, cheminServ: f.cheminServ, titre: LIBELLE_FIC[f.tfp] || f.libelle || f.nom });
    } else {
      const rapId = str(item.payload?.rap_id).trim();
      let docs = []; let anne = [];
      try { if (typeof source.documentsCourants === 'function') docs = await avecDelai(source.documentsCourants({ delId: docId, rapId }), 20000, 'AIRS injoignable'); } catch { /* ignoré */ }
      try { if (rapId && typeof source.annexesDeRapport === 'function') anne = await avecDelai(source.annexesDeRapport(rapId), 20000, 'AIRS injoignable'); } catch { /* ignoré */ }
      for (const d of docs) liste.push({ nom: d.nom, cheminServ: d.cheminServ, titre: d.source === 'rapport' ? "Exposé des motifs (document d'origine AIRS)" : "Délibération (document d'origine AIRS)" });
      for (const a of anne) liste.push({ nom: a.nom, cheminServ: a.cheminServ, titre: a.libelle || a.nom });
    }
    let n = 0;
    for (let i = 0; i < liste.length; i++) {
      const f = liste[i];
      try {
        const buf = await avecDelai(lireFichierAir(o, f.cheminServ), 30000, 'serveur de fichiers injoignable');
        const ext = (path.extname(f.nom || '') || '.pdf').slice(1).toLowerCase();
        const put = await storage.put(buf, { organismeId: o, ext });
        const file = await db.get(`INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7) RETURNING id`,
          [o, put.key, f.nom, MIME_FIC[ext] || 'application/octet-stream', put.size, put.sha256, ctx.username]);
        const placeholders = `INSERT INTO annexes (acte_id, titre, ordre, file_id, publiable, communicable, transmissible, created_by) VALUES ($1,$2,$3,$4,true,true,true,$5) RETURNING id`;
        const an = await db.get(placeholders, [acteId, f.titre, i + 1, file.id, ctx.username]);
        n++;
        // Conversion PDF rattachée à la MÊME annexe (deux boutons : original + PDF).
        if (EXT_CONVERTIBLES.has(ext)) {
          const pdf = await convertirEnPdf(buf, ext);
          if (pdf) {
            const p2 = await storage.put(pdf, { organismeId: o, ext: 'pdf' });
            const pf = await db.get(`INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,NULL,$5,$6) RETURNING id`,
              [o, p2.key, `${f.nom}.pdf`, p2.size, p2.sha256, ctx.username]);
            await db.run('UPDATE annexes SET pdf_file_id = $2 WHERE id = $1', [an.id, pf.id]);
            n++;
          }
        }
      } catch { /* fichier absent ou illisible : l'import continue */ }
    }
    return { ajoutes: n, total: liste.length };
  }

  Object.assign(svc, {
    AXES, ETATS, BLOQUANTS, REF_KINDS, CHAMP_AXE, DEFAULT_MAPPING, TYPES_SEANCE,
    getMapping, setMapping, tablesSource, apercuTable, validerTable,
    creerLot, lister, charger, chargerDemo, chargerOracle, etatSource, annuler, supprimerLot,
    analyser, proposer, concordances, exemplesConcordance, decider, validerTout, creerConcordanceHistorique, creerAgentsNonRappropries, creerElusNonRappropries, creerDsNonRappropries, horsCommission, cibles,
    items, detail, progression, resoudre, publierItem, publierTout, importerTousLesActes, importerConseilsArchives, attacherDocumentsManquants, ignorerItem, dePublier, dePublierItem, verifierAgents,
    etatFichiers, testerFichiers, lireFichierAir,
    _canonise: canonise, _demo: demo,
  });
  return svc;
}

module.exports = { createAirs, rapprocher, sansCivilite };
