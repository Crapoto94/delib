const { z } = require('zod');
const { E } = require('../../shared/errors');

const Query = z.object({
  organismeId: z.coerce.number().int().positive().optional(),
  action: z.string().max(80).optional(),
  actor: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = ({ makeRouter, audit, access }) => {
  const r = makeRouter('/api/v1/audit');

  r.get('/', {
    summary: "Journal d'audit (immuable)", tags: ['audit'], query: Query,
    description: "Administrateur de plateforme : tout le journal (filtrable). Administrateur d'organisme : `organismeId` obligatoire, limité à ses organismes. Pagination `limit` / `offset`.",
  }, async (req, res) => {
    const q = req.valid.query;
    if (!req.ctx.isPlatformAdmin) {
      if (!q.organismeId) throw E.badRequest('organismeId requis');
      if (!access.canAccess(req.ctx, q.organismeId) || !access.rolesIn(req.ctx, q.organismeId).includes('org_admin')) throw E.forbidden("Rôle org_admin requis dans cet organisme");
    }
    res.json(await audit.list(req.ctx, q));
  });

  return [r];
};
