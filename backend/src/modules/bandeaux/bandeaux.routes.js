const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const Org = z.object({ orgId: Id });
const OrgId = Org.extend({ id: Id });
const T = ['bandeau d’information'];
const Corps = z.object({
  message: z.string().min(3).max(500).describe('Texte du message (3 à 500 caractères)'),
  debut: z.iso.datetime({ offset: true }).describe('Début de l’affichage (ISO 8601)'), fin: z.iso.datetime({ offset: true }).describe('Fin de l’affichage (ISO 8601), postérieure au début'),
  actif: z.boolean().optional().describe('Interrupteur : un message désactivé n’est jamais affiché'),
});
const ADMIN = ['org_admin', 'scc'];

module.exports = ({ makeRouter, bandeaux }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/bandeaux');
  r.get('/actifs', { summary: 'Messages du bandeau à afficher maintenant (tous les utilisateurs)', tags: T, org: true, params: Org }, async (req, res) => res.json(await bandeaux.actifs(req.org.id)));
  r.get('/', { summary: 'Tous les messages du bandeau (programmés, en cours, terminés) — SCC et administrateur', tags: T, org: true, roles: ADMIN, params: Org }, async (req, res) => res.json(await bandeaux.lister(req.org.id)));
  r.post('/', { summary: 'Crée un message du bandeau', tags: T, org: true, roles: ADMIN, params: Org, body: Corps, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await bandeaux.creer(req.ctx, req.org.id, req.valid.body)));
  r.put('/:id', { summary: 'Modifie un message du bandeau', tags: T, org: true, roles: ADMIN, params: OrgId, body: Corps.partial() },
    async (req, res) => res.json(await bandeaux.modifier(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/:id', { summary: 'Supprime un message du bandeau', tags: T, org: true, roles: ADMIN, params: OrgId },
    async (req, res) => res.json(await bandeaux.supprimer(req.ctx, req.org.id, req.valid.params.id)));

  // espace des élus : mêmes messages (jeton d'élu)
  const e = makeRouter('/api/v1/elus/bandeaux');
  e.get('/', { summary: 'Messages du bandeau à afficher maintenant aux élus', tags: T, elu: true }, async (req, res) => res.json(await bandeaux.actifs(req.elu.organismeId)));
  return [r, e];
};
