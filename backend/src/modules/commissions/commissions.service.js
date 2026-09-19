/**
 * Commissions (section 15) : administration (membres élus, secrétaires), rattachement à un acte, mise à disposition à la
 * validation DGS (ou SCC, CMN-04), avis (Favorable / Défavorable / Réservé / Sans avis), suspension au renvoi (CMN-07).
 * Toutes les commissions sont « pour avis » (D29) ; 0 commission = « hors commission ».
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const AVIS = ['favorable', 'defavorable', 'reserve', 'sans_avis'];
const FONCTIONS = ['president', 'vice_president', 'membre'];
const toC = (r) => ({ id: r.id, organismeId: r.organisme_id, nom: r.nom, description: r.description, couleur: r.couleur, ordre: r.ordre, matieres: r.matieres, directions: r.directions, thematiques: r.thematiques, sieges: r.sieges, siegesOpposition: r.sieges_opposition, actif: r.actif });
const toAc = (r) => ({
  id: r.id, acteId: r.acte_id, commissionId: r.commission_id, commission: r.commission_nom, avis: r.avis, commentaire: r.avis_commentaire, datePassage: r.avis_date, avisPar: r.avis_par, avisAt: r.avis_at,
  misADispositionAt: r.mis_a_disposition_at, suspendue: r.suspendue, retireeAt: r.retiree_at, retireeMotif: r.retiree_motif,
});

function createCommissions({ db, audit, actes, acl, settings, bus, log }) {
  const svc = {
    AVIS,

    // ------------------------------------------------------------------------------------ administration
    async list(organismeId, { actif } = {}) {
      const org = requireOrg(organismeId);
      const rows = await db.all(
        `SELECT c.*, (SELECT count(*)::int FROM commission_membres m WHERE m.commission_id = c.id) AS nb_membres FROM commissions c
         WHERE c.organisme_id = $1 ${actif === undefined ? '' : 'AND c.actif = $2'} ORDER BY c.ordre, c.nom`, actif === undefined ? [org] : [org, actif]);
      return rows.map((r) => ({ ...toC(r), nbMembres: r.nb_membres }));
    },

    async get(organismeId, id) {
      const org = requireOrg(organismeId);
      const c = await db.get('SELECT * FROM commissions WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!c) throw E.notFound('Commission introuvable');
      const membres = await db.all(
        `SELECT m.*, e.nom, e.prenom, e.email, g.nom AS groupe FROM commission_membres m JOIN elus e ON e.id = m.elu_id LEFT JOIN groupes_politiques g ON g.id = e.groupe_id
         WHERE m.commission_id = $1 ORDER BY array_position(ARRAY['president','vice_president','membre'], m.fonction), e.nom`, [id]);
      const secretaires = (await db.all('SELECT username FROM commission_secretaires WHERE commission_id = $1 ORDER BY username', [id])).map((r) => r.username);
      return { ...toC(c), membres: membres.map((m) => ({ eluId: m.elu_id, nom: m.nom, prenom: m.prenom, email: m.email, groupe: m.groupe, fonction: m.fonction, dateDebut: m.date_debut, dateFin: m.date_fin })), secretaires };
    },

    async create(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      try {
        const r = await db.get('INSERT INTO commissions (organisme_id, nom, description, couleur, ordre, matieres, directions, thematiques, sieges, sieges_opposition) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10) RETURNING *',
          [org, b.nom, b.description ?? null, b.couleur ?? null, b.ordre ?? 0, JSON.stringify(b.matieres || []), JSON.stringify(b.directions || []), JSON.stringify(b.thematiques || []), b.sieges ?? null, b.siegesOpposition ?? null]);
        await audit.log(ctx, { organismeId: org, action: 'commission.create', entity: 'commissions', entityId: r.id, after: toC(r) });
        return svc.get(org, r.id);
      } catch (e) { if (e.code === '23505') throw E.conflict('Une commission porte déjà ce nom'); throw e; }
    },

    async update(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const before = await svc.get(org, id);
      const set = []; const p = [id, org];
      for (const [k, col, j] of [['nom', 'nom'], ['description', 'description'], ['couleur', 'couleur'], ['ordre', 'ordre'], ['actif', 'actif'], ['matieres', 'matieres', true], ['directions', 'directions', true], ['thematiques', 'thematiques', true], ['sieges', 'sieges'], ['siegesOpposition', 'sieges_opposition']]) {
        if (b[k] !== undefined) { p.push(j ? JSON.stringify(b[k]) : b[k]); set.push(`${col} = $${p.length}${j ? '::jsonb' : ''}`); }
      }
      if (set.length) await db.run(`UPDATE commissions SET ${set.join(', ')} WHERE id = $1 AND organisme_id = $2`, p);
      const after = await svc.get(org, id);
      await audit.log(ctx, { organismeId: org, action: 'commission.update', entity: 'commissions', entityId: id, before, after });
      return after;
    },

    /** Remplace la liste des membres (élus de l'organisme) ; un président au plus. */
    async setMembres(ctx, organismeId, id, membres) {
      const org = requireOrg(organismeId);
      const before = await svc.get(org, id);
      if (membres.filter((m) => m.fonction === 'president').length > 1) throw E.badRequest('Une commission a un seul président');
      const ids = [...new Set(membres.map((m) => m.eluId))];
      if (ids.length !== membres.length) throw E.badRequest('Un élu ne peut figurer qu\'une fois');
      const ok = await db.all('SELECT id FROM elus WHERE organisme_id = $1 AND id = ANY($2::int[])', [org, ids]);
      if (ok.length !== ids.length) throw E.badRequest('Élu inconnu dans cet organisme');
      await db.tx(async (q) => {
        await q.run('DELETE FROM commission_membres WHERE commission_id = $1', [id]);
        for (const m of membres) await q.run('INSERT INTO commission_membres (commission_id, elu_id, fonction, date_debut, date_fin) VALUES ($1,$2,$3,$4,$5)', [id, m.eluId, m.fonction || 'membre', m.dateDebut ?? null, m.dateFin ?? null]);
      });
      const after = await svc.get(org, id);
      await audit.log(ctx, { organismeId: org, action: 'commission.membres', entity: 'commissions', entityId: id, before: before.membres, after: after.membres });
      return after;
    },

    async setSecretaires(ctx, organismeId, id, usernames) {
      const org = requireOrg(organismeId);
      const before = await svc.get(org, id);
      const list = [...new Set(usernames.map((u) => u.toLowerCase()))];
      await db.tx(async (q) => {
        await q.run('DELETE FROM commission_secretaires WHERE commission_id = $1', [id]);
        for (const u of list) await q.run('INSERT INTO commission_secretaires (commission_id, username) VALUES ($1,$2)', [id, u]);
      });
      await audit.log(ctx, { organismeId: org, action: 'commission.secretaires', entity: 'commissions', entityId: id, before: before.secretaires, after: list });
      return svc.get(org, id);
    },

    /** Élus (identifiants `elu:N`) et secrétaires d'une commission : destinataires des notifications. */
    async recipients(commissionId) {
      const m = await db.all("SELECT elu_id FROM commission_membres WHERE commission_id = $1 AND (date_fin IS NULL OR date_fin >= current_date)", [commissionId]);
      const s = await db.all('SELECT username FROM commission_secretaires WHERE commission_id = $1', [commissionId]);
      return { elus: m.map((r) => `elu:${r.elu_id}`), secretaires: s.map((r) => r.username) };
    },

    // ------------------------------------------------------------------------------------- sur un acte
    async forActe(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      const rows = await db.all('SELECT ac.*, c.nom AS commission_nom FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id WHERE ac.acte_id = $1 ORDER BY ac.id', [a.id]);
      return { horsCommission: rows.filter((r) => !r.retiree_at).length === 0, items: rows.map(toAc) };
    },

    /** Rédacteur (acte éditable) ou SCC / administrateur, à tout moment du circuit. */
    async loadEditable(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      if (!acl.isAdmin(ctx, a.organisme_id) && !(await acl.canEdit(ctx, a))) throw E.forbidden('Vous ne pouvez pas modifier cet acte à ce stade');
      return a;
    },

    async count(acteId) { return (await db.get('SELECT count(*)::int AS n FROM acte_commissions WHERE acte_id = $1 AND retiree_at IS NULL', [acteId])).n; },

    async addToActe(ctx, organismeId, acteId, commissionId) {
      const a = await svc.loadEditable(ctx, organismeId, acteId);
      const c = await db.get('SELECT * FROM commissions WHERE id = $1 AND organisme_id = $2 AND actif', [commissionId, a.organisme_id]);
      if (!c) throw E.badRequest('Commission inconnue ou inactive dans cet organisme');
      try {
        const r = await db.get('INSERT INTO acte_commissions (acte_id, commission_id, created_by) VALUES ($1,$2,$3) RETURNING *', [a.id, c.id, ctx.username]);
        await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.commission.add', entity: 'acte_commissions', entityId: r.id, after: { acteId: a.id, commission: c.nom } });
        // déjà validé par le DGS : la mise à disposition part tout de suite
        if (['valide_dgs', 'en_attente_scc'].includes(a.statut) && (await svc.trigger(a.organisme_id)) === 'dgs') await svc.makeAvailable(a.id, { ctx });
        return toAc({ ...r, commission_nom: c.nom });
      } catch (e) { if (e.code === '23505') throw E.conflict('Commission déjà rattachée à cet acte'); throw e; }
    },

    /** Retrait : motif obligatoire après mise à disposition, et les membres sont prévenus (CMN-06). */
    async removeFromActe(ctx, organismeId, acteId, commissionId, motif) {
      const a = await svc.loadEditable(ctx, organismeId, acteId);
      const r = await db.get('SELECT ac.*, c.nom AS commission_nom FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id WHERE ac.acte_id = $1 AND ac.commission_id = $2 AND ac.retiree_at IS NULL', [a.id, commissionId]);
      if (!r) throw E.notFound('Cette commission n\'est pas rattachée à l\'acte');
      if (r.mis_a_disposition_at && !motif) throw E.badRequest('Un motif est obligatoire : le projet a déjà été mis à disposition de la commission');
      if (r.mis_a_disposition_at) await db.run('UPDATE acte_commissions SET retiree_at = now(), retiree_motif = $2 WHERE id = $1', [r.id, motif]);
      else await db.run('DELETE FROM acte_commissions WHERE id = $1', [r.id]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.commission.remove', entity: 'acte_commissions', entityId: r.id, before: { acteId: a.id, commission: r.commission_nom }, after: { motif } });
      if (r.mis_a_disposition_at) await bus.emit('commission.retiree', { organismeId: a.organisme_id, acteId: a.id, commissionId: r.commission_id, commissionNom: r.commission_nom, motif, ctx });
      return { removed: true };
    },

    /** Avis : secrétaire de la commission, SCC ou administrateur. */
    async setAvis(ctx, organismeId, acteId, commissionId, { avis, commentaire, datePassage }) {
      const a = await actes.load(ctx, organismeId, acteId);
      const isSecretaire = !!(await db.get('SELECT 1 AS x FROM commission_secretaires WHERE commission_id = $1 AND username = $2', [commissionId, ctx.username]));
      if (!isSecretaire && !acl.isAdmin(ctx, a.organisme_id)) throw E.forbidden("Seuls le secrétaire de la commission, le SCC et l'administrateur saisissent l'avis");
      const r = await db.get('SELECT ac.*, c.nom AS commission_nom FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id WHERE ac.acte_id = $1 AND ac.commission_id = $2 AND ac.retiree_at IS NULL', [a.id, commissionId]);
      if (!r) throw E.notFound('Cette commission n\'est pas rattachée à l\'acte');
      if (!r.mis_a_disposition_at) throw E.conflict("Le projet n'a pas encore été mis à disposition de cette commission");
      const u = await db.get('UPDATE acte_commissions SET avis = $2, avis_commentaire = $3, avis_date = $4, avis_par = $5, avis_at = now() WHERE id = $1 RETURNING *', [r.id, avis, commentaire ?? null, datePassage ?? null, ctx.username]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'acte.commission.avis', entity: 'acte_commissions', entityId: r.id, before: { avis: r.avis }, after: { avis, commentaire } });
      await bus.emit('commission.avis', { organismeId: a.organisme_id, acteId: a.id, commissionId, commissionNom: r.commission_nom, avis, ctx });
      return toAc({ ...u, commission_nom: r.commission_nom });
    },

    // ------------------------------------------------------------------------------ mise à disposition
    /** Déclencheur (CMN-04) : validation DGS (défaut) ou fin du circuit / validation SCC. */
    async trigger(organismeId) { return (await settings.resolve(organismeId))['commissions.declencheur']?.value === 'scc' ? 'scc' : 'dgs'; },

    async makeAvailable(acteId, { ctx } = {}) {
      const a = await db.get('SELECT * FROM actes WHERE id = $1', [acteId]);
      const rows = await db.all('SELECT ac.*, c.nom AS commission_nom FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id WHERE ac.acte_id = $1 AND ac.retiree_at IS NULL AND (ac.mis_a_disposition_at IS NULL OR ac.suspendue)', [acteId]);
      for (const r of rows) {
        const resumed = !!r.mis_a_disposition_at;
        await db.run('UPDATE acte_commissions SET mis_a_disposition_at = COALESCE(mis_a_disposition_at, now()), suspendue = false WHERE id = $1', [r.id]);
        await audit.log(ctx || { username: 'system' }, { organismeId: a.organisme_id, action: resumed ? 'acte.commission.reprise' : 'acte.commission.mise_a_disposition', entity: 'acte_commissions', entityId: r.id, after: { acteId, commission: r.commission_nom } });
        await bus.emit('commission.mise_a_disposition', { organismeId: a.organisme_id, acteId, commissionId: r.commission_id, commissionNom: r.commission_nom, resumed, ctx });
      }
      return rows.length;
    },

    async suspend(acteId, motif) {
      const a = await db.get('SELECT * FROM actes WHERE id = $1', [acteId]);
      const rows = await db.all('SELECT ac.*, c.nom AS commission_nom FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id WHERE ac.acte_id = $1 AND ac.retiree_at IS NULL AND ac.mis_a_disposition_at IS NOT NULL AND NOT ac.suspendue', [acteId]);
      for (const r of rows) {
        await db.run('UPDATE acte_commissions SET suspendue = true WHERE id = $1', [r.id]);
        await bus.emit('commission.suspendue', { organismeId: a.organisme_id, acteId, commissionId: r.commission_id, commissionNom: r.commission_nom, motif });
      }
      return rows.length;
    },
  };

  const guard = (fn) => (p) => fn(p).catch((e) => log.error({ err: e.message }, 'commissions : traitement d\'événement en erreur'));
  bus.on('acte.valide_dgs', guard(async (p) => { if ((await svc.trigger(p.organismeId)) === 'dgs') await svc.makeAvailable(p.acteId); }));
  bus.on('circuit.completed', guard(async (p) => { if ((await svc.trigger(p.organismeId)) === 'scc') await svc.makeAvailable(p.acteId); }));
  // circuit repris directement à l'étape qui avait refusé : la mise à disposition suspendue reprend dès que l'acte est de nouveau validé par le DGS
  bus.on('step.entered', guard(async (p) => {
    const a = await db.get('SELECT statut FROM actes WHERE id = $1', [p.acteId]);
    if (['valide_dgs', 'en_attente_scc'].includes(a?.statut) && (await svc.trigger(p.organismeId)) === 'dgs') await svc.makeAvailable(p.acteId);
  }));
  bus.on('acte.refused', guard(async (p) => { await svc.suspend(p.acteId, p.motif); }));
  return svc;
}

module.exports = { createCommissions, AVIS, FONCTIONS };
