const { z } = require('zod');

const Org = z.object({ orgId: z.coerce.number().int().positive() });
const IdP = Org.extend({ id: z.coerce.number().int().positive() });
const DelibP = IdP.extend({ delibId: z.coerce.number().int().positive() });
const Id = z.coerce.number().int().positive();
const Fields = {
  natureId: Id.nullable().optional(), matiereId: Id.nullable().optional(), rubriqueId: Id.nullable().optional(),
  incidenceFinanciere: z.boolean().nullable().optional(), montant: z.number().min(0).max(1e12).nullable().optional(),
  rapporteurId: Id.nullable().optional(), rapporteurComplId: Id.nullable().optional(), seanceViseeId: Id.nullable().optional(),
  urgence: z.boolean().optional(), dateLimite: z.iso.date().nullable().optional(),
  confidentialite: z.enum(['normale', 'confidentiel', 'huis_clos']).optional(), custom: z.record(z.string(), z.unknown()).optional(),
};
const Create = z.object({
  typeId: Id, titre: z.string().trim().min(3).max(500),
  directionCode: z.string().trim().max(40).optional().describe('Direction porteuse (défaut : ma direction)'),
  serviceCode: z.string().trim().max(40).optional(), commentaire: z.string().max(5000).optional(), ...Fields,
});
const Update = z.object({
  titre: z.string().trim().min(3).max(500).optional(), typeId: Id.optional(), serviceCode: z.string().trim().max(40).optional(),
  commentaireInitial: z.string().max(5000).nullable().optional(), coRedacteurs: z.array(z.string().trim().min(1).max(128)).max(20).optional(), ...Fields,
});
const ListQ = z.object({
  statut: z.string().max(40).optional(), typeId: Id.optional(), directionCode: z.string().max(40).optional(), seanceId: Id.optional(),
  scope: z.enum(['mine', 'following', 'all']).default('all'), q: z.string().trim().max(200).optional(),
  includeAbandoned: z.enum(['true', 'false']).default('false'), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
const Delib = z.object({ titre: z.string().trim().min(3).max(500) });
const DelibUpd = z.object({ titre: z.string().trim().min(3).max(500).optional(), ordre: z.number().int().min(1).optional() });
const Abandon = z.object({ motif: z.string().trim().min(3).max(1000) });
const Assiste = z.object({
  actif: z.boolean().optional(), bienvenue: z.boolean().optional(),
  passees: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
});

module.exports = ({ makeRouter, actes }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/actes');

  r.get('/', {
    summary: 'Liste des actes visibles par moi', tags: ['actes'], org: true, params: Org, query: ListQ,
    description: 'Visibilité (VIS-01/02) : mes actes, ceux du circuit dont je fais partie, les brouillons de mon service et de ma hiérarchie ; administrateur, SCC et lecteur voient tout. Pagination limit/offset.',
  }, async (req, res) => res.json(await actes.list(req.ctx, req.org.id, { ...req.valid.query, includeAbandoned: req.valid.query.includeAbandoned === 'true' })));

  r.post('/', {
    summary: 'Crée un acte (brouillon)', tags: ['actes'], org: true, params: Org, body: Create, responses: { 201: 'Créé' },
    description: "Le rédacteur et sa direction sont déduits de l'identité RH ; une direction étrangère exige une autorisation de rédaction (DRO-02). Nature par défaut selon le type. Crée les délibérations minimales du type. Seuls type et titre sont requis : le reste est vérifié par le contrôle de complétude avant l'envoi au circuit.",
  }, async (req, res) => res.status(201).json(await actes.create(req.ctx, req.org.id, req.valid.body)));

  r.get('/:id', { summary: "Fiche d'un acte, avec droits et complétude", tags: ['actes'], org: true, params: IdP },
    async (req, res) => res.json(await actes.get(req.ctx, req.org.id, req.valid.params.id)));

  r.put('/:id', {
    summary: "Modifie la fiche d'un acte", tags: ['actes'], org: true, params: IdP, body: Update,
    description: "Le rédacteur tant que l'acte est brouillon ou à modifier ; en circuit, le détenteur d'une étape éditable. Tout valideur du circuit peut changer la séance visée (CRE-09). Un changement d'incidence financière ou de montant recalcule le circuit (CIR-14).",
  }, async (req, res) => res.json(await actes.update(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.put('/:id/assiste', {
    summary: 'Active/désactive le mode « dossier assisté » et enregistre sa progression', tags: ['actes'], org: true, params: IdP, body: Assiste,
    description: "Le guide pas à pas de rédaction : `actif` active ou coupe l'aide, `passees` mémorise les étapes conseillées passées, `bienvenue` l'accueil déjà vu. Réservé à qui peut modifier l'acte.",
  }, async (req, res) => res.json(await actes.setAssiste(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/:id/abandon', { summary: 'Abandonne un acte (motif obligatoire, jamais de suppression)', tags: ['actes'], org: true, params: IdP, body: Abandon },
    async (req, res) => res.json(await actes.abandon(req.ctx, req.org.id, req.valid.params.id, req.valid.body.motif)));
  r.post('/:id/reactivate', { summary: 'Réactive un acte abandonné', tags: ['actes'], org: true, params: IdP },
    async (req, res) => res.json(await actes.reactivate(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/:id/rappeler', { summary: "Rappelle un acte en circuit (motif obligatoire) : casse le circuit, nouvel état « rappele »", tags: ['actes'], org: true, params: IdP, body: Abandon },
    async (req, res) => res.json(await actes.rappeler(req.ctx, req.org.id, req.valid.params.id, req.valid.body.motif)));
  r.delete('/:id', { summary: 'Supprime un acte HORS circuit (un acte en circuit doit être rappelé)', tags: ['actes'], org: true, params: IdP },
    async (req, res) => res.json(await actes.supprimer(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/:id/duplicate', { summary: 'Duplique un acte (nouveau brouillon)', tags: ['actes'], org: true, params: IdP, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await actes.duplicate(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/:id/deliberations', { summary: "Délibérations d'un dossier", tags: ['actes'], org: true, params: IdP },
    async (req, res) => { await actes.load(req.ctx, req.org.id, req.valid.params.id); res.json({ items: await actes.deliberations(req.valid.params.id) }); });
  r.post('/:id/deliberations', { summary: 'Ajoute une délibération au dossier', tags: ['actes'], org: true, params: IdP, body: Delib, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await actes.addDeliberation(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.put('/:id/deliberations/:delibId', { summary: 'Modifie une délibération', tags: ['actes'], org: true, params: DelibP, body: DelibUpd },
    async (req, res) => res.json(await actes.updateDeliberation(req.ctx, req.org.id, req.valid.params.id, req.valid.params.delibId, req.valid.body)));
  r.delete('/:id/deliberations/:delibId', { summary: 'Supprime une délibération (le dossier en garde au moins une)', tags: ['actes'], org: true, params: DelibP, responses: { 204: 'Supprimé' } },
    async (req, res) => { await actes.deleteDeliberation(req.ctx, req.org.id, req.valid.params.id, req.valid.params.delibId); res.status(204).end(); });

  return [r];
};
