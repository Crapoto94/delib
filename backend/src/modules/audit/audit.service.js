/**
 * Journal d'audit (SEC-04) : qui, quoi, quand, d'où, avant/après. Immuable en base (migration 0005).
 * Les identités sont dénormalisées (nom d'utilisateur au moment de l'acte), même si l'annuaire change ensuite (INT-02).
 */
const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

function createAudit(db) {
  const toRow = (r) => ({
    id: Number(r.id), at: r.at, organismeId: r.organisme_id, actor: r.actor, onBehalfOf: r.on_behalf_of,
    action: r.action, entity: r.entity, entityId: r.entity_id, before: r.before, after: r.after, ip: r.ip,
  });

  return {
    /** ctx : { username, ip?, onBehalfOf? } — « system » si absent (amorçage). */
    async log(ctx, { organismeId = null, action, entity, entityId = null, before = null, after = null }) {
      await db.withCtx({ isPlatformAdmin: true }, (q) => q.run(
        `INSERT INTO audit_log (organisme_id, actor, on_behalf_of, action, entity, entity_id, before, after, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
        [organismeId, ctx?.impersonatedBy || ctx?.username || 'system', ctx?.impersonatedBy ? (ctx.onBehalfOf || ctx.username) : (ctx?.onBehalfOf || null), action, entity,
          entityId === null || entityId === undefined ? null : String(entityId), json(before), json(after), ctx?.ip || null],
      ));
    },

    async list(ctx, { organismeId, action, actor, limit = 50, offset = 0 }) {
      const where = []; const p = [];
      if (organismeId) { p.push(organismeId); where.push(`organisme_id = $${p.length}`); }
      if (action) { p.push(action); where.push(`action = $${p.length}`); }
      if (actor) { p.push(String(actor).toLowerCase()); where.push(`actor = $${p.length}`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return db.withCtx(ctx, async (q) => {
        const total = (await q.get(`SELECT count(*)::int AS n FROM audit_log ${w}`, p)).n;
        p.push(limit, offset);
        const rows = await q.all(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
        return { total, limit, offset, items: rows.map(toRow) };
      });
    },
  };
}

module.exports = { createAudit };
