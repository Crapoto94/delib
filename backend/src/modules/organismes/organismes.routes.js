const { z } = require('zod');
const { ORG_ROLES } = require('./organismes.service');

const OrgParams = z.object({ orgId: z.coerce.number().int().positive() });
const RoleParams = OrgParams.extend({ roleId: z.coerce.number().int().positive() });
const AdminParams = z.object({ roleId: z.coerce.number().int().positive() });

const Create = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,40}$/, 'minuscules, chiffres, - et _ (2 à 40 caractères)'),
  nom: z.string().trim().min(2).max(200),
  type: z.enum(['commune', 'ccas', 'autre']).default('commune'),
  siren: z.string().regex(/^[0-9]{9}$/, '9 chiffres').optional(),
  adresse: z.string().max(500).optional(),
  couleurs: z.record(z.string(), z.string().max(40)).optional(),
  vocabulaire: z.record(z.string(), z.string().max(120)).optional(),
});
const Update = Create.omit({ code: true }).partial().extend({ actif: z.boolean().optional() });
const Directions = z.object({
  directions: z.array(z.object({ code: z.string().trim().min(1).max(40), label: z.string().trim().max(200).optional() })).max(500),
});
const RoleBody = z.object({ username: z.string().trim().min(1).max(128), role: z.enum(ORG_ROLES) });
const AdminBody = z.object({ username: z.string().trim().min(1).max(128) });

module.exports = ({ makeRouter, organismes }) => {
  const r = makeRouter('/api/v1/organismes');

  r.get('/', {
    summary: "Organismes accessibles à l'utilisateur", tags: ['organismes'],
    description: 'Un administrateur de plateforme voit tous les organismes ; un agent voit ceux où il a un rôle ou dont sa direction dépend.',
  }, (req, res) => res.json({ items: req.ctx.organismes.map(({ roles, via, ...o }) => ({ ...o, roles, via })) }));

  r.post('/', { summary: 'Crée un organisme', tags: ['organismes'], platform: true, body: Create, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await organismes.create(req.ctx, req.valid.body)));

  r.get('/:orgId', { summary: "Détail d'un organisme", tags: ['organismes'], org: true, params: OrgParams },
    (req, res) => res.json(req.org));

  r.put('/:orgId', { summary: 'Modifie un organisme', tags: ['organismes'], org: true, roles: ['org_admin'], params: OrgParams, body: Update },
    async (req, res) => res.json(await organismes.update(req.ctx, req.org.id, req.valid.body)));

  r.get('/:orgId/directions', { summary: "Directions rattachées à l'organisme", tags: ['organismes'], org: true, params: OrgParams },
    async (req, res) => res.json({ items: await organismes.directions(req.ctx, req.org.id) }));

  r.put('/:orgId/directions', {
    summary: "Remplace les directions rattachées à l'organisme", tags: ['organismes'], org: true, platform: true, params: OrgParams, body: Directions,
    description: "Une direction (code de l'organigramme RH) n'appartient qu'à un seul organisme ; 409 si l'une d'elles est déjà rattachée ailleurs. Les agents dont la direction est rattachée sont de cet organisme ; les autres relèvent de l'organisme par défaut.",
  }, async (req, res) => res.json({ items: await organismes.setDirections(req.ctx, req.org.id, req.valid.body.directions) }));

  r.get('/:orgId/roles', { summary: "Rôles attribués dans l'organisme", tags: ['organismes'], org: true, roles: ['org_admin'], params: OrgParams },
    async (req, res) => res.json({ items: await organismes.listRoles(req.ctx, req.org.id) }));

  r.post('/:orgId/roles', {
    summary: 'Attribue un rôle dans l\'organisme', tags: ['organismes'], org: true, roles: ['org_admin'], params: OrgParams, body: RoleBody, responses: { 201: 'Créé' },
  }, async (req, res) => res.status(201).json(await organismes.addRole(req.ctx, req.org.id, req.valid.body.username, req.valid.body.role)));

  r.delete('/:orgId/roles/:roleId', {
    summary: 'Retire un rôle', tags: ['organismes'], org: true, roles: ['org_admin'], params: RoleParams, responses: { 204: 'Supprimé' },
  }, async (req, res) => { await organismes.removeRole(req.ctx, req.org.id, req.valid.params.roleId); res.status(204).end(); });

  const p = makeRouter('/api/v1/platform/admins');
  p.get('/', { summary: 'Administrateurs de plateforme', tags: ['plateforme'], platform: true },
    async (req, res) => res.json({ items: await organismes.listPlatformAdmins() }));
  p.post('/', { summary: 'Ajoute un administrateur de plateforme', tags: ['plateforme'], platform: true, body: AdminBody, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await organismes.addPlatformAdmin(req.ctx, req.valid.body.username)));
  p.delete('/:roleId', { summary: 'Retire un administrateur de plateforme', tags: ['plateforme'], platform: true, params: AdminParams, responses: { 204: 'Supprimé' } },
    async (req, res) => { await organismes.removePlatformAdmin(req.ctx, req.valid.params.roleId); res.status(204).end(); });

  return [r, p];
};
