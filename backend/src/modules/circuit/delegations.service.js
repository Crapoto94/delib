/**
 * Délégations de validation (CIR-30 à CIR-39) : un valideur délègue LUI-MÊME ses décisions.
 *  - portée : toutes ses étapes, une étape, un type d'acte, une direction, ou un acte précis ;
 *  - durée : du… au…, ou jusqu'à révocation ; s'applique aux actes déjà en attente et aux suivants ;
 *  - droits transmis : valider, refuser, commenter, modifier (paramétrables) ;
 *  - co-détention : le délégant garde ses droits (la première action clôt la tâche) ;
 *  - garde-fous : jamais le rédacteur de l'acte, étapes non déléguables, pas de sous-délégation, pas de cycle,
 *    révocation immédiate par le délégant, le directeur ou l'admin.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const SCOPES = ['all', 'step', 'type_acte', 'direction', 'acte'];
const toD = (r) => ({
  id: r.id, organismeId: r.organisme_id, delegant: r.delegant, delegue: r.delegue, scope: r.scope, scopeValue: r.scope_value, rights: r.rights,
  startsAt: r.starts_at, endsAt: r.ends_at, motif: r.motif, revokedAt: r.revoked_at, createdBy: r.created_by, createdAt: r.created_at,
  active: !r.revoked_at && new Date(r.starts_at) <= new Date() && (!r.ends_at || new Date(r.ends_at) > new Date()),
});
const ACTIVE = "revoked_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())";

function createDelegations({ db, audit, access, titulaires, dir, bus }) {
  const svc = {
    SCOPES,

    /** La délégation couvre-t-elle cette étape de cet acte ? */
    covers(d, { acte, stepKey, typeCode }) {
      switch (d.scope) {
        case 'all': return true;
        case 'step': return d.scope_value === stepKey;
        case 'type_acte': return d.scope_value === typeCode;
        case 'direction': return d.scope_value === acte.direction_code;
        case 'acte': return Number(d.scope_value) === acte.id;
        default: return false;
      }
    },

    async activeForDelegue(organismeId, username) {
      return db.all(`SELECT * FROM validation_delegations WHERE organisme_id = $1 AND delegue = $2 AND ${ACTIVE}`, [organismeId, username]);
    },
    async activeFromDelegants(organismeId, delegants) {
      if (!delegants.length) return [];
      return db.all(`SELECT * FROM validation_delegations WHERE organisme_id = $1 AND delegant = ANY($2::text[]) AND ${ACTIVE}`, [organismeId, delegants]);
    },

    /**
     * Un utilisateur peut-il agir sur l'étape courante (par délégation) ? Renvoie { onBehalfOf, rights } ou null.
     * Pas de sous-délégation : seuls les DÉTENTEURS de l'étape peuvent avoir des délégués.
     */
    async delegationFor(ctx, acte, inst, typeCode, stepDef) {
      if (stepDef?.nonDelegable) return null;
      if (ctx.username === acte.redacteur || (acte.co_redacteurs || []).includes(ctx.username)) return null;
      const mine = await svc.activeForDelegue(acte.organisme_id, ctx.username);
      const hit = mine.find((d) => inst.holders.includes(d.delegant) && svc.covers(d, { acte, stepKey: inst.step_key, typeCode }));
      return hit ? { onBehalfOf: hit.delegant, rights: hit.rights, id: hit.id } : null;
    },

    async list(ctx, organismeId, { scope = 'mine' } = {}) {
      const org = requireOrg(organismeId);
      const admin = ctx.isPlatformAdmin || access.rolesIn(ctx, org).includes('org_admin');
      let rows;
      if (scope === 'all') {
        if (admin) rows = await db.all('SELECT * FROM validation_delegations WHERE organisme_id = $1 ORDER BY id DESC', [org]);
        else {
          // un directeur voit les délégations de sa direction (CIR-39)
          const h = await titulaires.hierarchyScope(ctx.username, org);
          rows = (await db.all('SELECT d.*, a.direction_code FROM validation_delegations d LEFT JOIN agent_ref a ON a.username = d.delegant WHERE d.organisme_id = $1 ORDER BY d.id DESC', [org]))
            .filter((r) => h.directions.includes(r.direction_code));
        }
      } else rows = await db.all('SELECT * FROM validation_delegations WHERE organisme_id = $1 AND (delegant = $2 OR delegue = $2) ORDER BY id DESC', [org, ctx.username]);
      return rows.map(toD);
    },

    async create(ctx, organismeId, d) {
      const org = requireOrg(organismeId);
      const delegant = (d.delegant || ctx.username).toLowerCase();
      const delegue = d.delegue.toLowerCase();
      const admin = ctx.isPlatformAdmin || access.rolesIn(ctx, org).includes('org_admin');
      if (delegant !== ctx.username && !admin) throw E.forbidden('Vous ne pouvez déléguer que vos propres décisions');
      if (delegant === delegue) throw E.badRequest('On ne se délègue pas à soi-même');
      if (!SCOPES.includes(d.scope)) throw E.badRequest('Portée inconnue');
      if (d.scope !== 'all' && !d.scopeValue) throw E.badRequest('scopeValue requis pour cette portée');
      if (d.endsAt && d.startsAt && new Date(d.endsAt) <= new Date(d.startsAt)) throw E.badRequest('La fin doit suivre le début');
      if (d.endsAt && new Date(d.endsAt) <= new Date()) throw E.badRequest('La fin de la délégation est déjà passée');
      if (!(await dir.agentExists(delegue))) throw E.badRequest(`Agent introuvable : ${delegue}`);
      // cycle : le délégué délègue déjà au délégant (A -> B et B -> A)
      const back = await db.get(`SELECT 1 AS x FROM validation_delegations WHERE organisme_id = $1 AND delegant = $2 AND delegue = $3 AND ${ACTIVE}`, [org, delegue, delegant]);
      if (back) throw E.conflict('Délégation circulaire refusée (le délégué délègue déjà au délégant)');
      // sous-délégation : le délégant est lui-même un délégué actif (sans être titulaire) — refusée par défaut
      const asDelegue = await db.get(`SELECT 1 AS x FROM validation_delegations WHERE organisme_id = $1 AND delegue = $2 AND ${ACTIVE}`, [org, delegant]);
      if (asDelegue && d.scope === 'all') throw E.conflict('Sous-délégation refusée : vous êtes vous-même délégué');
      const rights = { validate: true, refuse: true, comment: true, edit: false, ...(d.rights || {}) };
      const r = await db.get(
        `INSERT INTO validation_delegations (organisme_id, delegant, delegue, scope, scope_value, rights, starts_at, ends_at, motif, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,COALESCE($7, now()),$8,$9,$10) RETURNING *`,
        [org, delegant, delegue, d.scope, d.scope === 'all' ? null : String(d.scopeValue), JSON.stringify(rights), d.startsAt || null, d.endsAt || null, d.motif || null, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'delegation.create', entity: 'validation_delegations', entityId: r.id, after: toD(r) });
      await bus.emit('delegation.created', { organismeId: org, delegation: toD(r), ctx });
      return toD(r);
    },

    async revoke(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const d = await db.get('SELECT * FROM validation_delegations WHERE id = $1 AND organisme_id = $2 AND revoked_at IS NULL', [id, org]);
      if (!d) throw E.notFound('Délégation introuvable ou déjà révoquée');
      const admin = ctx.isPlatformAdmin || access.rolesIn(ctx, org).includes('org_admin');
      let allowed = admin || d.delegant === ctx.username;
      if (!allowed) { const h = await titulaires.hierarchyScope(ctx.username, org); const a = await db.get('SELECT direction_code FROM agent_ref WHERE username = $1', [d.delegant]); allowed = !!a && h.directions.includes(a.direction_code); }
      if (!allowed) throw E.forbidden('Seuls le délégant, son directeur ou un administrateur révoquent une délégation');
      const r = await db.get('UPDATE validation_delegations SET revoked_at = now(), revoked_by = $2 WHERE id = $1 RETURNING *', [id, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'delegation.revoke', entity: 'validation_delegations', entityId: id, before: toD(d), after: toD(r) });
      await bus.emit('delegation.revoked', { organismeId: org, delegation: toD(r), ctx });
      return toD(r);
    },
  };
  return svc;
}

module.exports = { createDelegations, SCOPES };
