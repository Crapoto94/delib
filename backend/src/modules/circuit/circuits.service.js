/**
 * Éditeur de circuit (section 9.6 bis, CIR-60 à CIR-69) : définitions par organisme (et par type d'acte / direction),
 * versions brouillon -> publiée -> archivée, contrôles de cohérence, simulation, comparaison, retour à une version
 * antérieure, import / export, effet de la publication sur les actes en cours.
 * Modifiable par l'administrateur d'organisme ET par le SCC (D26). L'historique d'un acte référence toujours la version
 * qui l'a produit : publier ne modifie jamais le passé (CIR-69).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const G = require('./graph');
const { TEMPLATES } = require('./templates');
const { IN_CIRCUIT } = require('./engine');

const toDef = (r, v) => ({
  id: r.id, code: r.code, nom: r.nom, typeActeId: r.type_acte_id, directionCode: r.direction_code, activeVersionId: r.active_version_id,
  activeVersion: v ? { id: v.id, version: v.version_no, publishedAt: v.published_at, publishedBy: v.published_by } : null,
});
const toVer = (r) => ({ id: r.id, definitionId: r.definition_id, version: r.version_no, status: r.status, comment: r.comment, createdBy: r.created_by, createdAt: r.created_at, publishedAt: r.published_at, publishedBy: r.published_by });

function createCircuits({ db, audit, engine, titulaires, bus }) {
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const svc = {
    templates: () => Object.entries(TEMPLATES).map(([code, t]) => ({ code, nom: t.nom, steps: t.graph.steps.length })),

    async def(organismeId, id) {
      const d = await db.get('SELECT * FROM circuit_definitions WHERE id = $1 AND organisme_id = $2', [id, requireOrg(organismeId)]);
      if (!d) throw E.notFound('Circuit introuvable');
      return d;
    },
    async version(organismeId, id, n) {
      const d = await svc.def(organismeId, id);
      const v = await db.get('SELECT * FROM circuit_versions WHERE definition_id = $1 AND version_no = $2', [d.id, n]);
      if (!v) throw E.notFound('Version introuvable');
      return { d, v };
    },

    async list(organismeId) {
      const org = requireOrg(organismeId);
      const defs = await db.all('SELECT * FROM circuit_definitions WHERE organisme_id = $1 ORDER BY nom', [org]);
      const out = [];
      for (const d of defs) {
        const vs = await db.all('SELECT * FROM circuit_versions WHERE definition_id = $1 ORDER BY version_no DESC', [d.id]);
        out.push({ ...toDef(d, vs.find((x) => x.id === d.active_version_id)), versions: vs.map(toVer) });
      }
      return out;
    },

    async groupCodes(organismeId) { return new Set((await titulaires.groups(organismeId)).map((g) => g.code)); },

    /** Crée une définition avec une première version brouillon (à partir d'un modèle, d'un graphe importé, ou vide). */
    async create(ctx, organismeId, { code, nom, typeActeId = null, directionCode = null, fromTemplate, graph }) {
      const org = requireOrg(organismeId);
      const g = graph ? clone(graph) : (fromTemplate ? clone(TEMPLATES[fromTemplate]?.graph || null) : { start: 'redaction', steps: [{ key: 'redaction', label: 'Rédaction', resolver: { kind: 'redacteur' }, canEdit: true }], transitions: [] });
      if (!g) throw E.badRequest(`Modèle inconnu : ${fromTemplate}`);
      if (typeActeId) { const t = await db.get("SELECT 1 AS x FROM ref_items WHERE id = $1 AND kind = 'type_acte'", [typeActeId]); if (!t) throw E.badRequest("Type d'acte inconnu"); }
      try {
        const { def, ver } = await db.tx(async (q) => {
          const d = await q.get('INSERT INTO circuit_definitions (organisme_id, code, nom, type_acte_id, direction_code, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [org, code, nom, typeActeId, directionCode, ctx.username]);
          const v = await q.get("INSERT INTO circuit_versions (definition_id, version_no, status, graph, comment, created_by) VALUES ($1, 1, 'draft', $2::jsonb, $3, $4) RETURNING *", [d.id, JSON.stringify(g), fromTemplate ? `Modèle ${fromTemplate}` : 'Version initiale', ctx.username]);
          return { def: d, ver: v };
        });
        if (fromTemplate && TEMPLATES[fromTemplate]) await svc.ensureGroups(ctx, org, TEMPLATES[fromTemplate].groupes);
        await audit.log(ctx, { organismeId: org, action: 'circuit.create', entity: 'circuit_definitions', entityId: def.id, after: { code, nom, fromTemplate: fromTemplate || null } });
        return { ...toDef(def, null), versions: [toVer(ver)] };
      } catch (e) { if (e.code === '23505') throw E.conflict(`Le circuit « ${code} » existe déjà`); throw e; }
    },

    async ensureGroups(ctx, organismeId, groupes) {
      const existing = await svc.groupCodes(organismeId);
      for (const [code, nom] of groupes) if (!existing.has(code)) await titulaires.createGroup(ctx, organismeId, { code, nom });
    },

    async get(organismeId, id) {
      const d = await svc.def(organismeId, id);
      const vs = await db.all('SELECT * FROM circuit_versions WHERE definition_id = $1 ORDER BY version_no DESC', [d.id]);
      return { ...toDef(d, vs.find((x) => x.id === d.active_version_id)), versions: vs.map(toVer) };
    },
    async getVersion(organismeId, id, n) { const { v } = await svc.version(organismeId, id, n); return { ...toVer(v), graph: v.graph }; },

    async updateDraft(ctx, organismeId, id, n, graph) {
      const { d, v } = await svc.version(organismeId, id, n);
      if (v.status !== 'draft') throw E.conflict("Seul un brouillon est modifiable : créez une nouvelle version à partir de celle-ci");
      const r = await db.get('UPDATE circuit_versions SET graph = $2::jsonb WHERE id = $1 RETURNING *', [v.id, JSON.stringify(graph)]);
      await audit.log(ctx, { organismeId: d.organisme_id, action: 'circuit.draft_update', entity: 'circuit_versions', entityId: v.id, before: { steps: v.graph.steps?.length }, after: { steps: graph.steps?.length } });
      return { ...toVer(r), graph: r.graph };
    },

    /** Nouvelle version brouillon copiée depuis une version existante (modification ou retour à une version antérieure, CIR-63). */
    async newDraft(ctx, organismeId, id, fromVersion, comment) {
      const d = await svc.def(organismeId, id);
      const src = await db.get('SELECT * FROM circuit_versions WHERE definition_id = $1 AND version_no = $2', [d.id, fromVersion ?? (await db.get('SELECT max(version_no) AS n FROM circuit_versions WHERE definition_id = $1', [d.id])).n]);
      if (!src) throw E.notFound('Version source introuvable');
      const next = (await db.get('SELECT max(version_no) + 1 AS n FROM circuit_versions WHERE definition_id = $1', [d.id])).n;
      const v = await db.get("INSERT INTO circuit_versions (definition_id, version_no, status, graph, comment, created_by) VALUES ($1,$2,'draft',$3::jsonb,$4,$5) RETURNING *", [d.id, next, JSON.stringify(src.graph), comment || `Copie de la version ${src.version_no}`, ctx.username]);
      await audit.log(ctx, { organismeId: d.organisme_id, action: 'circuit.new_draft', entity: 'circuit_versions', entityId: v.id, after: { version: next, from: src.version_no } });
      return { ...toVer(v), graph: v.graph };
    },

    async validate(organismeId, id, n) {
      const { d, v } = await svc.version(organismeId, id, n);
      const r = G.validateGraph(v.graph, { groupCodes: await svc.groupCodes(d.organisme_id) });
      return { version: v.version_no, ...r };
    },

    /** « Pour ce cas, qui serait désigné à chaque étape ? » avant publication (CIR-62). */
    async simulate(organismeId, id, n, input) {
      const { d, v } = await svc.version(organismeId, id, n);
      const check = G.validateGraph(v.graph, { groupCodes: await svc.groupCodes(d.organisme_id) });
      if (!check.ok) throw E.conflict('Le graphe est invalide : corrigez-le avant de simuler', check.errors);
      const typeCode = input.typeActeId ? (await db.get('SELECT code FROM ref_items WHERE id = $1', [input.typeActeId]))?.code : (d.type_acte_id ? (await db.get('SELECT code FROM ref_items WHERE id = $1', [d.type_acte_id]))?.code : 'deliberation');
      return engine.simulate(d.organisme_id, v.graph, { typeCode, directionCode: input.directionCode, serviceCode: input.serviceCode, redacteur: input.redacteur, facts: input.facts || {} });
    },

    /** Publie une version : contrôles bloquants, archivage de la précédente, effet sur les actes en cours (CIR-64). */
    async publish(ctx, organismeId, id, n, { comment, effect = 'nouveaux-seulement', mapping = {} } = {}) {
      const { d, v } = await svc.version(organismeId, id, n);
      if (v.status !== 'draft') throw E.conflict('Seul un brouillon se publie');
      const check = G.validateGraph(v.graph, { groupCodes: await svc.groupCodes(d.organisme_id) });
      if (!check.ok) throw E.conflict('Publication refusée : le circuit comporte des erreurs', check.errors);
      const prevId = d.active_version_id;
      let inflight = [];
      if (prevId) inflight = await db.all(`SELECT id, current_step_key, adhoc_steps FROM actes WHERE circuit_version_id = $1 AND current_step_key IS NOT NULL AND statut = ANY($2::text[])`, [prevId, IN_CIRCUIT]);
      const keys = new Set(v.graph.steps.map((s) => s.key));
      let migrate = [];
      if (effect === 'migrer' && inflight.length) {
        const unmapped = [];
        for (const a of inflight) {
          if ((a.adhoc_steps || []).some((x) => x.key === a.current_step_key)) continue; // étape ponctuelle : reste telle quelle
          const target = keys.has(a.current_step_key) ? a.current_step_key : mapping[a.current_step_key];
          if (!target || !keys.has(target)) unmapped.push({ acteId: a.id, etape: a.current_step_key });
        }
        if (unmapped.length) throw E.conflict('Des actes en cours sont dans une étape supprimée : fournissez une correspondance (mapping) ancienne étape → nouvelle étape', { unmapped });
        migrate = inflight;
      }
      await db.tx(async (q) => {
        if (prevId) await q.run("UPDATE circuit_versions SET status = 'archived' WHERE id = $1", [prevId]);
        await q.run("UPDATE circuit_versions SET status = 'published', published_at = now(), published_by = $2, comment = COALESCE($3, comment) WHERE id = $1", [v.id, ctx.username, comment || null]);
        await q.run('UPDATE circuit_definitions SET active_version_id = $2 WHERE id = $1', [d.id, v.id]);
        for (const a of migrate) {
          if ((a.adhoc_steps || []).some((x) => x.key === a.current_step_key)) { await q.run('UPDATE actes SET circuit_version_id = $2 WHERE id = $1', [a.id, v.id]); continue; }
          const target = keys.has(a.current_step_key) ? a.current_step_key : mapping[a.current_step_key];
          await q.run("UPDATE actes SET circuit_version_id = $2, current_step_key = $3 WHERE id = $1", [a.id, v.id, target]);
          await q.run('UPDATE step_instances SET step_key = $3, label = COALESCE($4, label) WHERE acte_id = $1 AND status = \'current\' AND step_key = $2', [a.id, a.current_step_key, target, v.graph.steps.find((s) => s.key === target)?.label]);
          await q.run("INSERT INTO step_events (acte_id, actor, action, from_step, to_step, meta) VALUES ($1,$2,'migrate',$3,$4,$5::jsonb)", [a.id, ctx.username, a.current_step_key, target, JSON.stringify({ version: v.version_no })]);
        }
      });
      for (const a of migrate) { await engine.recompute(a.id, ctx); }
      await audit.log(ctx, { organismeId: d.organisme_id, action: 'circuit.publish', entity: 'circuit_versions', entityId: v.id, after: { version: v.version_no, effect, actesEnCours: inflight.length, migres: migrate.length, comment } });
      await bus.emit('circuit.published', { organismeId: d.organisme_id, definitionId: d.id, version: v.version_no, ctx });
      return { ...(await svc.get(organismeId, id)), effect, inflight: inflight.length, migrated: migrate.length, warnings: check.warnings };
    },

    /** Compare deux versions : étapes et transitions ajoutées, retirées, modifiées. */
    async diff(organismeId, id, a, b) {
      const { v: va } = await svc.version(organismeId, id, a); const { v: vb } = await svc.version(organismeId, id, b);
      const byKey = (g) => Object.fromEntries(g.steps.map((s) => [s.key, s]));
      const A = byKey(va.graph); const B = byKey(vb.graph);
      const tk = (t) => `${t.from}->${t.to}:${JSON.stringify(t.when || null)}:${t.otherwise ? 'o' : ''}`;
      const TA = new Set(va.graph.transitions.map(tk)); const TB = new Set(vb.graph.transitions.map(tk));
      return {
        from: a, to: b,
        stepsAdded: Object.keys(B).filter((k) => !A[k]), stepsRemoved: Object.keys(A).filter((k) => !B[k]),
        stepsChanged: Object.keys(B).filter((k) => A[k] && JSON.stringify(A[k]) !== JSON.stringify(B[k])).map((k) => ({ key: k, before: A[k], after: B[k] })),
        transitionsAdded: [...TB].filter((t) => !TA.has(t)), transitionsRemoved: [...TA].filter((t) => !TB.has(t)),
        startChanged: va.graph.start !== vb.graph.start,
      };
    },

    async export(organismeId, id, n) {
      const d = await svc.def(organismeId, id);
      const v = await db.get('SELECT * FROM circuit_versions WHERE definition_id = $1 AND version_no = $2', [d.id, n ?? (await db.get('SELECT version_no FROM circuit_versions WHERE id = $1', [d.active_version_id]))?.version_no ?? 1]);
      if (!v) throw E.notFound('Version introuvable');
      return { format: 'vibedelib.circuit/1', nom: d.nom, code: d.code, version: v.version_no, graph: v.graph };
    },

    /** Circuit d'exemple pour l'organisme par défaut au premier démarrage (« jeu de données initial », CIR-04). */
    async ensureDefaults(orgId) {
      const n = (await db.get('SELECT count(*)::int AS n FROM circuit_definitions WHERE organisme_id = $1', [orgId])).n;
      if (n) return false;
      const ctx = { username: 'system' };
      const c = await svc.create(ctx, orgId, { code: 'ivry-standard', nom: TEMPLATES['ivry-standard'].nom, fromTemplate: 'ivry-standard' });
      await svc.publish(ctx, orgId, c.id, 1, { comment: 'Circuit initial (workflow.png)' });
      return true;
    },
  };
  return svc;
}

module.exports = { createCircuits };
