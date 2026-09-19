const { z } = require('zod');

const Org = z.object({ orgId: z.coerce.number().int().positive() });
const IdP = Org.extend({ id: z.coerce.number().int().positive() });
const ListQ = z.object({ directionCode: z.string().max(40).optional(), includeRevoked: z.enum(['true', 'false']).default('false') });
const Grant = z.object({
  directionCode: z.string().trim().min(1).max(40), serviceCode: z.string().trim().max(40).optional(),
  username: z.string().trim().min(1).max(128), expiresAt: z.iso.datetime().optional(), motif: z.string().max(500).optional(),
});

module.exports = ({ makeRouter, redaction }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/redaction');

  r.get('/directions', {
    summary: 'Directions pour lesquelles je peux créer un acte', tags: ['droits de rédaction'], org: true, params: Org,
    description: 'Ma direction (droit par défaut, selon la politique de l\'organisme) et les directions où j\'ai une autorisation étendue. Alimente le choix de la direction porteuse (DRO-03).',
  }, async (req, res) => res.json({ items: await redaction.draftableDirections(req.ctx, req.org.id) }));

  r.get('/autorisations', {
    summary: 'Autorisations de rédaction (mon périmètre)', tags: ['droits de rédaction'], org: true, params: Org, query: ListQ,
    description: "L'administrateur voit tout ; un directeur ou un chef de service ne voit que son périmètre (DRO-06).",
  }, async (req, res) => res.json({ items: await redaction.list(req.ctx, req.org.id, { directionCode: req.valid.query.directionCode, includeRevoked: req.valid.query.includeRevoked === 'true' }) }));

  r.post('/autorisations', {
    summary: 'Autorise un agent à rédiger pour une direction ou un service', tags: ['droits de rédaction'], org: true, params: Org, body: Grant, responses: { 201: 'Créé' },
    description: 'Directeur (sa direction), chef de service (son service) ou administrateur (DRO-04). Durée illimitée ou bornée (expiresAt).',
  }, async (req, res) => res.status(201).json(await redaction.grant(req.ctx, req.org.id, req.valid.body)));

  r.delete('/autorisations/:id', { summary: 'Révoque une autorisation', tags: ['droits de rédaction'], org: true, params: IdP },
    async (req, res) => res.json(await redaction.revoke(req.ctx, req.org.id, req.valid.params.id)));

  return [r];
};
