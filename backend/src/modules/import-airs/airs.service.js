/**
 * Import de l'historique AIRS DELIB (section 25 bis, D111, IMP-01 à IMP-20).
 *
 * Trois zones : le SAS (`airs_*`, lignes brutes en JSONB), les CONCORDANCES (valeur AIRS -> entité VibeDélib, validées
 * par l'admin/SCC) et la PUBLICATION (actes historiques). Tant que le MCD d'AIRS n'est pas connu, tout passe par un
 * mapping déclaratif (`airs_source_tables`) : brancher une table AIRS est de la configuration, jamais du code.
 */
const crypto = require('crypto');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const ETATS = ['a_faire', 'proposee', 'automatique', 'manuelle', 'ignoree'];
const REF_KINDS = { type_acte: 'type_acte', nature: 'nature', rubrique: 'rubrique', matiere: 'matiere' };
const BLOQUANTS = ['direction', 'service'];
// champ canonique -> axe de concordance
const CHAMP_AXE = { type: 'type_acte', nature: 'nature', rubrique: 'rubrique', matiere: 'matiere', direction: 'direction', service: 'service', redacteur: 'agent', rapporteur: 'elu', rapporteur_compl: 'elu', instance: 'instance', commission: 'commission' };
const AXES = ['organisme', 'instance', 'direction', 'service', 'agent', 'elu', 'commission', 'type_acte', 'nature', 'rubrique', 'matiere'];
const CANON = ['numero', 'titre', 'objet', 'type', 'nature', 'rubrique', 'matiere', 'direction', 'service', 'redacteur', 'rapporteur', 'rapporteur_compl', 'resultat', 'date', 'expose', 'considere', 'visas', 'dispositif', 'seance', 'instance', 'lieu', 'commission', 'incidence_financiere', 'montant'];

// Catalogue de départ (le MCD d'AIRS étant inconnu, ces tables sont des emplacements à renommer dès réception — Q-AIRS2)
const DEFAULT_MAPPING = [
  { table_name: 'seances', libelle: 'Séances AIRS', entite_cible: 'seance', cle_colonne: 'id', ordre: 1, colonnes: [{ source: 'id', cible: 'numero' }, { source: 'instance', cible: 'instance' }, { source: 'date', cible: 'date' }, { source: 'lieu', cible: 'lieu' }] },
  { table_name: 'rapports', libelle: 'Rapports / dossiers AIRS', entite_cible: 'acte', cle_colonne: 'id', ordre: 2, colonnes: [{ source: 'id', cible: 'numero' }, { source: 'objet', cible: 'titre' }, { source: 'seance', cible: 'seance' }, { source: 'type', cible: 'type' }, { source: 'nature', cible: 'nature' }, { source: 'rubrique', cible: 'rubrique' }, { source: 'matiere', cible: 'matiere' }, { source: 'direction', cible: 'direction' }, { source: 'service', cible: 'service' }, { source: 'redacteur', cible: 'redacteur' }, { source: 'rapporteur', cible: 'rapporteur' }, { source: 'resultat', cible: 'resultat' }, { source: 'expose', cible: 'expose' }, { source: 'considere', cible: 'considere' }, { source: 'dispositif', cible: 'dispositif' }] },
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const str = (v) => (v === null || v === undefined ? '' : String(v));
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex');

function createAirs({ db, audit, dir }) {
  const svc = {};

  // --------------------------------------------------------------------------------------------------------- mapping
  async function ensureMapping(org) {
    if (!(await db.get('SELECT 1 AS x FROM airs_source_tables WHERE organisme_id = $1 LIMIT 1', [org]))) {
      for (const m of DEFAULT_MAPPING) await db.run(
        `INSERT INTO airs_source_tables (organisme_id, table_name, libelle, entite_cible, cle_colonne, colonnes, ordre) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
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
           cle_colonne = EXCLUDED.cle_colonne, colonnes = EXCLUDED.colonnes, obligatoire = EXCLUDED.obligatoire, ordre = EXCLUDED.ordre, actif = EXCLUDED.actif`,
        [o, m.tableName, m.libelle || m.tableName, m.entiteCible || 'brut', m.cleColonne || 'id', JSON.stringify(m.colonnes || []), !!m.obligatoire, Number(m.ordre) || 0, m.actif !== false]);
    }
    await audit.log(ctx, { organismeId: o, action: 'airs.mapping', entity: 'airs_source_tables' });
    return getMapping(ctx, o);
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
    const mapping = await ensureMapping(o);
    const inventaire = {}; let total = 0;
    for (const [table, rows] of Object.entries(data)) {
      const m = mapping.find((x) => x.table_name === table); if (!m) continue;
      if (!Array.isArray(rows)) throw E.badRequest(`« ${table} » doit être une liste de lignes`);
      let n = 0;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const key = str(row[m.cle_colonne] ?? row.id ?? sha(row));
        await db.run(`INSERT INTO airs_raw_rows (import_id, organisme_id, table_name, source_key, payload, empreinte) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
          ON CONFLICT (import_id, table_name, source_key) DO UPDATE SET payload = EXCLUDED.payload, empreinte = EXCLUDED.empreinte`, [importId, o, table, key, JSON.stringify(row), sha(row)]);
        n++; total++;
      }
      inventaire[table] = n;
    }
    await db.run(`UPDATE airs_imports SET statut = 'charge', inventaire = inventaire || $2::jsonb WHERE id = $1`, [importId, JSON.stringify({ tables: inventaire, lignes: total })]);
    await event(o, importId, ctx.username, 'lot.charge', { tables: inventaire, lignes: total });
    return { lot: toLot(await db.get('SELECT * FROM airs_imports WHERE id = $1', [importId])), inventaire };
  }

  /** Jeu d'essai (IMP-19) : permet de dérouler tout le processus en recette sans source réelle. */
  async function chargerDemo(ctx, org, importId) { return charger(ctx, org, importId, { data: demo() }); }

  async function annuler(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    await dePublier(ctx, o, importId);
    await db.run(`UPDATE airs_imports SET statut = 'annule' WHERE id = $1`, [importId]);
    await event(o, importId, ctx.username, 'lot.annule', {});
    return toLot(await db.get('SELECT * FROM airs_imports WHERE id = $1', [importId]));
  }

  // --------------------------------------------------------------------------------------------------------- analyse
  async function analyser(ctx, org, importId) {
    const o = requireOrg(org); const lot = await lotDe(o, importId);
    if (['annule', 'publie'].includes(lot.statut)) throw E.conflict('Lot publié ou annulé : analyse impossible');
    if (await db.get(`SELECT 1 AS x FROM airs_import_items WHERE import_id = $1 AND statut = 'publie' LIMIT 1`, [importId])) throw E.conflict('Des actes sont déjà publiés : annulez la publication avant de réanalyser');
    const mapping = await ensureMapping(o);
    const byTable = new Map(mapping.map((m) => [m.table_name, m]));
    const rows = await db.all('SELECT table_name, source_key, payload FROM airs_raw_rows WHERE import_id = $1 AND organisme_id = $2', [importId, o]);
    await db.run('DELETE FROM airs_import_items WHERE import_id = $1', [importId]);
    let nbSeances = 0; let nbActes = 0;
    for (const kind of ['seance', 'acte']) {
      for (const r of rows) {
        const m = byTable.get(r.table_name); if (!m || m.entite_cible !== kind) continue;
        const payload = canonise(r.payload, m);
        await db.run(`INSERT INTO airs_import_items (import_id, organisme_id, kind, source_key, payload) VALUES ($1,$2,$3,$4,$5::jsonb)`, [importId, o, kind, r.source_key, JSON.stringify(payload)]);
        if (kind === 'seance') nbSeances++; else nbActes++;
      }
    }
    await enregistrerConcordances(o, importId);
    await svc.proposer(o, importId);
    await db.run(`UPDATE airs_imports SET statut = 'concordances', inventaire = inventaire || $2::jsonb WHERE id = $1`, [importId, JSON.stringify({ seances: nbSeances, actes: nbActes })]);
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
    for (const it of items) for (const [champ, axe] of Object.entries(CHAMP_AXE)) {
      const val = it.payload[champ]; if (val === null || val === undefined || str(val).trim() === '') continue;
      const key = `${axe}|${champ}|${norm(val)}`;
      const c = counters.get(key) || { axe, champ, code: str(val), occurrence: 0 }; c.occurrence++; counters.set(key, c);
    }
    for (const c of counters.values()) {
      await db.run(`INSERT INTO airs_concordances (organisme_id, import_id, axe, source_table, source_colonne, source_code, source_libelle, bloquant, occurrence)
        VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)
        ON CONFLICT (COALESCE(import_id, 0), axe, source_table, source_colonne, source_code)
        DO UPDATE SET occurrence = EXCLUDED.occurrence, source_libelle = EXCLUDED.source_libelle`,
      [org, importId, c.axe, 'airs', c.champ, c.code, BLOQUANTS.includes(c.axe), c.occurrence]);
    }
  }

  // ------------------------------------------------------------------------------------------------------ concordances
  /** Propose une cible pour une valeur AIRS (IMP-09) : code identique, libellé normalisé, puis similarité. */
  async function proposeValeur(org, axe, code, libelle) {
    const value = libelle || code; const n = norm(value);
    const tryMatch = (rows, getCode, getLabel) => rows.find((r) => norm(getCode(r)) === norm(code) && code) || rows.find((r) => norm(getLabel(r)) === n);
    if (REF_KINDS[axe]) {
      const rows = await db.all('SELECT id, code, libelle FROM ref_items WHERE kind = $1 AND (organisme_id IS NULL OR organisme_id = $2) ORDER BY organisme_id NULLS LAST', [REF_KINDS[axe], org]);
      const hit = tryMatch(rows, (r) => r.code, (r) => r.libelle);
      return hit && { cibleType: 'ref_items', cibleId: hit.id, cibleCode: hit.code, cibleLibelle: hit.libelle, confiance: norm(hit.code) === norm(code) && code ? 1 : 0.9 };
    }
    if (axe === 'instance') { const rows = await db.all('SELECT id, code, nom FROM instances WHERE organisme_id = $1', [org]); const hit = rows.find((r) => norm(r.code) === norm(code) && code) || rows.find((r) => norm(r.nom) === n); return hit && { cibleType: 'instances', cibleId: hit.id, cibleCode: hit.code, cibleLibelle: hit.nom, confiance: 0.95 }; }
    if (axe === 'commission') { const rows = await db.all('SELECT id, nom FROM commissions WHERE organisme_id = $1', [org]); const hit = rows.find((r) => norm(r.nom) === n); return hit && { cibleType: 'commissions', cibleId: hit.id, cibleCode: null, cibleLibelle: hit.nom, confiance: 0.9 }; }
    if (axe === 'elu') { const rows = await db.all('SELECT id, nom, prenom FROM elus WHERE organisme_id = $1', [org]); const hit = rows.find((r) => norm(`${r.prenom} ${r.nom}`) === n) || rows.find((r) => norm(r.nom) === n); return hit && { cibleType: 'elus', cibleId: hit.id, cibleCode: null, cibleLibelle: `${hit.prenom} ${hit.nom}`.trim(), confiance: 0.85 }; }
    if (axe === 'direction' || axe === 'service') {
      let dirs; try { dirs = await dir.directions(); } catch { dirs = []; }
      if (axe === 'direction') { const hit = dirs.find((d) => norm(d.code) === norm(code) && code) || dirs.find((d) => norm(d.label) === n); return hit && { cibleType: 'directions', cibleCode: hit.code, cibleLibelle: hit.label, confiance: 0.9 }; }
      const hit = dirs.flatMap((d) => (d.services || []).map((s) => ({ ...s, direction: d }))).find((s) => norm(s.code) === norm(code) && code) || dirs.flatMap((d) => (d.services || []).map((s) => ({ ...s, direction: d }))).find((s) => norm(s.label) === n);
      return hit && { cibleType: 'services', cibleCode: hit.code, cibleLibelle: hit.label, confiance: 0.9, meta: { directionCode: hit.direction.code } };
    }
    if (axe === 'agent') {
      const local = await db.get(`SELECT username, display_name FROM agent_ref WHERE username = $1 OR display_name ILIKE $2 LIMIT 1`, [str(code).toLowerCase(), n]);
      if (local) return { cibleType: 'agents', cibleCode: local.username, cibleLibelle: local.display_name || local.username, confiance: norm(local.username) === norm(code) ? 1 : 0.8 };
      try { const hits = await dir.searchLogins(code, 3); if (hits[0]) return { cibleType: 'agents', cibleCode: hits[0].username, cibleLibelle: hits[0].displayName, confiance: hits.length === 1 ? 0.8 : 0.5 }; } catch { /* annuaire indisponible */ }
      return null;
    }
    return null;
  }

  async function proposer(org, importId) {
    const rows = await db.all(`SELECT * FROM airs_concordances WHERE import_id = $1 AND etat = 'a_faire'`, [importId]);
    let n = 0;
    for (const r of rows) {
      const p = await proposeValeur(org, r.axe, r.source_code, r.source_libelle);
      if (!p) continue;
      await db.run(`UPDATE airs_concordances SET etat = $2, cible_type = $3, cible_id = $4, cible_code = $5, cible_libelle = $6, confiance = $7 WHERE id = $1`,
        [r.id, p.confiance >= 0.99 ? 'automatique' : 'proposee', p.cibleType, p.cibleId ?? null, p.cibleCode ?? null, p.cibleLibelle ?? null, p.confiance]);
      n++;
    }
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

  /** Catalogue de cibles proposées à l'écran (référentiels, directions, services, agents, élus, instances, commissions). */
  async function cibles(org, axe, q) {
    const o = requireOrg(org); const like = `%${str(q).replace(/[%_]/g, '')}%`;
    if (REF_KINDS[axe]) return { items: (await db.all(`SELECT id, code, libelle FROM ref_items WHERE kind = $1 AND (organisme_id IS NULL OR organisme_id = $2) AND (code ILIKE $3 OR libelle ILIKE $3) ORDER BY ordre, libelle LIMIT 50`, [REF_KINDS[axe], o, like])).map((r) => ({ id: r.id, code: r.code, libelle: r.libelle })) };
    if (axe === 'instance') return { items: (await db.all(`SELECT id, code, nom AS libelle FROM instances WHERE organisme_id = $1 AND (code ILIKE $2 OR nom ILIKE $2) LIMIT 50`, [o, like])).map((r) => ({ id: r.id, code: r.code, libelle: r.libelle })) };
    if (axe === 'commission') return { items: (await db.all(`SELECT id, nom AS libelle FROM commissions WHERE organisme_id = $1 AND nom ILIKE $2 LIMIT 50`, [o, like])).map((r) => ({ id: r.id, code: null, libelle: r.libelle })) };
    if (axe === 'elu') return { items: (await db.all(`SELECT id, nom, prenom FROM elus WHERE organisme_id = $1 AND (nom ILIKE $2 OR prenom ILIKE $2) LIMIT 50`, [o, like])).map((r) => ({ id: r.id, code: null, libelle: `${r.prenom} ${r.nom}`.trim() })) };
    if (axe === 'direction' || axe === 'service') {
      let dirs; try { dirs = await dir.directions(); } catch { dirs = []; }
      const items = axe === 'direction'
        ? dirs.filter((d) => norm(d.label).includes(norm(q)) || norm(d.code).includes(norm(q))).map((d) => ({ code: d.code, libelle: d.label }))
        : dirs.flatMap((d) => (d.services || []).map((s) => ({ code: s.code, libelle: s.label, direction: d.code }))).filter((s) => norm(s.label).includes(norm(q)) || norm(s.code).includes(norm(q)));
      return { items: items.slice(0, 50) };
    }
    if (axe === 'agent') { const hits = await dir.searchLogins(q, 20).catch(() => []); return { items: hits.map((a) => ({ code: a.username, libelle: a.displayName })) }; }
    if (axe === 'organisme') { const r = await db.get('SELECT id, nom FROM organismes WHERE id = $1', [o]); return { items: [{ code: String(o), libelle: r?.nom || String(o) }] }; }
    return { items: [] };
  }

  // ------------------------------------------------------------------------------------------------------------ items
  async function resoudre(org, importId, item) {
    const p = item.payload;
    const conc = async (axe, val) => (val === undefined || val === null || str(val).trim() === '' ? null : db.get(`SELECT * FROM airs_concordances WHERE import_id = $1 AND axe = $2 AND source_code = $3 AND etat IN ('manuelle', 'automatique') ORDER BY id LIMIT 1`, [importId, axe, str(val)]));
    const [type, nature, rubrique, matiere, direction, service, agent, rapporteur, rapporteurCompl, instance] = await Promise.all([
      conc('type_acte', p.type), conc('nature', p.nature), conc('rubrique', p.rubrique), conc('matiere', p.matiere), conc('direction', p.direction),
      conc('service', p.service), conc('agent', p.redacteur), conc('elu', p.rapporteur), conc('elu', p.rapporteur_compl), conc('instance', p.instance),
    ]);
    let seanceItem = null;
    if (p.seance !== undefined && p.seance !== null && str(p.seance) !== '') seanceItem = await db.get(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'seance' AND source_key = $2`, [importId, str(p.seance)]);
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
        rapporteurId: rapporteur?.cible_id ?? null, rapporteurComplId: rapporteurCompl?.cible_id ?? null, instanceId: instance?.cible_id ?? null,
      }, problemes, seanceItem,
    };
  }

  async function items(ctx, org, importId, { kind } = {}) {
    const o = requireOrg(org); await lotDe(o, importId);
    const p = [importId]; let w = 'import_id = $1'; if (kind) { p.push(kind); w += ` AND kind = $${p.length}`; }
    const rows = await db.all(`SELECT * FROM airs_import_items WHERE ${w} ORDER BY kind DESC, id`, p);
    const out = [];
    for (const r of rows) {
      if (r.kind === 'acte' && r.statut !== 'publie') { const { problemes } = await resoudre(o, importId, r); out.push({ id: r.id, kind: r.kind, statut: problemes.length ? 'en_attente' : 'pret', sourceKey: r.source_key, payload: r.payload, problemes, acteId: r.acte_id, seanceId: r.seance_id, pubieAt: r.pubie_at }); }
      else out.push({ id: r.id, kind: r.kind, statut: r.statut, sourceKey: r.source_key, payload: r.payload, problemes: r.problemes, acteId: r.acte_id, seanceId: r.seance_id, pubieAt: r.pubie_at });
    }
    return { items: out };
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
    await q.run(`INSERT INTO counters (organisme_id, key, value) VALUES ($1, 'airs.numero_suivi', COALESCE((SELECT MAX(numero_suivi) FROM actes WHERE organisme_id = $1), 0)) ON CONFLICT (organisme_id, key) DO NOTHING`, [org]);
    return Number((await q.get(`UPDATE counters SET value = value + 1 WHERE organisme_id = $1 AND key = 'airs.numero_suivi' RETURNING value`, [org])).value);
  }

  const mapResultat = (r) => { const v = norm(r); if (!v) return null; if (v.includes('REJET')) return 'rejete'; if (v.includes('UNANIM')) return 'adopte_unanimite'; if (v.includes('ADOPT')) return 'adopte_majorite'; return null; };

  async function publierSeance(ctx, o, importId, item) {
    const link = await db.get(`SELECT entity_id FROM airs_links WHERE organisme_id = $1 AND kind = 'seance' AND source_key = $2`, [o, item.source_key]);
    if (link) { await db.run(`UPDATE airs_import_items SET seance_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, link.entity_id, ctx.username]); return link.entity_id; }
    const { resolved } = await resoudre(o, importId, item);
    const instanceId = resolved.instanceId ?? (await db.get('SELECT id FROM instances WHERE organisme_id = $1 ORDER BY id LIMIT 1', [o]))?.id;
    if (!instanceId) throw E.incomplete('Aucune instance de séance : paramétrez une instance avant de publier', { missing: [{ code: 'instance', label: 'Instance de séance' }] });
    const date = item.payload.date && !Number.isNaN(Date.parse(item.payload.date)) ? item.payload.date : new Date().toISOString();
    const passe = (await db.get('SELECT mode FROM airs_imports WHERE id = $1', [importId])).mode === 'passes';
    const seance = await db.get(`INSERT INTO seances (organisme_id, instance_id, type, date_seance, lieu, statut, odj_statut, odj_arrete_at, created_by)
      VALUES ($1,$2,'ordinaire',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [o, instanceId, date, item.payload.lieu ?? null, passe ? 'close' : 'planifiee', passe ? 'tenue' : 'en_preparation', passe ? date : null, ctx.username]);
    if (passe) await db.run(`INSERT INTO seance_tenue (seance_id, organisme_id, statut, close_at, close_par, ouverte_par) VALUES ($1,$2,'close',$3,$4,$4) ON CONFLICT (seance_id) DO NOTHING`, [seance.id, o, date, ctx.username]);
    await db.run(`INSERT INTO airs_links (organisme_id, kind, source_key, entity_id, import_id) VALUES ($1,'seance',$2,$3,$4) ON CONFLICT (organisme_id, kind, source_key) DO UPDATE SET entity_id = EXCLUDED.entity_id`, [o, item.source_key, seance.id, importId]);
    await db.run(`UPDATE airs_import_items SET seance_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, seance.id, ctx.username]);
    return seance.id;
  }

  async function publierActe(ctx, o, importId, item) {
    const lot = await db.get('SELECT mode FROM airs_imports WHERE id = $1', [importId]);
    const { resolved, problemes, seanceItem } = await resoudre(o, importId, item);
    if (problemes.length) throw E.incomplete('Item incomplet : résolvez les blocages avant publication', { missing: problemes });
    const link = await db.get(`SELECT entity_id FROM airs_links WHERE organisme_id = $1 AND kind = 'acte' AND source_key = $2`, [o, item.source_key]);
    if (link) { await db.run(`UPDATE actes SET statut = $3 WHERE id = $1 AND organisme_id = $2`, [link.entity_id, o, lot.mode === 'passes' ? 'archive' : 'brouillon']); await db.run(`UPDATE airs_import_items SET acte_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, link.entity_id, ctx.username]); return link.entity_id; }
    const p = item.payload;
    const typeId = resolved.typeId ?? (await db.get(`SELECT id FROM ref_items WHERE kind = 'type_acte' AND code = 'deliberation' AND (organisme_id IS NULL OR organisme_id = $1) ORDER BY organisme_id NULLS LAST LIMIT 1`, [o]))?.id;
    if (!typeId) throw E.incomplete('Type d’acte introuvable', { missing: [{ code: 'type_acte', label: 'Type d’acte' }] });
    const seanceId = seanceItem ? await publierSeance(ctx, o, importId, await db.get('SELECT * FROM airs_import_items WHERE id = $1', [seanceItem.id])) : null;
    const titre = str(p.titre ?? p.objet).trim();
    const statut = lot.mode === 'passes' ? 'archive' : 'brouillon';
    const custom = { airs: { importId, sourceKey: item.source_key, numero: p.numero ?? null, resultat: p.resultat ?? null, direction: p.direction ?? null, service: p.service ?? null } };
    const acte = await db.tx(async (q) => {
      const numeroSuivi = await prochainNumeroSuivi(q, o);
      const a = await q.get(`INSERT INTO actes (organisme_id, numero_suivi, type_id, titre, statut, redacteur, direction_code, direction_label, service_code, service_label,
          nature_id, matiere_id, rubrique_id, incidence_financiere, montant, rapporteur_id, rapporteur_compl_id, seance_id, custom, participants)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,'[]'::jsonb) RETURNING *`,
      [o, numeroSuivi, typeId, titre || `Acte importé ${item.source_key}`, statut, resolved.redacteur || 'import.airs', resolved.directionCode || 'AIRS',
        str(p.direction) || null, resolved.serviceCode || null, str(p.service) || null, resolved.natureId, resolved.matiereId, resolved.rubriqueId,
        p.incidence_financiere ?? null, p.montant ?? null, resolved.rapporteurId, resolved.rapporteurComplId, seanceId, JSON.stringify(custom)]);
      const delib = await q.get(`INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1,1,$2) RETURNING id`, [a.id, titre || 'Délibération']);
      const texts = [['expose', null, str(p.expose)], ['visas', delib.id, str(p.visas ?? p.considere)], ['dispositif', delib.id, str(p.dispositif)]];
      for (const [kind, delibId, markdown] of texts) if (markdown) await q.run(`INSERT INTO tracked_texts (organisme_id, acte_id, deliberation_id, kind, markdown, updated_by) VALUES ($1,$2,$3,$4,$5,$6)`, [o, a.id, delibId, kind, markdown, ctx.username]);
      if (seanceId) {
        const item2 = await q.get(`INSERT INTO seance_items (organisme_id, seance_id, position, kind, acte_id, deliberation_id, titre, numero, statut, created_by)
          SELECT $1,$2, COALESCE(MAX(position),0)+1, 'deliberation', $3,$4,$5,$6, $7, $8 FROM seance_items WHERE seance_id = $2 RETURNING *`, [o, seanceId, a.id, delib.id, titre, str(p.numero) || null, statut === 'archive' ? 'a_traiter' : 'a_traiter', ctx.username]);
        const res = mapResultat(p.resultat);
        await q.run(`INSERT INTO seance_points (item_id, seance_id, etat, resultat, close_at, close_par) VALUES ($1,$2,$3,$4,$5,$6)`,
          [item2.id, seanceId, statut === 'archive' ? 'traite' : 'a_traiter', statut === 'archive' ? (res || 'adopte_majorite') : null, statut === 'archive' ? new Date().toISOString() : null, statut === 'archive' ? ctx.username : null]);
      }
      return a;
    });
    await db.run(`INSERT INTO airs_links (organisme_id, kind, source_key, entity_id, import_id) VALUES ($1,'acte',$2,$3,$4) ON CONFLICT (organisme_id, kind, source_key) DO UPDATE SET entity_id = EXCLUDED.entity_id`, [o, item.source_key, acte.id, importId]);
    await db.run(`UPDATE airs_import_items SET acte_id = $2, statut = 'publie', pubie_at = now(), pubie_par = $3 WHERE id = $1`, [item.id, acte.id, ctx.username]);
    await event(o, importId, ctx.username, 'acte.publie', { sourceKey: item.source_key, acteId: acte.id });
    return acte.id;
  }

  async function publierItem(ctx, org, importId, itemId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const item = await db.get(`SELECT * FROM airs_import_items WHERE id = $1 AND import_id = $2`, [itemId, importId]);
    if (!item) throw E.notFound('Item introuvable');
    if (item.kind !== 'acte') throw E.badRequest('Seuls les actes se publient explicitement');
    const acteId = await publierActe(ctx, o, importId, item);
    await majStatutLot(o, importId);
    return { acteId, item: { ...item, statut: 'publie', acte_id: acteId } };
  }

  async function publierTout(ctx, org, importId) {
    const o = requireOrg(org); await lotDe(o, importId);
    const result = { publies: 0, ignores: [] };
    const seances = await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'seance' AND statut != 'publie'`, [importId]);
    for (const s of seances) { try { await publierSeance(ctx, o, importId, s); } catch { /* séance sans instance : signalée via les actes */ } }
    const actes = await db.all(`SELECT * FROM airs_import_items WHERE import_id = $1 AND kind = 'acte' AND statut != 'publie' ORDER BY id`, [importId]);
    for (const a of actes) { try { await publierActe(ctx, o, importId, a); result.publies++; } catch (e) { result.ignores.push({ sourceKey: a.source_key, motif: e.message, missing: e.details?.missing || null }); } }
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

  async function majStatutLot(org, importId) {
    const r = await db.get(`SELECT count(*) FILTER (WHERE statut = 'publie')::int AS p, count(*) FILTER (WHERE statut != 'publie' AND statut != 'ignore')::int AS reste FROM airs_import_items WHERE import_id = $1`, [importId]);
    const statut = r.p > 0 && r.reste === 0 ? 'publie' : 'concordances';
    await db.run(`UPDATE airs_imports SET statut = $2 WHERE id = $1 AND statut != 'annule'`, [importId, statut]);
  }

  // ---------------------------------------------------------------------------------------------------------- agents
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

  Object.assign(svc, {
    AXES, ETATS, BLOQUANTS, REF_KINDS, CHAMP_AXE, DEFAULT_MAPPING,
    getMapping, setMapping, creerLot, lister, charger, chargerDemo, annuler,
    analyser, proposer, concordances, decider, cibles,
    items, detail, resoudre, publierItem, publierTout, ignorerItem, dePublier, verifierAgents,
    _canonise: canonise, _demo: demo,
  });
  return svc;
}

module.exports = { createAirs };
