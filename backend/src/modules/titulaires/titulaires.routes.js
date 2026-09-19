const { z } = require('zod');
const { FONCTIONS } = require('./titulaires.service');
const { E } = require('../../shared/errors');

const Org = z.object({ orgId: z.coerce.number().int().positive() });
const IdP = Org.extend({ id: z.coerce.number().int().positive() });
const ListQ = z.object({ fonction: z.enum(FONCTIONS).optional(), directionCode: z.string().max(40).optional(), serviceCode: z.string().max(40).optional() });
const Add = z.object({
  fonction: z.enum(FONCTIONS), username: z.string().trim().min(1).max(128),
  directionCode: z.string().trim().max(40).optional(), serviceCode: z.string().trim().max(40).optional(),
  suppleant: z.string().trim().max(128).optional(), validFrom: z.iso.date().optional(), validTo: z.iso.date().optional(),
}).refine((d) => !d.serviceCode || d.directionCode, { message: 'serviceCode exige directionCode', path: ['serviceCode'] });
const Group = z.object({ code: z.string().regex(/^[a-z0-9_-]{2,40}$/), nom: z.string().trim().min(2).max(120) });
const Members = z.object({ usernames: z.array(z.string().trim().min(1).max(128)).max(200) });

module.exports = ({ makeRouter, titulaires, dir }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/titulaires', { summary: "Table des titulaires de l'organisme", tags: ['titulaires'], org: true, params: Org, query: ListQ },
    async (req, res) => res.json({ items: await titulaires.list(req.org.id, req.valid.query) }));

  r.post('/titulaires', {
    summary: 'Désigne un titulaire (saisie manuelle)', tags: ['titulaires'], org: true, params: Org, body: Add, responses: { 201: 'Créé' },
    description: "Administrateur d'organisme : tous périmètres. Directeur : sa direction. Chef de service : son service (D31). Le périmètre se déduit de directionCode / serviceCode.",
  }, async (req, res) => res.status(201).json(await titulaires.add(req.ctx, req.org.id, req.valid.body)));

  r.delete('/titulaires/:id', { summary: 'Retire un titulaire', tags: ['titulaires'], org: true, params: IdP, responses: { 204: 'Supprimé' } },
    async (req, res) => { await titulaires.remove(req.ctx, req.org.id, req.valid.params.id); res.status(204).end(); });

  r.get('/titulaires/suggestions', {
    summary: 'Suggestions RH pour la table des titulaires', tags: ['titulaires'], org: true, roles: ['org_admin'], params: Org,
    description: "Organigramme RH (directions, services, responsables). Ne sert qu'à PROPOSER : jamais appliqué automatiquement.",
  }, async (req, res) => { if (!req.ctx.isPlatformAdmin && !req.orgRoles.includes('org_admin')) throw E.forbidden(); res.json({ items: await dir.organisationChart() }); });

  r.get('/groupes', { summary: 'Groupes de valideurs (Service financier, juridique, SCC…)', tags: ['titulaires'], org: true, params: Org },
    async (req, res) => res.json({ items: await titulaires.groups(req.org.id) }));
  r.post('/groupes', { summary: 'Crée un groupe de valideurs', tags: ['titulaires'], org: true, roles: ['org_admin'], params: Org, body: Group, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await titulaires.createGroup(req.ctx, req.org.id, req.valid.body)));
  r.put('/groupes/:id/membres', { summary: "Remplace les membres d'un groupe", tags: ['titulaires'], org: true, roles: ['org_admin'], params: IdP, body: Members },
    async (req, res) => res.json(await titulaires.setGroupMembers(req.ctx, req.org.id, req.valid.params.id, req.valid.body.usernames)));
  r.delete('/groupes/:id', { summary: 'Supprime un groupe', tags: ['titulaires'], org: true, roles: ['org_admin'], params: IdP, responses: { 204: 'Supprimé' } },
    async (req, res) => { await titulaires.deleteGroup(req.ctx, req.org.id, req.valid.params.id); res.status(204).end(); });

  return [r];
};
