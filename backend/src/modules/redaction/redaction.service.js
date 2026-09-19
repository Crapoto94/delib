/**
 * Droits de rédaction (section 8 du manifeste). Règle : un agent rédige pour SA direction ; d'autres agents peuvent être
 * autorisés pour une direction (ou un service) par le directeur, le responsable de service (pour son service) ou l'admin.
 * Politique de l'organisme (paramètre `redaction.politique`) : `direction` (défaut) | `service` | `explicite`.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const toG = (r) => ({
  id: r.id, organismeId: r.organisme_id, directionCode: r.direction_code, serviceCode: r.service_code, username: r.username,
  grantedBy: r.granted_by, grantedAt: r.granted_at, expiresAt: r.expires_at, motif: r.motif, revokedAt: r.revoked_at,
});

function createRedaction({ db, audit, access, titulaires, settings, bus }) {
  const activeGrant = 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())';

  const svc = {
    async policy(organismeId) { return (await settings.resolve(organismeId))['redaction.politique']?.value || 'direction'; },

    async activeGrants(organismeId, username) {
      return (await db.all(`SELECT * FROM redaction_grants WHERE organisme_id = $1 AND username = $2 AND ${activeGrant}`, [organismeId, username])).map(toG);
    },

    /** L'utilisateur peut-il rédiger pour cette direction (et ce service) ? */
    async canDraft(ctx, organismeId, directionCode, serviceCode = null) {
      if (ctx.isPlatformAdmin || access.rolesIn(ctx, organismeId).some((r) => ['org_admin', 'scc'].includes(r))) return { ok: true, via: 'admin' };
      const politique = await svc.policy(organismeId);
      const a = ctx.agent;
      if (politique !== 'explicite' && a?.direction_code === directionCode) {
        if (politique !== 'service' || !serviceCode || a.service_code === serviceCode) return { ok: true, via: 'direction' };
      }
      const g = (await svc.activeGrants(organismeId, ctx.username)).find((x) => x.directionCode === directionCode && (!x.serviceCode || !serviceCode || x.serviceCode === serviceCode));
      return g ? { ok: true, via: 'autorisation', grantId: g.id } : { ok: false };
    },

    /** Directions (et services autorisés) pour lesquelles l'utilisateur peut créer un acte : alimente le choix de la direction porteuse. */
    async draftableDirections(ctx, organismeId) {
      const out = new Map();
      const add = (directionCode, via, serviceCode = null) => { const k = directionCode; const cur = out.get(k) || { directionCode, via: [], serviceCodes: [] }; if (!cur.via.includes(via)) cur.via.push(via); if (serviceCode && !cur.serviceCodes.includes(serviceCode)) cur.serviceCodes.push(serviceCode); out.set(k, cur); };
      if ((await svc.policy(organismeId)) !== 'explicite' && ctx.agent?.direction_code) add(ctx.agent.direction_code, 'direction', ctx.agent.service_code);
      for (const g of await svc.activeGrants(organismeId, ctx.username)) add(g.directionCode, 'autorisation', g.serviceCode);
      return [...out.values()];
    },

    async list(ctx, organismeId, { directionCode, includeRevoked = false } = {}) {
      const org = requireOrg(organismeId);
      const p = [org]; let w = 'organisme_id = $1';
      if (directionCode) { p.push(directionCode); w += ` AND direction_code = $${p.length}`; }
      if (!includeRevoked) w += ` AND ${activeGrant}`;
      const rows = (await db.all(`SELECT * FROM redaction_grants WHERE ${w} ORDER BY direction_code, username`, p)).map(toG);
      // un directeur ou chef de service ne voit que son périmètre ; l'administrateur voit tout
      if (ctx.isPlatformAdmin || access.rolesIn(ctx, org).includes('org_admin')) return rows;
      const keep = [];
      for (const g of rows) if (await titulaires.canManage(ctx, org, { directionCode: g.directionCode, serviceCode: g.serviceCode })) keep.push(g);
      return keep;
    },

    async grant(ctx, organismeId, { directionCode, serviceCode = null, username, expiresAt = null, motif = null }) {
      const org = requireOrg(organismeId);
      if (!(await titulaires.canManage(ctx, org, { directionCode, serviceCode }))) throw E.forbidden('Seuls le directeur, le responsable de service (pour son service) et l\'administrateur accordent ce droit');
      const u = username.trim().toLowerCase();
      if (!serviceCode && !ctx.isPlatformAdmin && !access.rolesIn(ctx, org).includes('org_admin')) {
        // un chef de service ne peut pas accorder à toute la direction
        const asDirecteur = await titulaires.canManage(ctx, org, { directionCode, serviceCode: null });
        if (!asDirecteur) throw E.forbidden('Une autorisation pour toute la direction relève du directeur');
      }
      const r = await db.get(
        `INSERT INTO redaction_grants (organisme_id, direction_code, service_code, username, granted_by, expires_at, motif)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [org, directionCode, serviceCode, u, ctx.username, expiresAt, motif]);
      await audit.log(ctx, { organismeId: org, action: 'redaction.grant', entity: 'redaction_grants', entityId: r.id, after: toG(r) });
      await bus.emit('redaction.granted', { organismeId: org, grant: toG(r), by: ctx.username });
      return toG(r);
    },

    async revoke(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const g = await db.get(`SELECT * FROM redaction_grants WHERE id = $1 AND organisme_id = $2 AND revoked_at IS NULL`, [id, org]);
      if (!g) throw E.notFound('Autorisation introuvable ou déjà révoquée');
      if (!(await titulaires.canManage(ctx, org, { directionCode: g.direction_code, serviceCode: g.service_code }))) throw E.forbidden('Vous ne gérez pas ce périmètre');
      const r = await db.get('UPDATE redaction_grants SET revoked_at = now(), revoked_by = $2 WHERE id = $1 RETURNING *', [id, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'redaction.revoke', entity: 'redaction_grants', entityId: id, before: toG(g), after: toG(r) });
      await bus.emit('redaction.revoked', { organismeId: org, grant: toG(r), by: ctx.username });
      return toG(r);
    },
  };
  return svc;
}

module.exports = { createRedaction };
