const { z } = require('zod');
const { E } = require('../../shared/errors');

const Query = z.object({
  organismeId: z.coerce.number().int().positive().optional(),
  action: z.string().max(80).optional(),
  actor: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const Org = z.object({ orgId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });

module.exports = ({ makeRouter, audit, access, acl, actes }) => {
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

  const j = makeRouter('/api/v1/organismes/:orgId/actes/:id/journal');
  j.get('/', {
    summary: "Journal de l'acte : les actions réalisées sur ce dossier", tags: ['audit'], org: true, params: Org,
    description: "Administrateur et SCC uniquement. Tiré du journal d'audit immuable : qui, quoi, quand, avec le détail avant/après. Du plus récent au plus ancien (500 lignes au plus).",
  }, async (req, res) => {
    const { id } = req.valid.params;
    if (!acl.isAdmin(req.ctx, req.org.id)) throw E.forbidden("Réservé à l'administrateur et au SCC");
    const a = await actes.load(req.ctx, req.org.id, id);
    res.json(await audit.forActe(a.organisme_id, a.id));
  });

  return [r, j];
};
