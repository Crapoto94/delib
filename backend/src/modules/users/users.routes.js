const { z } = require('zod');
const { ORG_ROLES } = require('../organismes/organismes.service');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PU = P.extend({ username: z.string().trim().min(1).max(128) });
const PR = P.extend({ roleId: Id });
const Q = z.object({ q: z.string().trim().min(2).max(80) });
const Grant = z.object({ role: z.enum(ORG_ROLES) });

module.exports = ({ makeRouter, users }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/utilisateurs');
  const T = ['utilisateurs'];
  const ADMIN = ['org_admin'];

  r.get('/', { summary: 'Recherche un agent (nom, identifiant, e-mail) et montre ses rôles', tags: T, org: true, roles: ADMIN, params: P, query: Q,
    description: "Agents déjà connectés à l'application + annuaire RH. Les rôles renvoyés sont ceux de l'organisme courant." },
  async (req, res) => res.json({ items: await users.search(req.ctx, req.org.id, req.valid.query.q) }));

  r.get('/:username', { summary: "Fiche et accès d'un utilisateur dans l'organisme", tags: T, org: true, roles: ADMIN, params: PU,
    description: 'Rôles, organismes accessibles (et pourquoi), titulaires, groupes de valideurs, autorisations de rédaction, délégations.' },
  async (req, res) => res.json(await users.fiche(req.ctx, req.org.id, req.valid.params.username)));

  r.post('/:username/roles', { summary: 'Attribue un rôle à un utilisateur', tags: T, org: true, roles: ADMIN, params: PU, body: Grant, responses: { 201: 'Créé' },
    description: 'Rôles : org_admin, scc, teletransmission, lecteur. Le rôle d\'administrateur de plateforme se gère dans /platform/admins.' },
  async (req, res) => res.status(201).json(await users.grant(req.ctx, req.org.id, req.valid.params.username, req.valid.body.role)));

  r.delete('/roles/:roleId', { summary: 'Retire un rôle (jamais le dernier administrateur)', tags: T, org: true, roles: ADMIN, params: PR, responses: { 204: 'Supprimé' } },
    async (req, res) => { await users.revoke(req.ctx, req.org.id, req.valid.params.roleId); res.status(204).end(); });

  return [r];
};
