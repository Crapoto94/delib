const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id, id: Id });
const PC = P.extend({ commentId: Id });
const Body = z.object({ body: z.string().trim().min(1).max(10000), title: z.string().trim().max(200).optional(), parentId: z.number().int().positive().optional() });
const Resolve = z.object({ resolved: z.boolean() });
const Hide = z.object({ hidden: z.boolean() });

module.exports = ({ makeRouter, comments }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/actes/:id/commentaires');

  r.get('/', { summary: "Fil de discussion d'un acte", tags: ['commentaires'], org: true, params: P,
    description: "Visible de toutes les personnes du circuit, y compris avant leur tour (VIS-01). Les motifs de refus y figurent (kind = refus)." },
  async (req, res) => res.json({ items: await comments.list(req.ctx, req.org.id, req.valid.params.id) }));

  r.post('/', { summary: 'Ajoute un commentaire ou une réponse', tags: ['commentaires'], org: true, params: P, body: Body, responses: { 201: 'Créé' },
    description: 'Les mentions `@identifiant` notifient la personne (COM-03).' },
  async (req, res) => res.status(201).json(await comments.add(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.put('/:commentId/resolution', { summary: 'Marque un commentaire comme traité', tags: ['commentaires'], org: true, params: PC, body: Resolve },
    async (req, res) => res.json(await comments.resolve(req.ctx, req.org.id, req.valid.params.id, req.valid.params.commentId, req.valid.body.resolved)));

  r.put('/:commentId/masquage', { summary: 'Masque un commentaire (administrateur / SCC, avec trace)', tags: ['commentaires'], org: true, params: PC, body: Hide },
    async (req, res) => res.json(await comments.hide(req.ctx, req.org.id, req.valid.params.id, req.valid.params.commentId, req.valid.body.hidden)));

  return [r];
};
