const { z } = require('zod');
const multer = require('multer');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id, id: Id });
const PA = P.extend({ annexeId: Id });
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
// champs texte d'un formulaire multipart : tout arrive en chaîne
const Meta = z.object({
  titre: z.string().trim().min(1).max(300), typeId: Id.optional(), ordre: z.coerce.number().int().min(1).optional(),
  communicable: bool.optional(), publiable: bool.optional(), transmissible: bool.optional(),
});
const Patch = z.object({ titre: z.string().trim().min(1).max(300).optional(), typeId: Id.nullable().optional(), communicable: z.boolean().optional(), publiable: z.boolean().optional(), transmissible: z.boolean().optional() });
const Order = z.object({ ids: z.array(Id).min(1).max(500) });
const VersionQ = z.object({ version: z.coerce.number().int().min(1).optional() });

module.exports = ({ makeRouter, annexes, config }) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.storage.maxUploadBytes, files: 1 } });
  const r = makeRouter('/api/v1/organismes/:orgId/actes/:id/annexes');
  const multipart = (spec) => ({ ...spec, description: `${spec.description || ''} Requête multipart/form-data : champ « file » (PDF) + métadonnées.`.trim() });

  r.get('/', { summary: "Annexes d'un acte", tags: ['annexes'], org: true, params: P },
    async (req, res) => res.json({ items: await annexes.list(req.ctx, req.org.id, req.valid.params.id) }));

  r.post('/', multipart({
    summary: 'Ajoute une annexe (PDF)', tags: ['annexes'], org: true, params: P, responses: { 201: 'Créé' },
    description: 'PDF uniquement : signature %PDF vérifiée, non chiffré, sans JavaScript ni pièce jointe intégrée (ANN-01).',
  }), upload.single('file'), async (req, res, next) => {
    const meta = Meta.safeParse(req.body || {});
    if (!meta.success) return next(require('../../shared/errors').E.badRequest('Requête invalide', meta.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
    res.status(201).json(await annexes.add(req.ctx, req.org.id, req.valid.params.id, meta.data, req.file));
  });

  r.put('/order', { summary: 'Réordonne les annexes', tags: ['annexes'], org: true, params: P, body: Order },
    async (req, res) => res.json({ items: await annexes.reorder(req.ctx, req.org.id, req.valid.params.id, req.valid.body.ids) }));

  r.put('/:annexeId', { summary: "Modifie les métadonnées d'une annexe", tags: ['annexes'], org: true, params: PA, body: Patch },
    async (req, res) => res.json(await annexes.update(req.ctx, req.org.id, req.valid.params.id, req.valid.params.annexeId, req.valid.body)));

  r.put('/:annexeId/file', multipart({ summary: 'Remplace le fichier (nouvelle version)', tags: ['annexes'], org: true, params: PA }),
    upload.single('file'), async (req, res) => res.json(await annexes.replaceFile(req.ctx, req.org.id, req.valid.params.id, req.valid.params.annexeId, req.file)));

  r.get('/:annexeId/versions', { summary: "Versions d'une annexe", tags: ['annexes'], org: true, params: PA },
    async (req, res) => res.json({ items: await annexes.versions(req.ctx, req.org.id, req.valid.params.id, req.valid.params.annexeId) }));

  r.get('/:annexeId/file', { summary: "Télécharge le PDF d'une annexe", tags: ['annexes'], org: true, params: PA, query: VersionQ },
    async (req, res) => {
      const f = await annexes.content(req.ctx, req.org.id, req.valid.params.id, req.valid.params.annexeId, req.valid.query.version);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${encodeURIComponent(f.name)}"`, ETag: `"${f.sha256}"`, 'Cache-Control': 'private, no-store' }).send(f.buffer);
    });

  r.delete('/:annexeId', { summary: 'Supprime une annexe', tags: ['annexes'], org: true, params: PA, responses: { 204: 'Supprimé' } },
    async (req, res) => { await annexes.remove(req.ctx, req.org.id, req.valid.params.id, req.valid.params.annexeId); res.status(204).end(); });

  return [r];
};
