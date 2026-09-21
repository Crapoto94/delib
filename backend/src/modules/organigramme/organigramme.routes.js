const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const Org = z.object({ orgId: Id });
const PE = Org.extend({ id: Id });
const Entite = z.object({
  type: z.enum(['direction', 'service']),
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
  parentCode: z.string().trim().max(40).optional(),
  ordre: z.number().int().optional(),
});
const Patch = z.object({ label: z.string().trim().max(200).optional(), ordre: z.number().int().optional(), actif: z.boolean().optional() });
const T = ['organisation'];

module.exports = ({ makeRouter, organigramme }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/organigramme');

  r.get('/', {
    summary: "Organigramme : directions et services (Hub DSI + surcharges locales)", tags: T, org: true, params: Org,
    description: '`source` : `hub` (organigramme RH), `local` (ajouté ici), `mixte` (libellé corrigé localement).',
  }, async (req, res) => res.json(await organigramme.list(req.ctx, req.org.id)));

  r.post('/rafraichir', { summary: "Met à jour l'organigramme depuis le Hub DSI", tags: T, org: true, roles: ['org_admin'], params: Org },
    async (req, res) => res.json(await organigramme.rafraichir(req.ctx, req.org.id)));

  r.post('/entites', {
    summary: 'Ajoute (ou corrige) une direction/service local', tags: T, org: true, roles: ['org_admin'], params: Org, body: Entite, responses: { 201: 'Créé' },
    description: 'Un code déjà présent dans l’organigramme du Hub corrige son libellé ; un code nouveau ajoute une direction/service.',
  }, async (req, res) => res.status(201).json(await organigramme.ajouter(req.ctx, req.org.id, req.valid.body)));

  r.put('/entites/:id', { summary: 'Modifie une entité locale', tags: T, org: true, roles: ['org_admin'], params: PE, body: Patch },
    async (req, res) => res.json(await organigramme.modifier(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.delete('/entites/:id', { summary: 'Supprime une entité locale', tags: T, org: true, roles: ['org_admin'], params: PE },
    async (req, res) => res.json(await organigramme.supprimer(req.ctx, req.org.id, req.valid.params.id)));

  return [r];
};
