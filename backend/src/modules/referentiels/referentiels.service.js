/**
 * Référentiels avec héritage (MOR-10) : un jeu COMMUN (organisme_id NULL) que chaque organisme peut hériter, désactiver,
 * renommer (ref_overrides) ou compléter par ses propres valeurs. Les autres organismes ne sont jamais affectés.
 */
const fs = require('fs');
const path = require('path');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { NATURES, RUBRIQUES, TYPES_ACTE, ANNEXE_TYPES } = require('./seeds');
const { parseMatieres, compareCodes } = require('./matieres');

const KINDS = ['type_acte', 'nature', 'rubrique', 'matiere', 'annexe_type'];
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const toItem = (r) => ({
  id: r.id, kind: r.kind, code: r.code, libelle: r.o_libelle ?? r.libelle, parentCode: r.parent_code, niveau: r.niveau, ordre: r.ordre,
  actif: r.o_actif ?? r.actif, origine: r.organisme_id ? 'organisme' : 'commun', organismeId: r.organisme_id, meta: r.meta,
});

function createReferentiels({ db, audit }) {
  const svc = {
    KINDS,

    /** Valeurs d'un référentiel telles que les voit un organisme (héritage + surcharges), triées. */
    async list(kind, organismeId, { includeInactive = false } = {}) {
      const org = requireOrg(organismeId);
      const rows = await db.all(
        `SELECT r.*, o.actif AS o_actif, o.libelle AS o_libelle FROM ref_items r
         LEFT JOIN ref_overrides o ON o.ref_id = r.id AND o.organisme_id = $2
         WHERE r.kind = $1 AND (r.organisme_id IS NULL OR r.organisme_id = $2)`, [kind, org]);
      // une valeur propre à l'organisme masque la valeur commune de même code
      const byCode = new Map();
      for (const it of rows.map(toItem)) if (!byCode.has(it.code) || it.origine === 'organisme') byCode.set(it.code, it);
      let items = [...byCode.values()];
      if (!includeInactive) items = items.filter((i) => i.actif);
      if (kind === 'matiere') {
        items.sort((a, b) => compareCodes(a.code, b.code));
        const parents = new Set(items.map((i) => i.parentCode).filter(Boolean));
        items.forEach((i) => { i.feuille = !parents.has(i.code); });
      } else {
        items.sort((a, b) => a.ordre - b.ordre || norm(a.libelle).localeCompare(norm(b.libelle)));
      }
      return items;
    },

    /** Arbre des matières (MAT-04) ; par défaut seules les feuilles sont sélectionnables. */
    async matiereTree(organismeId) {
      const items = await svc.list('matiere', organismeId);
      const byCode = new Map(items.map((i) => [i.code, { ...i, enfants: [], selectionnable: i.feuille }]));
      const roots = [];
      for (const n of byCode.values()) {
        const parent = n.parentCode && byCode.get(n.parentCode);
        (parent ? parent.enfants : roots).push(n);
      }
      return roots;
    },

    /** Valeur active et disponible pour l'organisme, ou erreur (validation des identifiants d'une fiche). */
    async require(kind, id, organismeId, { leaf = false } = {}) {
      const items = await svc.list(kind, organismeId);
      const it = items.find((i) => i.id === Number(id));
      if (!it) throw E.badRequest(`Valeur de référentiel « ${kind} » inconnue ou inactive pour cet organisme (id ${id})`);
      if (leaf && kind === 'matiere' && !it.feuille) throw E.badRequest(`La matière ${it.code} a des sous-niveaux : choisir une matière plus précise`);
      return it;
    },

    async byCode(kind, code, organismeId) { return (await svc.list(kind, organismeId, { includeInactive: true })).find((i) => i.code === code) || null; },

    async create(ctx, { kind, organismeId = null, code, libelle, parentCode = null, ordre = 0, meta = {} }) {
      if (!KINDS.includes(kind)) throw E.badRequest('Référentiel inconnu');
      try {
        const niveau = kind === 'matiere' ? String(code).split('.').length : null;
        const r = await db.get(
          `INSERT INTO ref_items (kind, organisme_id, code, libelle, parent_code, niveau, ordre, meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
          [kind, organismeId, code, libelle, parentCode, niveau, ordre, JSON.stringify(meta)]);
        await audit.log(ctx, { organismeId, action: 'referentiel.create', entity: 'ref_items', entityId: r.id, after: toItem(r) });
        return toItem(r);
      } catch (e) {
        if (e.code === '23505') throw E.conflict(`Le code « ${code} » existe déjà dans ce référentiel`);
        throw e;
      }
    },

    /** Modifie une valeur PROPRE à l'organisme (ou commune si organismeScope = null, réservé aux administrateurs de plateforme). */
    async update(ctx, id, organismeScope, patch) {
      const before = await db.get('SELECT * FROM ref_items WHERE id = $1', [id]);
      if (!before || (before.organisme_id ?? null) !== (organismeScope ?? null)) throw E.notFound('Valeur introuvable à ce niveau (pour une valeur commune, utiliser la surcharge)');
      const r = await db.get(
        `UPDATE ref_items SET libelle = COALESCE($2, libelle), ordre = COALESCE($3, ordre), actif = COALESCE($4, actif),
           meta = COALESCE($5::jsonb, meta) WHERE id = $1 RETURNING *`,
        [id, patch.libelle ?? null, patch.ordre ?? null, patch.actif ?? null, patch.meta ? JSON.stringify(patch.meta) : null]);
      await audit.log(ctx, { organismeId: organismeScope, action: 'referentiel.update', entity: 'ref_items', entityId: id, before: toItem(before), after: toItem(r) });
      return toItem(r);
    },

    /** Un organisme masque ou renomme une valeur COMMUNE sans toucher aux autres (MOR-10). */
    async setOverride(ctx, organismeId, refId, { actif, libelle }) {
      const org = requireOrg(organismeId);
      const ref = await db.get('SELECT * FROM ref_items WHERE id = $1 AND organisme_id IS NULL', [refId]);
      if (!ref) throw E.notFound('Valeur commune introuvable');
      await db.run(
        `INSERT INTO ref_overrides (ref_id, organisme_id, actif, libelle) VALUES ($1,$2,$3,$4)
         ON CONFLICT (ref_id, organisme_id) DO UPDATE SET actif = COALESCE(EXCLUDED.actif, ref_overrides.actif), libelle = COALESCE(EXCLUDED.libelle, ref_overrides.libelle)`,
        [refId, org, actif ?? null, libelle ?? null]);
      await audit.log(ctx, { organismeId: org, action: 'referentiel.override', entity: 'ref_overrides', entityId: refId, after: { actif, libelle } });
      return (await svc.list(ref.kind, org, { includeInactive: true })).find((i) => i.id === refId);
    },

    /** Import idempotent de la nomenclature des matières (jeu commun ou propre à un organisme). */
    async importMatieres(ctx, text, organismeId = null) {
      const parsed = parseMatieres(text);
      if (!parsed.items.length) throw E.badRequest('Aucune matière reconnue dans le fichier');
      let created = 0; let updated = 0; let unchanged = 0;
      await db.tx(async (q) => {
        for (const it of parsed.items) {
          const cur = await q.get("SELECT * FROM ref_items WHERE kind = 'matiere' AND COALESCE(organisme_id, 0) = COALESCE($1, 0) AND code = $2", [organismeId, it.code]);
          if (!cur) {
            await q.run("INSERT INTO ref_items (kind, organisme_id, code, libelle, parent_code, niveau, ordre) VALUES ('matiere',$1,$2,$3,$4,$5,$6)",
              [organismeId, it.code, it.libelle, it.parentCode, it.niveau, it.ordre]); created++;
          } else if (cur.libelle !== it.libelle || cur.ordre !== it.ordre || cur.parent_code !== it.parentCode) {
            await q.run('UPDATE ref_items SET libelle = $2, ordre = $3, parent_code = $4, niveau = $5 WHERE id = $1', [cur.id, it.libelle, it.ordre, it.parentCode, it.niveau]); updated++;
          } else unchanged++;
        }
      });
      const report = { total: parsed.items.length, created, updated, unchanged, corrections: parsed.corrections, ignored: parsed.ignored, orphans: parsed.orphans, duplicates: parsed.duplicates };
      await audit.log(ctx, { organismeId, action: 'referentiel.import_matieres', entity: 'ref_items', after: { ...report, corrections: report.corrections.length, ignored: report.ignored.length } });
      return report;
    },

    /** Jeux communs au premier démarrage (idempotent). */
    async ensureSeeds(log) {
      const ins = (kind, code, libelle, ordre, meta = {}) => db.run(
        `INSERT INTO ref_items (kind, organisme_id, code, libelle, ordre, meta) VALUES ($1, NULL, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING`,
        [kind, code, libelle, ordre, JSON.stringify(meta)]);
      const has = async (kind) => (await db.get('SELECT count(*)::int AS n FROM ref_items WHERE kind = $1 AND organisme_id IS NULL', [kind])).n > 0;
      if (!(await has('nature'))) for (const [i, [code, lib]] of NATURES.entries()) await ins('nature', code, lib, i + 1);
      if (!(await has('rubrique'))) for (const [i, lib] of RUBRIQUES.entries()) await ins('rubrique', 'r' + String(i + 1).padStart(2, '0'), lib, i + 1);
      if (!(await has('type_acte'))) for (const [i, t] of TYPES_ACTE.entries()) await ins('type_acte', t.code, t.libelle, i + 1, t.meta);
      if (!(await has('annexe_type'))) for (const [i, [code, lib]] of ANNEXE_TYPES.entries()) await ins('annexe_type', code, lib, i + 1);
      if (!(await has('matiere'))) {
        const file = path.resolve(__dirname, '../../../seeds/matieres.txt');
        if (fs.existsSync(file)) { const r = await svc.importMatieres({ username: 'system' }, fs.readFileSync(file, 'utf8'), null); log?.info({ matieres: r.total, corrections: r.corrections.length }, 'nomenclature des matières importée'); }
      }
    },
  };
  return svc;
}

module.exports = { createReferentiels, KINDS };
