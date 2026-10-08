const { z } = require('zod');
const multer = require('multer');
const { nomsUtf8 } = require('../../http/middleware/noms-fichiers');
const { E } = require('../../shared/errors');

const Id = z.coerce.number().int().positive();
const Org = z.object({ orgId: Id });
const PA = Org.extend({ id: Id });
const T = ['arrêtés signés'];
const date = z.iso.date();
const Controle = z.object({ etat: z.enum(['a_transmettre', 'deja_envoye']), dateEnvoi: date.optional(), dateAr: date.optional(), numeroAr: z.string().trim().max(80).optional() });
const json = (schema) => z.preprocess((v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } }, schema);
// champs texte d'un formulaire multipart : tout arrive en chaîne
const Donnees = z.object({
  titre: z.string().trim().min(3).max(500), dateSignature: date, signataire: z.string().trim().max(120).optional(), numeroArrete: z.string().trim().max(60).optional(),
  directionCode: z.string().trim().max(40).optional(), serviceLabel: z.string().trim().max(120).optional(), confidentialite: z.enum(['normale', 'confidentiel']).default('normale'),
  natureId: Id.optional(), matiereId: Id.optional(), rubriqueId: Id.optional(),
  controleLegalite: json(Controle), annexesTitres: json(z.array(z.string().max(300)).max(20)).optional(),
});

module.exports = ({ makeRouter, arretesSignes, config }) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.storage.maxUploadBytes, files: 21 } });
  const r = makeRouter('/api/v1/organismes/:orgId/actes');

  r.post('/arrete-signe', {
    summary: 'Crée un arrêté DÉJÀ SIGNÉ : éléments nécessaires, arrêté (PDF) et annexes éventuelles ; directement en bibliothèque', tags: T, org: true, params: Org, responses: { 201: 'Créé' },
    description: 'Requête multipart/form-data : champ « arrete » (PDF signé), champs « annexes » (0 à 20 fichiers) avec `annexesTitres` (JSON, un titre par annexe), et les champs `titre`, `dateSignature`, `signataire`, `numeroArrete`, `controleLegalite` (JSON : `{ "etat": "a_transmettre" }` ou `{ "etat": "deja_envoye", "dateEnvoi": "AAAA-MM-JJ", "dateAr": "…", "numeroAr": "…" }`). Pas d’exposé des motifs, pas de circuit : l’acte est « signé ».',
  }, upload.fields([{ name: 'arrete', maxCount: 1 }, { name: 'annexes', maxCount: 20 }]), nomsUtf8, async (req, res, next) => {
    const d = Donnees.safeParse(req.body || {});
    if (!d.success) return next(E.badRequest('Requête invalide', d.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
    res.status(201).json(await arretesSignes.creer(req.ctx, req.org.id, d.data, req.files?.arrete?.[0], req.files?.annexes || []));
  });

  r.put('/:id/controle-legalite', {
    summary: 'Contrôle de légalité d’un acte signé : à transmettre, ou déjà envoyé (date d’envoi, accusé de réception)', tags: T, org: true, params: PA, body: Controle,
    description: 'Un acte « à transmettre » est proposé dans la télétransmission ; un acte « déjà envoyé » n’y figure plus.',
  }, async (req, res) => res.json(await arretesSignes.definirControle(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  return [r];
};
