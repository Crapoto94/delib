const { z } = require('zod');
const { ORG_ROLES } = require('../organismes/organismes.service');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PU = P.extend({ username: z.string().trim().min(1).max(128) });
const PR = P.extend({ roleId: Id });
const Q = z.object({ q: z.string().trim().min(2).max(80).optional(), avecRole: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'), limit: z.coerce.number().int().min(1).max(300).default(100), offset: z.coerce.number().int().min(0).default(0) });
const Grant = z.object({ role: z.enum(ORG_ROLES) });
const MODES = ['redacteur', 'service', 'direction'];
const VisUser = z.object({ visibilite: z.enum(MODES).nullable().describe('null : suit le réglage général de l\u2019organisme') });
const VisGen = z.object({ visibilite: z.enum(MODES) });

module.exports = ({ makeRouter, users }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/utilisateurs');
  const T = ['utilisateurs'];
  const ADMIN = ['org_admin'];

  r.get('/', { summary: 'Recherche un agent (nom, identifiant, e-mail) et montre ses rôles', tags: T, org: true, roles: ADMIN, params: P, query: Q,
    description: "Agents déjà connectés à l'application + annuaire RH. Les rôles renvoyés sont ceux de l'organisme courant." },
  async (req, res) => res.json({ items: await users.search(req.ctx, req.org.id, req.valid.query.q, req.valid.query) }));

  r.get('/:username', { summary: "Fiche et accès d'un utilisateur dans l'organisme", tags: T, org: true, roles: ADMIN, params: PU,
    description: 'Rôles, organismes accessibles (et pourquoi), titulaires, groupes de valideurs, autorisations de rédaction, délégations.' },
  async (req, res) => res.json(await users.fiche(req.ctx, req.org.id, req.valid.params.username)));

  r.post('/:username/roles', { summary: 'Attribue un rôle à un utilisateur', tags: T, org: true, roles: ADMIN, params: PU, body: Grant, responses: { 201: 'Créé' },
    description: 'Rôles : org_admin, scc, teletransmission, lecteur. Le rôle d\'administrateur de plateforme se gère dans /platform/admins.' },
  async (req, res) => res.status(201).json(await users.grant(req.ctx, req.org.id, req.valid.params.username, req.valid.body.role)));

  r.delete('/roles/:roleId', { summary: 'Retire un rôle (jamais le dernier administrateur)', tags: T, org: true, roles: ADMIN, params: PR, responses: { 204: 'Supprimé' } },
    async (req, res) => { await users.revoke(req.ctx, req.org.id, req.valid.params.roleId); res.status(204).end(); });

  r.get('/:username/visibilite-actes', { summary: "Visibilité des actes d'un utilisateur (réglage personnel et réglage général)", tags: T, org: true, roles: ADMIN, params: PU },
    async (req, res) => res.json(await users.visibiliteUtilisateur(req.org.id, req.valid.params.username)));
  r.put('/:username/visibilite-actes', { summary: "Règle la visibilité des actes d'un utilisateur (null : suit le réglage général)", tags: T, org: true, roles: ADMIN, params: PU, body: VisUser,
    description: "Rédacteur uniquement : ses actes, ceux dont il est co-rédacteur ou participant. Service : + les actes de son service. Direction : + les actes de sa direction. La hiérarchie (directeur, chef de service, DGA), le SCC et les administrateurs gardent leur périmètre (D72)." },
  async (req, res) => res.json(await users.setVisibiliteUtilisateur(req.ctx, req.org.id, req.valid.params.username, req.valid.body.visibilite)));

  const g = makeRouter('/api/v1/organismes/:orgId/visibilite-actes');
  g.get('/', { summary: 'Réglage général de la visibilité des actes', tags: T, org: true, roles: ['org_admin', 'scc'], params: P },
    async (req, res) => res.json(await users.visibiliteGenerale(req.org.id)));
  g.put('/', { summary: "Règle la visibilité générale des actes de l'organisme (redacteur, service ou direction)", tags: T, org: true, roles: ADMIN, params: P, body: VisGen,
    description: "S'applique à tous les utilisateurs qui n'ont pas de réglage personnel ; défaut : `service`." },
  async (req, res) => res.json(await users.setVisibiliteGenerale(req.ctx, req.org.id, req.valid.body.visibilite)));

  return [r, g];
};
