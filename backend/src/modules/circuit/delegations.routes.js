const { z } = require('zod');
const { SCOPES } = require('./delegations.service');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PD = P.extend({ id: Id });
const ListQ = z.object({ scope: z.enum(['mine', 'all']).default('mine') });
const Rights = z.object({ validate: z.boolean(), refuse: z.boolean(), comment: z.boolean(), edit: z.boolean() }).partial();
const Create = z.object({
  delegue: z.string().trim().min(1).max(128), delegant: z.string().trim().max(128).optional().describe("Par défaut : moi (un administrateur peut créer pour un autre)"),
  scope: z.enum(SCOPES), scopeValue: z.union([z.string().max(60), z.number()]).optional(),
  startsAt: z.iso.datetime().optional(), endsAt: z.iso.datetime().optional(), motif: z.string().max(500).optional(), rights: Rights.optional(),
});
const ActeDeleg = z.object({ delegue: z.string().trim().min(1).max(128), endsAt: z.iso.datetime().optional(), motif: z.string().max(500).optional(), rights: Rights.optional() });

module.exports = ({ makeRouter, delegations }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/delegations', {
    summary: 'Mes délégations (données et reçues) — ou toutes (directeur / administrateur)', tags: ['délégations'], org: true, params: P, query: ListQ,
    description: 'Un directeur voit celles de sa direction ; l\'administrateur voit tout (CIR-39).',
  }, async (req, res) => res.json({ items: await delegations.list(req.ctx, req.org.id, req.valid.query) }));

  r.post('/delegations', {
    summary: 'Délègue mes décisions', tags: ['délégations'], org: true, params: P, body: Create, responses: { 201: 'Créé' },
    description: "Portée : `all`, `step` (clé d'étape), `type_acte` (code), `direction` (code), `acte` (identifiant). Durée bornée ou jusqu'à révocation. Co-détention : je garde mes droits. Refusée : délégué = rédacteur de l'acte (à l'usage), étape non déléguable, cycle A→B→A, sous-délégation.",
  }, async (req, res) => res.status(201).json(await delegations.create(req.ctx, req.org.id, req.valid.body)));

  r.delete('/delegations/:id', { summary: 'Révoque une délégation (effet immédiat)', tags: ['délégations'], org: true, params: PD },
    async (req, res) => res.json(await delegations.revoke(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/actes/:id/deleguer', {
    summary: 'Délègue cet acte précis', tags: ['délégations'], org: true, params: PD, body: ActeDeleg, responses: { 201: 'Créé' },
    description: '« Déléguer cet acte » depuis le dossier : délégation de portée `acte`.',
  }, async (req, res) => res.status(201).json(await delegations.create(req.ctx, req.org.id, { ...req.valid.body, scope: 'acte', scopeValue: req.valid.params.id })));

  return [r];
};
