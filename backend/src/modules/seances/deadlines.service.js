/**
 * Date limite de rédaction et dérogations (NOT-04, NOT-06, NOT-07, NOT-08).
 *  - après la date limite de la séance visée, l'envoi au circuit est BLOQUÉ (paramètre `seances.blocage_date_limite` :
 *    `bloquer` par défaut ou `alerter`, au niveau organisme / instance / type d'acte) ; le brouillon reste enregistrable ;
 *  - une dérogation est demandée par le rédacteur, son chef de service ou son directeur, accordée ou refusée par le SCC ou
 *    le DGS (rôles paramétrables), éventuellement limitée dans le temps ; passé ce délai le blocage se réapplique.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const toD = (r) => ({
  id: r.id, organismeId: r.organisme_id, acteId: r.acte_id, seanceId: r.seance_id, demandeur: r.demandeur, motif: r.motif, nouvelleDateLimite: r.nouvelle_date_limite,
  statut: r.statut, decidePar: r.decide_par, decideAt: r.decide_at, decisionMotif: r.decision_motif, valideJusquAu: r.valide_jusqu_au, createdAt: r.created_at,
  ...(r.acte_titre !== undefined ? { acte: { id: r.acte_id, titre: r.acte_titre, numeroSuivi: r.numero_suivi } } : {}),
});
const fmt = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(new Date(d));

function createDeadlines({ db, audit, actes, acl, titulaires, settings, bus }) {
  const svc = {
    /** Dérogation en vigueur maintenant pour cet acte et cette séance, ou null. */
    async activeDerogation(acteId, seanceId, now = new Date()) {
      return db.get(
        `SELECT * FROM derogations WHERE acte_id = $1 AND seance_id = $2 AND statut = 'accordee'
           AND (valide_jusqu_au IS NULL OR valide_jusqu_au > $3) AND (nouvelle_date_limite IS NULL OR nouvelle_date_limite > $3)
         ORDER BY id DESC LIMIT 1`, [acteId, seanceId, now]);
    },

    /** Appelé par le moteur de circuit à l'envoi (NOT-04). */
    async assertCanSubmit(ctx, a, now = new Date()) {
      if (!a.seance_visee_id) return;
      const s = await db.get('SELECT * FROM seances WHERE id = $1', [a.seance_visee_id]);
      if (!s || !s.date_limite_redaction || new Date(s.date_limite_redaction) > now) return;
      if (await svc.activeDerogation(a.id, s.id, now)) return;
      const cfg = await settings.resolve(a.organisme_id, { typeActeId: a.type_id });
      const mode = cfg['seances.blocage_date_limite']?.value === 'alerter' ? 'alerter' : 'bloquer';
      if (mode === 'alerter') { await bus.emit('deadline.warning', { organismeId: a.organisme_id, acteId: a.id, seanceId: s.id, ctx }); return; }
      const next = await db.get("SELECT id, date_seance FROM seances WHERE organisme_id = $1 AND instance_id = $2 AND date_seance > $3 AND statut IN ('planifiee','convoquee') ORDER BY date_seance LIMIT 1", [s.organisme_id, s.instance_id, s.date_seance]);
      throw E.deadline(`La date limite de rédaction de la séance du ${fmt(s.date_seance)} (${fmt(s.date_limite_redaction)}) est dépassée : demandez une dérogation ou reportez l'acte à la séance suivante`,
        { seanceId: s.id, dateLimiteRedaction: s.date_limite_redaction, derogationPossible: true, seanceSuivanteId: next?.id ?? null });
    },

    async deciderRoles(organismeId) { const v = (await settings.resolve(organismeId))['derogations.roles']?.value; return Array.isArray(v) && v.length ? v : ['scc', 'dgs']; },

    async canDecide(ctx, organismeId) {
      const roles = await svc.deciderRoles(organismeId);
      if (ctx.isPlatformAdmin) return true;
      if (roles.includes('scc') && acl.isAdmin(ctx, organismeId)) return true;
      for (const f of ['dgs', 'dga']) if (roles.includes(f) && (await titulaires.resolve(organismeId, f, {})).some((t) => t.username === ctx.username || t.suppleant === ctx.username)) return true;
      return false;
    },

    /** Utilisateurs pouvant décider (destinataires de la demande). */
    async deciders(organismeId) {
      const roles = await svc.deciderRoles(organismeId);
      const out = new Set();
      if (roles.includes('scc')) {
        for (const r of await db.all("SELECT DISTINCT username FROM user_org_roles WHERE organisme_id = $1 AND role IN ('scc','org_admin')", [organismeId])) out.add(r.username);
        for (const u of await titulaires.groupMembers(organismeId, 'scc')) out.add(u);
      }
      for (const f of ['dgs', 'dga']) if (roles.includes(f)) for (const t of await titulaires.resolve(organismeId, f, {})) { out.add(t.username); if (t.suppleant) out.add(t.suppleant); }
      return [...out];
    },

    /** Demande : rédacteur, chef de service ou directeur du périmètre de l'acte (NOT-06). */
    async request(ctx, organismeId, acteId, { motif, nouvelleDateLimite }) {
      const a = await actes.load(ctx, organismeId, acteId);
      if (!a.seance_visee_id) throw E.conflict("Cet acte ne vise aucune séance : aucune dérogation nécessaire");
      const isDrafter = a.redacteur === ctx.username || (a.co_redacteurs || []).includes(ctx.username);
      const isBoss = await titulaires.canManage(ctx, a.organisme_id, { directionCode: a.direction_code, serviceCode: a.service_code });
      if (!isDrafter && !isBoss && !acl.isAdmin(ctx, a.organisme_id)) throw E.forbidden('Réservé au rédacteur, à son chef de service ou à son directeur');
      const s = await db.get('SELECT * FROM seances WHERE id = $1', [a.seance_visee_id]);
      if (!s.date_limite_redaction || new Date(s.date_limite_redaction) > new Date()) throw E.conflict("La date limite de rédaction n'est pas dépassée : aucune dérogation nécessaire");
      if (await db.get("SELECT 1 AS x FROM derogations WHERE acte_id = $1 AND seance_id = $2 AND statut = 'demandee'", [a.id, s.id])) throw E.conflict('Une demande est déjà en attente pour cet acte');
      const r = await db.get('INSERT INTO derogations (organisme_id, acte_id, seance_id, demandeur, motif, nouvelle_date_limite) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [a.organisme_id, a.id, s.id, ctx.username, motif, nouvelleDateLimite ? new Date(nouvelleDateLimite) : null]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'derogation.request', entity: 'derogations', entityId: r.id, after: toD(r) });
      await bus.emit('derogation.requested', { organismeId: a.organisme_id, acteId: a.id, derogation: toD(r), ctx });
      return toD(r);
    },

    /** Décision du SCC / DGS : accordée (éventuellement limitée dans le temps, NOT-07) ou refusée, avec motif. */
    async decide(ctx, organismeId, id, { decision, motif, valideJusquAu }) {
      const org = requireOrg(organismeId);
      if (!(await svc.canDecide(ctx, org))) throw E.forbidden('Les dérogations sont accordées par le SCC ou le DGS');
      const d = await db.get('SELECT * FROM derogations WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!d) throw E.notFound('Demande introuvable');
      if (d.statut !== 'demandee') throw E.conflict(`Demande déjà ${d.statut === 'accordee' ? 'accordée' : d.statut === 'refusee' ? 'refusée' : 'traitée'}`);
      if (decision === 'refusee' && !motif) throw E.badRequest('Un motif est obligatoire pour refuser');
      const r = await db.get('UPDATE derogations SET statut = $2, decide_par = $3, decide_at = now(), decision_motif = $4, valide_jusqu_au = $5 WHERE id = $1 RETURNING *',
        [id, decision, ctx.username, motif ?? null, decision === 'accordee' && valideJusquAu ? new Date(valideJusquAu) : null]);
      await audit.log(ctx, { organismeId: org, action: `derogation.${decision}`, entity: 'derogations', entityId: id, before: toD(d), after: toD(r) });
      await bus.emit('derogation.decided', { organismeId: org, acteId: d.acte_id, derogation: toD(r), ctx });
      return toD(r);
    },

    async cancel(ctx, organismeId, id) {
      const d = await db.get('SELECT * FROM derogations WHERE id = $1 AND organisme_id = $2', [id, requireOrg(organismeId)]);
      if (!d) throw E.notFound('Demande introuvable');
      if (d.demandeur !== ctx.username && !acl.isAdmin(ctx, d.organisme_id)) throw E.forbidden();
      if (d.statut !== 'demandee') throw E.conflict('Seule une demande en attente peut être annulée');
      await db.run("UPDATE derogations SET statut = 'annulee' WHERE id = $1", [id]);
      await audit.log(ctx, { organismeId: d.organisme_id, action: 'derogation.cancel', entity: 'derogations', entityId: id });
      return { cancelled: true };
    },

    async list(ctx, organismeId, { statut, acteId } = {}) {
      const org = requireOrg(organismeId);
      const privileged = await svc.canDecide(ctx, org) || acl.isAdmin(ctx, org);
      const p = [org]; const w = ['d.organisme_id = $1'];
      if (statut) { p.push(statut); w.push(`d.statut = $${p.length}`); }
      if (acteId) { p.push(acteId); w.push(`d.acte_id = $${p.length}`); }
      if (!privileged) { p.push(ctx.username); w.push(`d.demandeur = $${p.length}`); }
      const rows = await db.all(`SELECT d.*, a.titre AS acte_titre, a.numero_suivi FROM derogations d JOIN actes a ON a.id = d.acte_id WHERE ${w.join(' AND ')} ORDER BY d.id DESC LIMIT 200`, p);
      return rows.map(toD);
    },
  };
  return svc;
}

module.exports = { createDeadlines };
