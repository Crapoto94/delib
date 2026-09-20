const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PE = P.extend({ eluId: Id });
const PS = P.extend({ id: Id });
const ADMIN = ['org_admin', 'scc'];
const T = ['espace élus'];

module.exports = ({ makeRouter, eluAuth, espace }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/espace-elus');
  r.get('/comptes', { summary: 'Comptes de l’espace élus : chaque élu, l’état de son accès (aucun, invité, actif, désactivé)', tags: T, org: true, roles: ADMIN, params: P,
    description: 'Jamais de mot de passe ni de lien. Le SCC ne peut ni lire ni réinitialiser un mot de passe : il renvoie une invitation.' },
  async (req, res) => res.json(await eluAuth.comptes(req.org.id)));
  r.post('/comptes/:eluId/invitation', { summary: 'Invite un élu (ou renvoie l’invitation) : un lien personnel à usage unique lui est envoyé par mail', tags: T, org: true, roles: ADMIN, params: PE, responses: { 201: 'Envoyée' } },
    async (req, res) => res.status(201).json(await eluAuth.inviter(req.ctx, req.org.id, req.valid.params.eluId)));
  r.put('/comptes/:eluId/actif', { summary: 'Active ou désactive l’accès d’un élu (ses sessions sont révoquées)', tags: T, org: true, roles: ADMIN, params: PE, body: z.object({ actif: z.boolean() }) },
    async (req, res) => res.json(await eluAuth.desactiver(req.ctx, req.org.id, req.valid.params.eluId, req.valid.body.actif)));
  r.get('/seances/:id/consultations', { summary: 'Preuve de consultation : par élu, nombre de documents lus, ouvertures, première et dernière lecture', tags: T, org: true, roles: ADMIN, params: PS,
    description: 'Métadonnées seulement : les notes personnelles des élus ne sont jamais accessibles aux agents (ELU-33).' },
  async (req, res) => res.json(await espace.consultations(req.org.id, req.valid.params.id)));
  return [r];
};
