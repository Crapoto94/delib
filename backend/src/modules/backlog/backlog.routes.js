const { z } = require('zod');
const multer = require('multer');
const { E } = require('../../shared/errors');
const { nomsUtf8 } = require('../../http/middleware/noms-fichiers');

const Id = z.coerce.number().int().positive();
const Org = z.object({ orgId: Id });
const OrgId = Org.extend({ id: Id });
const T = ['backlog'];
const Statut = z.enum(['demandee', 'acceptee', 'refusee', 'realisee']);
const Demande = z.object({
  type: z.enum(['bug', 'evolution']).describe('bug = anomalie à corriger ; evolution = amélioration demandée'),
  titre: z.string().min(3).max(200).describe('Titre court (3 à 200 caractères)'),
  description: z.string().min(3).max(5000).describe('Description détaillée (3 à 5000 caractères)'),
  versionApp: z.string().max(20).optional().describe('Version de l’application concernée'),
});
const Etat = z.object({
  statut: Statut,
  motif: z.string().max(2000).optional().describe('Obligatoire pour un refus ; facultatif sinon'),
});
const ADMIN = ['org_admin', 'scc'];

const OrgIdPiece = OrgId.extend({ pieceId: Id });

module.exports = ({ makeRouter, backlog }) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1048576, files: 5 } });
  const r = makeRouter('/api/v1/organismes/:orgId/backlog');
  r.post('/', { summary: 'Déclare un bug ou demande une évolution (tout utilisateur)', tags: T, org: true, params: Org, responses: { 201: 'Créée' },
    description: 'JSON, ou multipart/form-data avec les champs type, titre, description, versionApp et jusqu’à 5 pièces jointes (champ « fichiers », 10 Mo chacune : image, PDF, texte, Word, Excel, PowerPoint, OpenDocument).' },
  upload.array('fichiers', 5), nomsUtf8, async (req, res, next) => {
    const b = Demande.safeParse(req.body || {});
    if (!b.success) return next(E.badRequest('Requête invalide', b.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
    res.status(201).json(await backlog.creer(req.ctx, req.org.id, b.data, req.files || []));
  });
  r.get('/:id/pieces/:pieceId/file', { summary: 'Télécharge une pièce jointe (demandeur, SCC ou administrateur)', tags: T, org: true, params: OrgIdPiece }, async (req, res) => {
    const f = await backlog.piece(req.ctx, req.orgRoles || [], req.org.id, req.valid.params.id, req.valid.params.pieceId);
    const inline = f.mime.startsWith('image/') || f.mime === 'application/pdf';
    res.set({ 'Content-Type': f.mime, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`, ETag: `"${f.sha256}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(f.buffer);
  });
  r.get('/mes-demandes', { summary: 'Mes demandes et leur état', tags: T, org: true, params: Org },
    async (req, res) => res.json(await backlog.lister(req.org.id, { username: req.ctx.username })));
  r.get('/', { summary: 'Toutes les demandes — SCC et administrateur', tags: T, org: true, roles: ADMIN, params: Org, query: z.object({ statut: Statut.optional() }) },
    async (req, res) => res.json(await backlog.lister(req.org.id, { statut: req.valid.query.statut })));
  r.put('/:id/etat', { summary: 'Accepte, refuse (motif obligatoire) ou déclare réalisée une demande ; le demandeur est prévenu par courriel', tags: T, org: true, roles: ADMIN, params: OrgId, body: Etat },
    async (req, res) => res.json(await backlog.changerEtat(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  return [r];
};
