const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const Org = z.object({ orgId: Id });
const PId = Org.extend({ id: Id });
const PDir = Org.extend({ code: z.string().trim().min(1).max(40) });
const Poste = z.object({
  libelle: z.string().trim().min(2).max(120).describe('Ex. « DGA Ressources »'),
  username: z.string().trim().min(1).max(128).optional(), suppleant: z.string().trim().max(128).optional(), vacant: z.boolean().default(false),
});
const Rattachement = z.object({ rattachement: z.enum(['dga', 'dgs']).nullable(), dgaPosteId: Id.optional() });
const Adopt = z.object({ fonction: z.enum(['directeur', 'chef_service', 'dgs']), directionCode: z.string().trim().max(40).optional(), serviceCode: z.string().trim().max(40).optional() })
  .refine((d) => d.fonction === 'dgs' || !!d.directionCode, { message: 'directionCode est obligatoire', path: ['directionCode'] });
const T = ['organisation'];

module.exports = ({ makeRouter, organisation, titulaires }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/organisation');

  r.get('/', { summary: "Organisation : DGS, postes de DGA, directions et services avec leurs responsables (personne, vacant, implicite ou à renseigner)", tags: T, org: true, roles: ['org_admin', 'scc'], params: Org,
    description: "Sert à vérifier, rôle par rôle, qu'il y a quelqu'un pour valider. Un rôle est : `personne`, `vacant` (déclaré ou vacant dans l'organigramme RH — l'étape est contournée), `implicite` (service qui porte le nom de sa direction : le directeur), `direct_dgs` (direction rattachée directement à la DGS : pas de DGA), `non_defini` (rattachement à définir) ou `non_renseigne` (le circuit serait bloqué)." },
  async (req, res) => res.json(await organisation.view(req.org.id)));

  r.post('/adopter', { summary: "Désigne le responsable indiqué par l'organigramme RH", tags: T, org: true, params: Org, body: Adopt, responses: { 201: 'Créé' },
    description: "Retrouve l'identifiant de connexion du responsable RH ; 409 s'il est vacant, introuvable ou ambigu (il faut alors le désigner à la main)." },
  async (req, res) => res.status(201).json(await organisation.adopter(req.ctx, req.org.id, req.valid.body)));

  r.get('/postes-dga', { summary: 'Postes de DGA et directions qu\'ils encadrent', tags: T, org: true, roles: ['org_admin', 'scc'], params: Org },
    async (req, res) => res.json({ items: await titulaires.postes(req.org.id) }));
  r.post('/postes-dga', { summary: 'Crée un poste de DGA (titulaire, ou vacant)', tags: T, org: true, roles: ['org_admin'], params: Org, body: Poste, responses: { 201: 'Créé' },
    description: 'Un DGA encadre plusieurs directions et répond toujours à la DGS.' },
  async (req, res) => res.status(201).json(await titulaires.createPoste(req.ctx, req.org.id, req.valid.body)));
  r.put('/postes-dga/:id', { summary: 'Modifie un poste de DGA (titulaire, suppléant, vacance)', tags: T, org: true, roles: ['org_admin'], params: PId, body: Poste },
    async (req, res) => res.json(await titulaires.updatePoste(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/postes-dga/:id', { summary: 'Supprime un poste de DGA (409 tant qu\'il encadre des directions)', tags: T, org: true, roles: ['org_admin'], params: PId, responses: { 204: 'Supprimé' } },
    async (req, res) => { await titulaires.deletePoste(req.ctx, req.org.id, req.valid.params.id); res.status(204).end(); });

  r.put('/directions/:code/rattachement', { summary: 'Rattache une direction à un poste de DGA, ou directement à la DGS (null : retire)', tags: T, org: true, roles: ['org_admin'], params: PDir, body: Rattachement },
    async (req, res) => res.json({ rattachement: await titulaires.setRattachement(req.ctx, req.org.id, req.valid.params.code, req.valid.body) }));

  return [r];
};
