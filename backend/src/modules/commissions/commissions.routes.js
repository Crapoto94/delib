const { z } = require('zod');
const { AVIS, FONCTIONS } = require('./commissions.service');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PC = P.extend({ id: Id });
const PA = P.extend({ id: Id });
const PAC = PA.extend({ commissionId: Id });
const ADMIN = ['org_admin', 'scc'];

const Commission = z.object({
  nom: z.string().trim().min(2).max(160), description: z.string().max(1000).optional(), couleur: z.string().max(20).optional(), ordre: z.number().int().optional(),
  matieres: z.array(z.string().max(20)).max(100).optional(), directions: z.array(z.string().max(40)).max(50).optional(),
  thematiques: z.array(z.string().max(200)).max(100).optional(), sieges: z.number().int().min(1).max(100).nullable().optional(), siegesOpposition: z.number().int().min(0).max(100).nullable().optional(),
});
const CommissionPatch = Commission.partial().extend({ actif: z.boolean().optional() });
const Membres = z.object({ membres: z.array(z.object({ eluId: Id, fonction: z.enum(FONCTIONS).default('membre'), dateDebut: z.iso.date().optional(), dateFin: z.iso.date().optional() })).max(200) });
const Secretaires = z.object({ usernames: z.array(z.string().trim().min(1).max(128)).max(20) });
const AddC = z.object({ commissionId: Id });
const Del = z.object({ motif: z.string().trim().min(3).max(500).optional() });
const Avis = z.object({ avis: z.enum(AVIS), commentaire: z.string().trim().max(2000).optional(), datePassage: z.iso.date().optional() });
const ListQ = z.object({ actif: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

const Reunion = z.object({
  dateSeance: z.iso.datetime(), dureeMinutes: z.number().int().min(15).max(720).optional(), lieu: z.string().max(200).optional(),
  teams: z.object({ mode: z.enum(['auto', 'lien', 'aucun']), joinUrl: z.string().url().optional(), inviter: z.boolean().default(false) }).optional(),
}).refine((d) => d.teams?.mode !== 'lien' || !!d.teams.joinUrl, { message: 'Le lien Teams est obligatoire', path: ['teams', 'joinUrl'] });

module.exports = ({ makeRouter, commissions, seances }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');
  const T = ['commissions'];

  r.get('/commissions', { summary: 'Commissions de l\'organisme', tags: T, org: true, params: P, query: ListQ },
    async (req, res) => res.json({ items: await commissions.list(req.org.id, req.valid.query) }));
  r.post('/commissions', { summary: 'Crée une commission', tags: T, org: true, roles: ADMIN, params: P, body: Commission, responses: { 201: 'Créé' },
    description: 'Toutes les commissions sont « pour avis » (D29). Les matières et directions ne servent qu\'à SUGGÉRER la commission à la création d\'un acte.' },
  async (req, res) => res.status(201).json(await commissions.create(req.ctx, req.org.id, req.valid.body)));
  r.get('/commissions/:id', { summary: 'Commission, membres et secrétaires', tags: T, org: true, params: PC },
    async (req, res) => res.json(await commissions.get(req.org.id, req.valid.params.id)));
  r.put('/commissions/:id', { summary: 'Modifie une commission', tags: T, org: true, roles: ADMIN, params: PC, body: CommissionPatch },
    async (req, res) => res.json(await commissions.update(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.put('/commissions/:id/membres', { summary: 'Remplace les membres élus (un président au plus)', tags: T, org: true, roles: ADMIN, params: PC, body: Membres },
    async (req, res) => res.json(await commissions.setMembres(req.ctx, req.org.id, req.valid.params.id, req.valid.body.membres)));
  r.put('/commissions/:id/secretaires', { summary: 'Remplace les secrétaires (agents)', tags: T, org: true, roles: ADMIN, params: PC, body: Secretaires },
    async (req, res) => res.json(await commissions.setSecretaires(req.ctx, req.org.id, req.valid.params.id, req.valid.body.usernames)));

  r.get('/commissions/:id/reunions', { summary: "Réunions d'une commission (passées et à venir), avec le nombre de projets présentés", tags: T, org: true, params: PC },
    async (req, res) => res.json({ items: await seances.reunions(req.org.id, req.valid.params.id) }));
  r.post('/commissions/:id/reunions', { summary: 'Planifie une réunion de commission (avec Teams facultatif)', tags: T, org: true, roles: ADMIN, params: PC, body: Reunion, responses: { 201: 'Créé' },
    description: "Une réunion est une séance de l'instance de la commission : son ordre du jour (`/seances/:id/odj`) liste les PROJETS PRÉSENTÉS. Teams : `auto` crée la réunion via Microsoft Graph (si configuré), `lien` enregistre un lien Teams collé à la main, `aucun`. `inviter: true` envoie les invitations Teams aux membres et secrétaires ; sinon seul le lien est communiqué par IvryDélib. Les membres et secrétaires sont prévenus par mail." },
  async (req, res) => res.status(201).json(await seances.createReunion(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/actes/:id/commissions', { summary: "Commissions d'un acte et leurs avis (vide = hors commission)", tags: T, org: true, params: PA },
    async (req, res) => res.json(await commissions.forActe(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/actes/:id/commissions', { summary: 'Rattache une commission (pour avis) à l\'acte', tags: T, org: true, params: PA, body: AddC, responses: { 201: 'Créé' },
    description: 'La mise à disposition part à la validation DGS (ou SCC, paramètre `commissions.declencheur`) ; si l\'acte est déjà validé, elle part immédiatement.' },
  async (req, res) => res.status(201).json(await commissions.addToActe(req.ctx, req.org.id, req.valid.params.id, req.valid.body.commissionId)));
  r.delete('/actes/:id/commissions/:commissionId', { summary: 'Retire une commission (motif obligatoire après mise à disposition)', tags: T, org: true, params: PAC, query: Del },
    async (req, res) => res.json(await commissions.removeFromActe(req.ctx, req.org.id, req.valid.params.id, req.valid.params.commissionId, req.valid.query.motif)));
  r.put('/actes/:id/commissions/:commissionId/avis', { summary: 'Saisit l\'avis de la commission', tags: T, org: true, params: PAC, body: Avis,
    description: 'Secrétaire de la commission, SCC ou administrateur. Favorable / Défavorable / Réservé / Sans avis ; visible de tout le circuit.' },
  async (req, res) => res.json(await commissions.setAvis(req.ctx, req.org.id, req.valid.params.id, req.valid.params.commissionId, req.valid.body)));

  return [r];
};
