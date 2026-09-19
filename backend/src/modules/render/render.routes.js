const { z } = require('zod');
const multer = require('multer');
const { DOC_TYPES } = require('./render.service');

const Id = z.coerce.number().int().positive();
const Doc = z.enum(DOC_TYPES);
const P = z.object({ orgId: Id, docType: Doc });
const PW = P.extend({ page: z.enum(['first', 'next']) });
const PA = z.object({ orgId: Id, id: Id });
const num = (min, max) => z.number().min(min).max(max);
const Block = z.object({
  texte: z.string().max(300), align: z.enum(['left', 'center', 'right']).optional(), taille: num(6, 40).optional(),
  gras: z.boolean().optional(), encadre: z.boolean().optional(), apres: num(0, 60).optional(),
});
const Config = z.object({
  marges: z.object({ haut: num(0, 80), bas: num(0, 80), gauche: num(0, 80), droite: num(0, 80) }).partial().optional(),
  police: z.object({ taille: num(7, 18), interligne: num(1, 2.5), justifie: z.boolean() }).partial().optional(),
  pied: z.object({ texte: z.string().max(200), pagination: z.boolean() }).partial().optional(),
  entete: z.array(Block).max(12).optional(),
  filigrane: z.string().max(60).optional(),
  a4Strict: z.boolean().optional(),
  sections: z.object({ visas: z.string().max(200).nullable(), dispositif: z.string().max(200).nullable() }).partial().optional(),
});
const Preview = z.object({
  cible: z.enum(['expose', 'deliberation', 'dossier']).default('expose'),
  deliberationId: Id.optional(),
  mode: z.enum(['propre', 'suivi']).default('propre'),
  brouillon: z.boolean().default(false),
});

const pdf = (res, out, name) => res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"`, 'X-Page-Count': String(out.pageCount), 'Cache-Control': 'private, no-store' }).send(out.buffer);

module.exports = ({ makeRouter, render, config }) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.storage.maxUploadBytes, files: 1 } });
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/gabarits', { summary: 'Gabarits de mise en page (avec valeurs par défaut)', tags: ['mise en page'], org: true, params: z.object({ orgId: Id }) },
    async (req, res) => res.json({ items: await render.listTemplates(req.org.id) }));

  r.put('/gabarits/:docType', {
    summary: 'Définit un gabarit (marges, police, en-tête à variables, pied de page, filigrane)', tags: ['mise en page'], org: true, roles: ['org_admin'], params: P, body: Config,
    description: "Variables d'en-tête : {organisme} {titre} {rubrique} {matiere} {nature} {direction} {service} {redacteur} {numero_suivi} {numero} {date_seance} {date_du_jour} {statut}. Chaque modification crée une version.",
  }, async (req, res) => res.json(await render.upsertTemplate(req.ctx, req.org.id, req.valid.params.docType, req.valid.body)));

  r.post('/gabarits/:docType/fond/:page', {
    summary: 'Dépose le PDF de fond (première page ou pages suivantes)', tags: ['mise en page'], org: true, roles: ['org_admin'], params: PW,
    description: 'multipart/form-data, champ « file » : PDF A4 valide. `first` = première page, `next` = pages suivantes (à défaut, le fond de la première page sert partout).',
  }, upload.single('file'), async (req, res) => res.json(await render.setBackground(req.ctx, req.org.id, req.valid.params.docType, req.valid.params.page, req.file)));

  r.delete('/gabarits/:docType/fond/:page', { summary: 'Retire un PDF de fond', tags: ['mise en page'], org: true, roles: ['org_admin'], params: PW },
    async (req, res) => res.json(await render.removeBackground(req.ctx, req.org.id, req.valid.params.docType, req.valid.params.page)));

  r.get('/gabarits/:docType/etalonnage', { summary: "PDF d'étalonnage du gabarit (texte d'exemple sur le fond)", tags: ['mise en page'], org: true, roles: ['org_admin'], params: P },
    async (req, res) => pdf(res, await render.sample(req.ctx, req.org.id, req.valid.params.docType), `etalonnage-${req.valid.params.docType}`));

  r.post('/actes/:id/apercu', {
    summary: "Aperçu PDF d'un acte : exposé, délibération ou dossier complet", tags: ['mise en page'], org: true, params: PA, body: Preview,
    description: "Rendu à la demande au gabarit de l'organisme (PDF de fond + mise en page). `mode=suivi` colore les modifications (ajout souligné, suppression barrée, couleur de l'auteur) ; `brouillon=true` utilise mon brouillon non enregistré. Filigrane « PROJET » tant que l'acte n'est pas adopté. En-tête `X-Page-Count`.",
  }, async (req, res) => {
    const b = req.valid.body;
    pdf(res, await render.renderActe(req.ctx, req.org.id, req.valid.params.id, b), `acte-${req.valid.params.id}-${b.cible}`);
  });

  return [r];
};
