const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PE = P.extend({ eluId: Id });
const PS = P.extend({ id: Id });
const ADMIN = ['org_admin', 'scc'];
const T = ['espace élus'];

const OublisQ = z.object({ evenement: z.enum(['demande', 'code_envoye', 'code_refuse', 'code_expire', 'code_valide', 'compte_inconnu', 'sans_mobile', 'echec_envoi', 'limite']).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

module.exports = ({ makeRouter, eluAuth, espace, annotations, sms }) => {
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
  r.get('/seances/:id/annotations-meta', { summary: 'Annotations d’une séance : compteurs seulement (annotations, partagées, élus ayant annoté)', tags: T, org: true, roles: ADMIN, params: PS,
    description: 'Le contenu, les auteurs et les destinataires ne sont jamais accessibles aux agents (ELU-72).' }, async (req, res) => res.json(await annotations.metadonnees(req.org.id, req.valid.params.id)));
  r.delete('/comptes/:eluId/annotations', { summary: 'Purge toutes les annotations d’un élu (fin de mandat, demande RGPD)', tags: T, org: true, roles: ['org_admin'], params: PE },
    async (req, res) => res.json(await annotations.purger(req.ctx, req.org.id, req.valid.params.eluId)));
  r.get('/oublis', { summary: 'Journal des oublis de mot de passe (demandes, codes envoyés / refusés / expirés, comptes inconnus, mobiles manquants, échecs d’envoi, connexions par SMS) avec compteurs des dernières 24 h', tags: T, org: true, roles: ADMIN, params: P, query: OublisQ,
    description: 'Aucun code n’y figure.' }, async (req, res) => res.json(await eluAuth.oublis(req.org.id, req.valid.query)));
  r.put('/sms', { summary: 'Configure la passerelle SMS (simulation ou passerelle HTTP) ; le jeton est chiffré et jamais renvoyé', tags: T, org: true, roles: ['org_admin'], params: P,
    body: z.object({ mode: z.enum(['simulation', 'http']).optional(), url: z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/.+/i.test(v), 'URL http(s) attendue').optional(), expediteur: z.string().trim().max(11).optional(),
      modele: z.string().max(1000).optional().describe('Corps JSON avec {to}, {message}, {expediteur}'), jeton: z.string().max(500).optional().describe('Vide : conservé') }) },
  async (req, res) => res.json({ config: await sms.enregistrer(req.ctx, req.org.id, req.valid.body) }));
  r.get('/sms', { summary: 'Passerelle SMS : configuration (sans le jeton) et derniers messages (le texte n’est lisible qu’en simulation)', tags: T, org: true, roles: ['org_admin'], params: P },
    async (req, res) => res.json({ config: await sms.config(req.org.id), journal: await sms.journal(req.org.id) }));
  return [r];
};
