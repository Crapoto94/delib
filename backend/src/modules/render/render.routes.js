const { z } = require('zod');
const multer = require('multer');
const { E } = require('../../shared/errors');
const { DOC_TYPES } = require('./render.service');
const { available } = require('./fonts');

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
  police: z.object({ famille: z.enum(['times', 'helvetica', 'interstate']), taille: num(7, 18), interligne: num(1, 2.5), justifie: z.boolean() }).partial().optional(),
  pied: z.object({ texte: z.string().max(200), pagination: z.boolean() }).partial().optional(),
  entete: z.array(Block).max(12).optional(),
  filigrane: z.string().max(60).optional(),
  logo: z.object({ afficher: z.union([z.boolean(), z.literal('auto')]), largeur: num(10, 90), align: z.enum(['left', 'center', 'right']) }).partial().optional(),
  a4Strict: z.boolean().optional(),
  sections: z.object({ visas: z.string().max(200).nullable(), dispositif: z.string().max(200).nullable() }).partial().optional(),
});
const Preview = z.object({
  cible: z.enum(['expose', 'deliberation', 'dossier']).default('expose'),
  deliberationId: Id.optional(),
  mode: z.enum(['propre', 'suivi']).default('propre'),
  brouillon: z.boolean().default(false),
});
const DocxQ = z.object({ docType: Doc.default('deliberation'), deliberationId: Id.optional() });

/** Variables utilisables dans un modèle Word : métadonnées de l'acte + zones de la délibération. */
const DOCX_VARS = [
  { nom: '{titre}', description: "Titre de l'acte (dossier)" },
  { nom: '{numero_suivi}', description: 'Numéro de suivi interne' },
  { nom: '{numero}', description: 'Numéro de la délibération (figé à l’arrêt de l’ordre du jour)' },
  { nom: '{deliberation}', description: 'Titre de la délibération' },
  { nom: '{date_seance}', description: 'Date de la séance (en majuscules)' },
  { nom: '{date_du_jour}', description: "Date du jour" },
  { nom: '{organisme} {adresse} {ville} {code_postal} {telephone} {email} {site_web} {signataire}', description: 'Identité de la collectivité' },
  { nom: '{direction} {service} {redacteur}', description: 'Direction porteuse, service, rédacteur' },
  { nom: '{matiere} {rubrique} {nature}', description: 'Classement (matière, rubrique, nature)' },
  { nom: '{expose}', description: 'Exposé des motifs (texte)' },
  { nom: '{visas}', description: 'Visas et considérants (texte) — alias {considere}' },
  { nom: '{dispositif}', description: 'Délibéré (texte) — alias {delibere}' },
  { nom: '{statut}', description: 'Statut du dossier' },
  { nom: '{membres_conseil}', description: 'Nombre de membres composant le Conseil (tenue de séance)' },
  { nom: '{conseillers_exercice}', description: 'Nombre de conseillers en exercice' },
  { nom: '{presents}', description: 'Nombre de présents' },
  { nom: '{absents_representes}', description: 'Nombre d’absents représentés (pouvoirs)' },
  { nom: '{absents_excuses}', description: 'Nombre d’absents excusés (hors représentés)' },
  { nom: '{absents_non_excuses}', description: 'Nombre d’absents non excusés (hors représentés)' },
  { nom: '{liste_presents} {liste_absents_representes} {liste_absents_excuses} {liste_absents_non_excuses}', description: 'Listes de noms correspondantes' },
  { nom: '{numero_transmis}', description: 'Numéro de la transmission au contrôle de légalité' },
  { nom: '{transmis_prefecture}', description: 'Date de transmission en préfecture (jj/mm/aaaa)' },
  { nom: '{recu_prefecture}', description: 'Date de réception en préfecture (accusé de réception)' },
  { nom: '{publie_affichage}', description: "Date de publication par voie d'affichage" },
  { nom: '{mention_transmission}', description: 'Bloc « TRANSMIS EN PRÉFECTURE LE… / REÇU… / PUBLIÉ… »' },
  { nom: '{IF visas|texte conditionnel}', description: 'Bloc conservé seulement si la variable a une valeur' },
];

const pdf = (res, out, name) => res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"`, 'X-Page-Count': String(out.pageCount), 'Cache-Control': 'private, no-store' }).send(out.buffer);

module.exports = ({ makeRouter, render, config }) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.storage.maxUploadBytes, files: 1 } });
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/gabarits', { summary: 'Gabarits de mise en page (avec valeurs par défaut)', tags: ['mise en page'], org: true, params: z.object({ orgId: Id }) },
    async (req, res) => res.json({ items: await render.listTemplates(req.org.id) }));

  r.get('/gabarits-polices', { summary: 'Polices disponibles pour les PDF', tags: ['mise en page'], org: true, params: z.object({ orgId: Id }),
    description: 'Interstate (police de la Ville) n’est proposée que si ses fichiers sont présents sur le serveur (FONTS_DIR).' },
  async (req, res) => res.json({ items: available(config.fontsDir) }));

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

  r.post('/gabarits/:docType/docx', {
    summary: 'Dépose le modèle Word (.docx) à variables du gabarit', tags: ['mise en page'], org: true, roles: ['org_admin'], params: P,
    description: 'multipart/form-data, champ « file » : fichier .docx. À la génération, ses variables {…} sont remplacées par les valeurs de l’acte et de ses zones (exposé, visas, dispositif).',
  }, upload.single('file'), async (req, res) => res.json(await render.setDocxTemplate(req.ctx, req.org.id, req.valid.params.docType, req.file)));

  r.delete('/gabarits/:docType/docx', { summary: 'Retire le modèle Word du gabarit', tags: ['mise en page'], org: true, roles: ['org_admin'], params: P },
    async (req, res) => res.json(await render.removeDocxTemplate(req.ctx, req.org.id, req.valid.params.docType)));

  r.get('/gabarits/:docType/docx', { summary: 'Télécharge le modèle Word du gabarit', tags: ['mise en page'], org: true, roles: ['org_admin'], params: P, responses: { 200: 'Fichier .docx' } },
    async (req, res) => {
      const t = await render.getTemplate(req.org.id, req.valid.params.docType);
      if (!t.docxFileId) throw E.notFound("Aucun modèle Word pour ce gabarit");
      const d = await render.docxBytes(t.docxFileId);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${d.name || 'modele.docx'}"`, 'Cache-Control': 'private, no-store' }).send(d.bytes);
    });

  r.get('/gabarits/:docType/docx/variables', { summary: 'Variables utilisables dans le modèle Word', tags: ['mise en page'], org: true, params: P },
    async (req, res) => res.json({ items: DOCX_VARS }));

  r.get('/gabarits/:docType/docx/apercu', { summary: 'Aperçu du modèle Word avec des données de test', tags: ['mise en page'], org: true, roles: ['org_admin'], params: P, responses: { 200: 'Fichier .docx' } },
    async (req, res) => {
      const out = await render.docxSample(req.ctx, req.org.id, req.valid.params.docType);
      res.set({ 'Content-Type': out.mime, 'Content-Disposition': `attachment; filename="${out.name}"`, 'Cache-Control': 'private, no-store' }).send(out.buffer);
    });

  r.get('/gabarits/:docType/docx/apercu-pdf', { summary: 'Aperçu du modèle Word (données de test) en PDF', tags: ['mise en page'], org: true, roles: ['org_admin'], params: P, responses: { 200: 'application/pdf' } },
    async (req, res) => pdf(res, await render.docxSamplePdf(req.ctx, req.org.id, req.valid.params.docType), `apercu-${req.valid.params.docType}`));

  r.get('/gabarits/:docType/etalonnage', { summary: "PDF d'étalonnage du gabarit (texte d'exemple sur le fond)", tags: ['mise en page'], org: true, roles: ['org_admin'], params: P },
    async (req, res) => pdf(res, await render.sample(req.ctx, req.org.id, req.valid.params.docType), `etalonnage-${req.valid.params.docType}`));

  r.get('/actes/:id/docx', {
    summary: "Document Word d'un acte, fusionné avec le modèle .docx du gabarit", tags: ['mise en page'], org: true, params: PA, query: DocxQ, responses: { 200: 'Fichier .docx' },
    description: 'Fusionne le modèle Word du gabarit (docType) avec les valeurs de l’acte et de ses zones. `deliberationId` choisit la délibération (s’il y en a plusieurs).',
  }, async (req, res) => {
    const out = await render.renderDocx(req.ctx, req.org.id, req.valid.params.id, req.valid.query);
    res.set({ 'Content-Type': out.mime, 'Content-Disposition': `attachment; filename="${out.name}"`, 'Cache-Control': 'private, no-store' }).send(out.buffer);
  });

  r.get('/actes/:id/docx-pdf', {
    summary: "Document Word fusionné puis converti en PDF", tags: ['mise en page'], org: true, params: PA, query: DocxQ, responses: { 200: 'application/pdf' },
    description: 'Fusionne le modèle Word du gabarit avec l’acte puis convertit en PDF (LibreOffice). En-tête `X-Page-Count`.',
  }, async (req, res) => pdf(res, await render.renderDocxPdf(req.ctx, req.org.id, req.valid.params.id, req.valid.query), `acte-${req.valid.params.id}-${req.valid.query.docType}`));

  r.post('/actes/:id/apercu', {
    summary: "Aperçu PDF d'un acte : exposé, délibération ou dossier complet", tags: ['mise en page'], org: true, params: PA, body: Preview,
    description: "Rendu à la demande au gabarit de l'organisme (PDF de fond + mise en page). `mode=suivi` colore les modifications (ajout souligné, suppression barrée, couleur de l'auteur) ; `brouillon=true` utilise mon brouillon non enregistré. Filigrane « PROJET » tant que l'acte n'est pas adopté. En-tête `X-Page-Count`.",
  }, async (req, res) => {
    const b = req.valid.body;
    pdf(res, await render.renderActe(req.ctx, req.org.id, req.valid.params.id, b), `acte-${req.valid.params.id}-${b.cible}`);
  });

  return [r];
};
