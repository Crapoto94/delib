/**
 * Fiche d'acte (dossier) : création, lecture, modification, abandon, duplication, délibérations, complétude.
 * Le rédacteur, la direction et le service sont déduits de l'identité RH ; la direction porteuse détermine le circuit (DRO-03).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { nextCounter } = require('../../shared/infra');

const DRIVERS = ['incidenceFinanciere', 'montant', 'typeId'];
const toActe = (r) => r && ({
  id: r.id, organismeId: r.organisme_id, numeroSuivi: r.numero_suivi, typeId: r.type_id, titre: r.titre, statut: r.statut,
  redacteur: r.redacteur, coRedacteurs: r.co_redacteurs,
  direction: { code: r.direction_code, label: r.direction_label }, service: r.service_code || r.service_label ? { code: r.service_code, label: r.service_label } : null,
  natureId: r.nature_id, matiereId: r.matiere_id, rubriqueId: r.rubrique_id, incidenceFinanciere: r.incidence_financiere,
  montant: r.montant === null ? null : Number(r.montant), rapporteurId: r.rapporteur_id, rapporteurComplId: r.rapporteur_compl_id,
  seanceViseeId: r.seance_visee_id, seanceId: r.seance_id, urgence: r.urgence, dateLimite: r.date_limite, confidentialite: r.confidentialite,
  commentaireInitial: r.commentaire_initial, custom: r.custom, currentStepKey: r.current_step_key, participants: r.participants,
  submittedAt: r.submitted_at, abandonedAt: r.abandoned_at, abandonMotif: r.abandon_motif, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toDelib = (r) => ({ id: r.id, acteId: r.acte_id, ordre: r.ordre, titre: r.titre });

function createActes({ db, audit, refs, redaction, dir, acl, bus, late }) {
  const svc = {
    toActe,

    async raw(organismeId, id) {
      const a = await db.get('SELECT * FROM actes WHERE id = $1 AND organisme_id = $2', [id, requireOrg(organismeId)]);
      if (!a) throw E.notFound('Acte introuvable');
      return a;
    },

    /** Charge un acte et vérifie que l'utilisateur peut le voir (404 sinon : on ne révèle pas l'existence). */
    async load(ctx, organismeId, id, { edit = false } = {}) {
      const a = await svc.raw(organismeId, id);
      if (!(await acl.canView(ctx, a))) throw E.notFound('Acte introuvable');
      if (edit && !(await acl.canEdit(ctx, a))) throw E.forbidden("Vous ne pouvez pas modifier cet acte à ce stade");
      return a;
    },

    async labels(directionCode, serviceCode, agent) {
      let dl = null; let sl = null;
      try {
        const d = (await dir.directions()).find((x) => x.code === directionCode);
        dl = d?.label || null; sl = d?.services.find((s) => s.code === serviceCode)?.label || null;
        if (!d && (await dir.directions()).length) throw E.badRequest(`Direction inconnue de l'organigramme : ${directionCode}`);
      } catch (e) { if (e.status === 400) throw e; }
      if (!dl && agent?.direction_code === directionCode) dl = agent.direction_label;
      if (!sl && agent?.service_code === serviceCode) sl = agent.service_label;
      return { directionLabel: dl, serviceLabel: sl };
    },

    /** Références vers les élus (rapporteurs) et la séance visée : elles doivent appartenir à l'organisme (isolation). */
    async checkRefs(org, b) {
      if (b.rapporteurId) await late.elus.assertExists(org, b.rapporteurId);
      if (b.rapporteurComplId) await late.elus.assertExists(org, b.rapporteurComplId);
      if (b.seanceViseeId) await late.seances.assertViseable(org, b.seanceViseeId);
    },

    async create(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      const type = await refs.require('type_acte', b.typeId, org);
      const directionCode = b.directionCode || ctx.agent?.direction_code;
      if (!directionCode) throw E.badRequest('Direction porteuse à préciser (aucune direction connue pour votre profil)');
      const own = ctx.agent?.direction_code === directionCode;
      const serviceCode = b.serviceCode ?? (own ? ctx.agent.service_code : null);
      if (!serviceCode && !own && !ctx.isPlatformAdmin) throw E.badRequest("Service porteur à préciser (vous n'appartenez pas à cette direction, DRO-08)");
      const perm = await redaction.canDraft(ctx, org, directionCode, serviceCode);
      if (!perm.ok) throw E.forbidden("Vous n'êtes pas autorisé à rédiger pour cette direction");
      const { directionLabel, serviceLabel } = await svc.labels(directionCode, serviceCode, ctx.agent);

      const natureId = b.natureId ? (await refs.require('nature', b.natureId, org)).id
        : (type.meta?.natureCode ? (await refs.byCode('nature', type.meta.natureCode, org))?.id ?? null : null);
      const matiereId = b.matiereId ? (await refs.require('matiere', b.matiereId, org, { leaf: true })).id : null;
      const rubriqueId = b.rubriqueId ? (await refs.require('rubrique', b.rubriqueId, org)).id : null;

      await svc.checkRefs(org, b);
      const acte = await db.tx(async (q) => {
        const numero = await nextCounter(q, org, 'acte');
        const a = await q.get(
          `INSERT INTO actes (organisme_id, numero_suivi, type_id, titre, redacteur, direction_code, direction_label, service_code, service_label,
             nature_id, matiere_id, rubrique_id, incidence_financiere, montant, rapporteur_id, rapporteur_compl_id, seance_visee_id,
             urgence, date_limite, confidentialite, commentaire_initial, custom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb) RETURNING *`,
          [org, numero, type.id, b.titre, ctx.username, directionCode, directionLabel, serviceCode, serviceLabel, natureId, matiereId, rubriqueId,
            b.incidenceFinanciere ?? null, b.montant ?? null, b.rapporteurId ?? null, b.rapporteurComplId ?? null, b.seanceViseeId ?? null,
            !!b.urgence, b.dateLimite ?? null, b.confidentialite || 'normale', b.commentaire ?? null, JSON.stringify(b.custom || {})]);
        const n = Math.max(1, type.meta?.minDeliberations ?? 1);
        for (let i = 1; i <= n; i++) await q.run('INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1,$2,$3)', [a.id, i, n === 1 ? b.titre : `${b.titre} (${i})`]);
        return a;
      });
      await audit.log(ctx, { organismeId: org, action: 'acte.create', entity: 'actes', entityId: acte.id, after: { numeroSuivi: acte.numero_suivi, titre: acte.titre, direction: directionCode, via: perm.via } });
      await bus.emit('acte.created', { organismeId: org, acteId: acte.id, ctx });
      return toActe(acte);
    },

    async deliberations(acteId) { return (await db.all('SELECT * FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [acteId])).map(toDelib); },

    async get(ctx, organismeId, id) {
      const a = await svc.load(ctx, organismeId, id);
      const [delibs, editable] = await Promise.all([svc.deliberations(a.id), acl.canEdit(ctx, a)]);
      const comp = await svc.completeness(a);
      return { ...toActe(a), deliberations: delibs, droits: { modifier: editable, administrer: acl.isAdmin(ctx, a.organisme_id) }, completude: comp, odj: late.odj ? await late.odj.positionsOf(a.id) : [] };
    },

    async list(ctx, organismeId, f = {}) {
      const org = requireOrg(organismeId);
      const vis = await acl.visibilitySql(ctx, org, 2);
      const p = [org, ...vis.params]; const w = ['a.organisme_id = $1', vis.where];
      const add = (v) => { p.push(v); return `$${p.length}`; };
      if (f.statut) w.push(`a.statut = ${add(f.statut)}`);
      if (f.typeId) w.push(`a.type_id = ${add(f.typeId)}`);
      if (f.directionCode) w.push(`a.direction_code = ${add(f.directionCode)}`);
      if (f.seanceId) w.push(`(a.seance_id = ${add(f.seanceId)} OR a.seance_visee_id = $${p.length})`);
      if (f.scope === 'mine') w.push(`(a.redacteur = ${add(ctx.username)} OR a.co_redacteurs ? $${p.length})`);
      if (f.scope === 'following') w.push(`a.participants ? ${add(ctx.username)}`);
      if (f.q) w.push(`(a.titre ILIKE ${add('%' + f.q.replace(/[%_]/g, '\\$&') + '%')} OR a.numero_suivi::text = ${add(f.q)})`);
      if (!f.includeAbandoned) w.push("a.statut <> 'abandonne'");
      const where = w.join(' AND ');
      const total = (await db.get(`SELECT count(*)::int AS n FROM actes a WHERE ${where}`, p)).n;
      const rows = await db.all(`SELECT a.* FROM actes a WHERE ${where} ORDER BY a.updated_at DESC, a.id DESC LIMIT ${add(f.limit || 50)} OFFSET ${add(f.offset || 0)}`, p);
      return { total, limit: f.limit || 50, offset: f.offset || 0, items: rows.map(toActe) };
    },

    async update(ctx, organismeId, id, patch) {
      const before = await svc.load(ctx, organismeId, id);
      const org = before.organisme_id;
      const seanceOnly = Object.keys(patch).every((k) => k === 'seanceViseeId');
      let allowed = await acl.canEdit(ctx, before);
      // CRE-09 : tout valideur de la hiérarchie peut modifier la séance visée pendant le circuit
      if (!allowed && seanceOnly && (before.participants.includes(ctx.username) || acl.isAdmin(ctx, org))) allowed = true;
      if (!allowed) throw E.forbidden('Vous ne pouvez pas modifier cet acte à ce stade');
      if (before.statut === 'abandonne') throw E.conflict('Acte abandonné');

      await svc.checkRefs(org, patch);
      const set = []; const p = [id]; const add = (col, v, cast = '') => { p.push(v); set.push(`${col} = $${p.length}${cast}`); };
      if (patch.titre !== undefined) add('titre', patch.titre);
      if (patch.typeId !== undefined) add('type_id', (await refs.require('type_acte', patch.typeId, org)).id);
      if (patch.natureId !== undefined) add('nature_id', patch.natureId === null ? null : (await refs.require('nature', patch.natureId, org)).id);
      if (patch.matiereId !== undefined) add('matiere_id', patch.matiereId === null ? null : (await refs.require('matiere', patch.matiereId, org, { leaf: true })).id);
      if (patch.rubriqueId !== undefined) add('rubrique_id', patch.rubriqueId === null ? null : (await refs.require('rubrique', patch.rubriqueId, org)).id);
      if (patch.incidenceFinanciere !== undefined) add('incidence_financiere', patch.incidenceFinanciere);
      if (patch.montant !== undefined) add('montant', patch.montant);
      if (patch.rapporteurId !== undefined) add('rapporteur_id', patch.rapporteurId);
      if (patch.rapporteurComplId !== undefined) add('rapporteur_compl_id', patch.rapporteurComplId);
      if (patch.seanceViseeId !== undefined) add('seance_visee_id', patch.seanceViseeId);
      if (patch.urgence !== undefined) add('urgence', patch.urgence);
      if (patch.dateLimite !== undefined) add('date_limite', patch.dateLimite);
      if (patch.confidentialite !== undefined) add('confidentialite', patch.confidentialite);
      if (patch.commentaireInitial !== undefined) add('commentaire_initial', patch.commentaireInitial);
      if (patch.custom !== undefined) add('custom', JSON.stringify(patch.custom), '::jsonb');
      if (patch.coRedacteurs !== undefined) {
        if (before.redacteur !== ctx.username && !acl.isAdmin(ctx, org)) throw E.forbidden('Seul le rédacteur désigne ses co-rédacteurs');
        add('co_redacteurs', JSON.stringify([...new Set(patch.coRedacteurs.map((u) => u.toLowerCase()))].filter((u) => u !== before.redacteur)), '::jsonb');
      }
      if (patch.serviceCode !== undefined) {
        if (!(await redaction.canDraft(ctx, org, before.direction_code, patch.serviceCode)).ok) throw E.forbidden('Service non autorisé');
        const l = await svc.labels(before.direction_code, patch.serviceCode, ctx.agent);
        add('service_code', patch.serviceCode); add('service_label', l.serviceLabel);
      }
      if (!set.length) return toActe(before);
      const after = await db.get(`UPDATE actes SET ${set.join(', ')} WHERE id = $1 RETURNING *`, p);
      await audit.log(ctx, { organismeId: org, action: 'acte.update', entity: 'actes', entityId: id, before: toActe(before), after: toActe(after) });
      const drivers = DRIVERS.filter((k) => patch[k] !== undefined && JSON.stringify(toActe(before)[k]) !== JSON.stringify(toActe(after)[k]));
      if (drivers.length) await bus.emit('acte.driver_changed', { organismeId: org, acteId: id, drivers, ctx });
      if (patch.seanceViseeId !== undefined && before.seance_visee_id !== after.seance_visee_id) await bus.emit('acte.seance_changed', { organismeId: org, acteId: id, from: before.seance_visee_id, to: after.seance_visee_id, ctx });
      return toActe(after);
    },

    // ---- délibérations d'un dossier (D5) ------------------------------------------------------------------------------
    async addDeliberation(ctx, organismeId, acteId, { titre }) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      const ordre = (await db.get('SELECT COALESCE(MAX(ordre), 0) + 1 AS n FROM deliberations WHERE acte_id = $1', [a.id])).n;
      const d = await db.get('INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1,$2,$3) RETURNING *', [a.id, ordre, titre]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'deliberation.add', entity: 'deliberations', entityId: d.id, after: toDelib(d) });
      await bus.emit('deliberation.added', { organismeId: a.organisme_id, acteId: a.id, deliberationId: d.id, ctx });
      return toDelib(d);
    },
    async updateDeliberation(ctx, organismeId, acteId, id, { titre, ordre }) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      const d = await db.get('UPDATE deliberations SET titre = COALESCE($3, titre), ordre = COALESCE($4, ordre) WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id, titre ?? null, ordre ?? null]);
      if (!d) throw E.notFound('Délibération introuvable');
      return toDelib(d);
    },
    async deleteDeliberation(ctx, organismeId, acteId, id) {
      const a = await svc.load(ctx, organismeId, acteId, { edit: true });
      const type = await db.get('SELECT meta FROM ref_items WHERE id = $1', [a.type_id]);
      const n = (await db.get('SELECT count(*)::int AS n FROM deliberations WHERE acte_id = $1', [a.id])).n;
      if (n <= Math.max(1, type?.meta?.minDeliberations ?? 1)) throw E.conflict('Un dossier doit conserver au moins une délibération');
      const d = await db.get('DELETE FROM deliberations WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id]);
      if (!d) throw E.notFound('Délibération introuvable');
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'deliberation.delete', entity: 'deliberations', entityId: id, before: toDelib(d) });
    },

    // ---- abandon / réactivation / duplication ---------------------------------------------------------------------------
    async abandon(ctx, organismeId, id, motif) {
      const a = await svc.load(ctx, organismeId, id);
      const mayAbandon = a.redacteur === ctx.username || acl.isAdmin(ctx, a.organisme_id) || (a.participants || []).includes(ctx.username);
      if (!mayAbandon) throw E.forbidden("Vous ne pouvez pas abandonner cet acte");
      if (['abandonne', 'adopte', 'rejete', 'transmis', 'ar_recu', 'publie', 'executoire', 'archive'].includes(a.statut)) throw E.conflict(`Un acte « ${a.statut} » ne peut pas être abandonné`);
      const r = await db.get("UPDATE actes SET statut = 'abandonne', abandoned_at = now(), abandon_motif = $2 WHERE id = $1 RETURNING *", [id, motif]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.abandon', entity: 'actes', entityId: id, before: { statut: a.statut }, after: { statut: 'abandonne', motif } });
      await bus.emit('acte.abandoned', { organismeId: a.organisme_id, acteId: id, motif, previousStatut: a.statut, ctx });
      return toActe(r);
    },
    async reactivate(ctx, organismeId, id) {
      const a = await svc.raw(organismeId, id);
      if (!acl.isAdmin(ctx, a.organisme_id)) throw E.forbidden("Réservé à l'administrateur ou au SCC");
      if (a.statut !== 'abandonne') throw E.conflict("L'acte n'est pas abandonné");
      const r = await db.get("UPDATE actes SET statut = 'brouillon', abandoned_at = NULL, abandon_motif = NULL, current_step_key = NULL, path = NULL, participants = '[]'::jsonb WHERE id = $1 RETURNING *", [id]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.reactivate', entity: 'actes', entityId: id });
      return toActe(r);
    },
    async duplicate(ctx, organismeId, id) {
      const src = await svc.load(ctx, organismeId, id);
      const copy = await svc.create(ctx, src.organisme_id, {
        typeId: src.type_id, titre: `${src.titre} (copie)`, directionCode: src.direction_code, serviceCode: src.service_code, natureId: src.nature_id,
        matiereId: src.matiere_id, rubriqueId: src.rubrique_id, incidenceFinanciere: src.incidence_financiere, montant: src.montant === null ? undefined : Number(src.montant),
        confidentialite: src.confidentialite, custom: src.custom,
      });
      await bus.emit('acte.duplicated', { organismeId: src.organisme_id, sourceId: src.id, acteId: copy.id, ctx });
      return copy;
    },

    /** Contrôle de complétude (CRE-02) : ce qui manque avant l'envoi au circuit. */
    async completeness(a) {
      const type = await db.get('SELECT meta FROM ref_items WHERE id = $1', [a.type_id]);
      const missing = [];
      const need = (ok, code, label) => { if (!ok) missing.push({ code, label }); };
      need(!!a.titre?.trim(), 'titre', 'Titre');
      need(!!a.matiere_id, 'matiere', 'Matière');
      need(a.incidence_financiere !== null && a.incidence_financiere !== undefined, 'incidence_financiere', 'Incidence financière');
      need(!!a.rubrique_id, 'rubrique', 'Rubrique');
      need(!!a.nature_id, 'nature', 'Nature');
      need(!!a.rapporteur_id, 'rapporteur', 'Élu rapporteur');
      const n = (await db.get('SELECT count(*)::int AS n FROM deliberations WHERE acte_id = $1', [a.id])).n;
      need(n >= Math.max(1, type?.meta?.minDeliberations ?? 1), 'deliberation', 'Au moins une délibération');
      if (late.texts) for (const m of await late.texts.missingTexts(a, type?.meta)) missing.push(m);
      return { complete: missing.length === 0, missing };
    },
  };
  return svc;
}

module.exports = { createActes, toActe, DRIVERS };
