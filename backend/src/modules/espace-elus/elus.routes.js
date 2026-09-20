const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const T = ['espace élus'];
const Email = z.string().trim().toLowerCase().email().max(200);
const Appareil = z.string().trim().min(8).max(200).optional().describe('Identifiant aléatoire de l’appareil (généré une fois par l’application), sert à mémoriser un appareil de confiance');

const Invitation = z.object({ motDePasse: z.string().min(12).max(200) });
const Oubli = z.object({ email: Email, organismeId: Id.optional() });
const Connexion = z.object({ email: Email, motDePasse: z.string().min(1).max(200), appareil: Appareil, organismeId: Id.optional() });
const OubliSms = z.object({ email: Email, organismeId: Id.optional() });
const OubliSmsCode = z.object({ challenge: z.string().uuid(), code: z.string().regex(/^\d{6}$/), appareil: Appareil });
const Code = z.object({ challenge: z.string().uuid(), code: z.string().regex(/^\d{6}$/), faireConfiance: z.boolean().optional(), appareil: Appareil });
const SeanceP = z.object({ id: Id });
const KeyP = z.object({ key: z.string().min(3).max(80).regex(/^[a-z]:\d+(:(\d+|expose|projet))?$/) });
const ItemP = z.object({ itemId: Id });
const NoteP = z.object({ id: Id });
const DocQ = z.object({ lecture: z.enum(['0', '1']).default('0').describe('1 : enregistre la consultation (par défaut non : le téléchargement en arrière-plan n’est pas une lecture)') });
const Lectures = z.object({ items: z.array(z.object({ key: z.string().min(3).max(80), version: z.string().min(1).max(80), at: z.iso.datetime().optional() })).min(1).max(500) });
const Etat = z.object({ lu: z.boolean().optional(), favori: z.boolean().optional() }).refine((d) => d.lu !== undefined || d.favori !== undefined, { message: 'Rien à modifier' });
const Note = z.object({ id: Id.optional(), itemId: Id.optional(), texte: z.string().trim().min(1).max(10000), partage: z.enum(['prive', 'groupe', 'elus']).default('prive'), avec: z.array(Id).max(60).default([]) });
const DirectQ = z.object({ since: z.coerce.number().int().min(0).default(0), wait: z.coerce.number().int().min(0).max(30).default(0) });

const Recherche = z.object({ q: z.string().trim().min(2).max(200), limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).default(0) });

const Rect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) });
const Trait = z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(3000);
const Couleur = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Annotation = z.object({
  docKey: z.string().min(3).max(80).regex(/^[a-z]:\d+(:(\d+|expose|projet))?$/), docVersion: z.string().min(1).max(80), page: z.number().int().min(1).max(5000),
  kind: z.enum(['surlignage', 'note', 'dessin', 'signet']), rects: z.array(Rect).max(200).optional(), trace: z.array(Trait).max(200).optional(),
  couleur: Couleur.optional(), citation: z.string().max(2000).optional(), contenu: z.string().max(10000).optional(),
});
const AnnotationUpd = z.object({ contenu: z.string().max(10000).optional(), couleur: Couleur.optional() });
const Ancrage = z.object({ docVersion: z.string().min(1).max(80).optional(), page: z.number().int().min(1).max(5000).optional(), rects: z.array(Rect).max(200).optional(), trace: z.array(Trait).max(200).optional(), orpheline: z.boolean().optional() })
  .refine((d) => d.orpheline || (d.docVersion && d.page), { message: 'Indiquez la nouvelle version et la page, ou « orpheline »' });
const PartageAnnot = z.object({ mode: z.enum(['groupe', 'elus', 'revoquer']), eluIds: z.array(Id).max(100).optional() });
const PartageLot = PartageAnnot.extend({ portee: z.enum(['document', 'seance']), docKey: z.string().min(3).max(80).optional() });
const AnnotP = z.object({ id: Id });
const AnnotQ = z.object({ docKey: z.string().min(3).max(80).optional() });
const Reponse = z.object({ contenu: z.string().trim().min(1).max(5000) });
const ExportQ = z.object({ partagees: z.enum(['0', '1']).default('0') });

module.exports = ({ makeRouter, limiter, eluAuth, espace, recherche, annotations }) => {
  // ------------------------------------------------------------------------------------------------ authentification (publique)
  const a = makeRouter('/api/v1/elus-auth');
  a.post('/invitation/:token', { summary: 'Accepte l’invitation : choisit son mot de passe (lien reçu par mail, à usage unique)', tags: T, auth: false, limiter, params: z.object({ token: z.string().min(20).max(100) }), body: Invitation },
    async (req, res) => res.json(await eluAuth.accepterInvitation(req.valid.params.token, req.valid.body.motDePasse)));
  a.post('/oubli', { summary: 'Mot de passe oublié : envoie un nouveau lien (réponse toujours identique)', tags: T, auth: false, limiter, body: Oubli },
    async (req, res) => res.status(202).json(await eluAuth.oubli(req.valid.body.email, req.valid.body.organismeId)));
  a.post('/oubli-sms', { summary: 'Mot de passe oublié : envoie un code à 6 chiffres par SMS sur le mobile de l’élu (5 minutes)', tags: T, auth: false, limiter, body: OubliSms,
    description: 'La réponse est toujours la même (identifiant de défi et durée), que le compte existe ou non. Au plus 5 demandes par quart d’heure et par adresse ou par IP. Chaque demande est journalisée pour l’administration.' },
  async (req, res) => res.json(await eluAuth.oubliSms({ ...req.valid.body, ip: req.ip })));
  a.post('/oubli-sms/code', { summary: 'Mot de passe oublié : le code SMS correct (5 minutes, 3 essais) connecte l’élu avec un jeton de 12 heures', tags: T, auth: false, limiter, body: OubliSmsCode,
    description: 'Le jeton dure exactement 12 heures ; aucun appareil de confiance n’est mémorisé. Un e-mail d’alerte est envoyé à l’élu.' },
  async (req, res) => res.json(await eluAuth.oubliSmsCode({ ...req.valid.body, ip: req.ip })));
  a.post('/connexion', { summary: 'Connexion, étape 1 : mot de passe. Renvoie un défi (code par mail) ou, pour un appareil de confiance, la session', tags: T, auth: false, limiter, body: Connexion,
    description: 'Cinq échecs verrouillent le compte 15 minutes. Le code à 6 chiffres est valable 10 minutes.' },
  async (req, res) => res.json(await eluAuth.connexion({ ...req.valid.body, ip: req.ip })));
  a.post('/code', { summary: 'Connexion, étape 2 : code à usage unique reçu par mail (5 essais)', tags: T, auth: false, limiter, body: Code },
    async (req, res) => res.json(await eluAuth.code({ ...req.valid.body, ip: req.ip })));
  a.post('/deconnexion', { summary: 'Déconnexion : la session est révoquée', tags: T, elu: true },
    async (req, res) => res.json(await eluAuth.deconnexion(req.elu.jti)));

  // ------------------------------------------------------------------------------------------------ espace (jeton d'élu)
  const r = makeRouter('/api/v1/elus');
  r.get('/accueil', { summary: 'Accueil : prochaine séance, compte à rebours, documents à télécharger et non lus, séances accessibles', tags: T, elu: true },
    async (req, res) => res.json(await espace.accueil(req.elu)));
  r.get('/seances/:id', { summary: 'Séance : ordre du jour numéroté, documents PDF de chaque point (avec version), avis des commissions, points lus / favoris', tags: T, elu: true, params: SeanceP,
    description: 'Ne contient JAMAIS de note de séance, de décompte de saisie ni de donnée du circuit. 404 tant que la séance n’est pas mise à disposition.' },
  async (req, res) => res.json(await espace.seance(req.elu, req.valid.params.id)));
  r.get('/seances/:id/manifeste', { summary: 'Manifeste de téléchargement en arrière-plan : tous les documents de la séance, dans l’ordre de lecture, avec leur version', tags: T, elu: true, params: SeanceP,
    description: 'Le client compare les versions à son stockage local, ne télécharge que ce qui manque ou a changé, puis ouvre les points instantanément.' },
  async (req, res) => res.json(await espace.manifeste(req.elu, req.valid.params.id)));
  r.get('/documents/:key', { summary: 'Un document PDF avec le filigrane nominatif de l’élu (ETag = version ; 304 si inchangé)', tags: T, elu: true, params: KeyP, query: DocQ, responses: { 200: 'PDF', 304: 'Inchangé' },
    description: 'Clés : `p:<point>:expose`, `p:<point>:projet`, `a:<point>:<annexe>`, `f:<point>:<pièce>`, `v:<séance>` (convocation), `o:<séance>` (ordre du jour), `c:<séance>` (cahier numérique).' },
  async (req, res) => {
    const key = req.valid.params.key; const etag = (v) => `"${v}"`;
    const d = await espace.document(req.elu, key, { journal: req.valid.query.lecture === '1' });
    res.setHeader('ETag', etag(d.version)); res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag(d.version)) return res.status(304).end();
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${d.name}"`); res.setHeader('X-Document-Version', d.version);
    res.send(d.buffer);
  });
  r.post('/seances/:id/lectures', { summary: 'Enregistre des lectures (y compris faites hors ligne) : preuve de consultation et « modifié depuis ma dernière lecture »', tags: T, elu: true, params: SeanceP, body: Lectures },
    async (req, res) => res.json(await espace.lectures(req.elu, req.valid.params.id, req.valid.body.items)));
  r.put('/points/:itemId/etat', { summary: 'Marque un point comme lu et / ou favori', tags: T, elu: true, params: ItemP, body: Etat },
    async (req, res) => res.json(await espace.marquer(req.elu, req.valid.params.itemId, req.valid.body)));

  r.get('/recherche', { summary: 'Recherche dans les délibérations adoptées de mes séances (titre, objet, dispositif) : ni brouillon, ni annexe, ni note', tags: T, elu: true, query: Recherche },
    async (req, res) => {
      const { items, total, limit, offset, approchee } = await recherche.chercherElu(req.elu, await espace.seanceIds(req.elu), req.valid.query);
      res.json({ items, total, limit, offset, approchee });
    });
  // ------------------------------------------------------------------------------------------------ annotations sur les PDF (ELU-71 à ELU-76)
  r.get('/seances/:id/annotations', { summary: 'Mes annotations et celles qu’on a partagées avec moi (contenu déchiffré pour moi seul)', tags: T, elu: true, params: SeanceP, query: AnnotQ },
    async (req, res) => res.json({ items: await annotations.lister(req.elu, req.valid.params.id, req.valid.query) }));
  r.post('/seances/:id/annotations', { summary: 'Crée une annotation (surlignage, note, dessin, signet) : privée par défaut', tags: T, elu: true, params: SeanceP, body: Annotation, responses: { 201: 'Créée' } },
    async (req, res) => res.status(201).json(await annotations.creer(req.elu, req.valid.params.id, req.valid.body)));
  r.put('/annotations/:id', { summary: 'Modifie le texte ou la couleur de mon annotation', tags: T, elu: true, params: AnnotP, body: AnnotationUpd }, async (req, res) => res.json(await annotations.modifier(req.elu, req.valid.params.id, req.valid.body)));
  r.put('/annotations/:id/ancrage', { summary: 'Ré-ancre mon annotation sur une nouvelle version du document (ou la déclare orpheline)', tags: T, elu: true, params: AnnotP, body: Ancrage },
    async (req, res) => res.json(await annotations.ancrer(req.elu, req.valid.params.id, req.valid.body)));
  r.delete('/annotations/:id', { summary: 'Supprime mon annotation (partages et réponses compris)', tags: T, elu: true, params: AnnotP }, async (req, res) => res.json(await annotations.supprimer(req.elu, req.valid.params.id)));
  r.post('/annotations/:id/partage', { summary: 'Partage mon annotation avec mon groupe (membres à cet instant) ou des élus nommés ; ou révoque le partage', tags: T, elu: true, params: AnnotP, body: PartageAnnot },
    async (req, res) => res.json(await annotations.partager(req.elu, req.valid.params.id, req.valid.body)));
  r.post('/seances/:id/annotations/partage', { summary: 'Partage (ou révoque) toutes mes annotations d’un document ou de la séance', tags: T, elu: true, params: SeanceP, body: PartageLot },
    async (req, res) => res.json(await annotations.partagerLot(req.elu, req.valid.params.id, req.valid.body)));
  r.post('/annotations/:id/reponses', { summary: 'Répond sur une annotation (auteur ou destinataire)', tags: T, elu: true, params: AnnotP, body: Reponse, responses: { 201: 'Créée' } },
    async (req, res) => res.status(201).json(await annotations.repondre(req.elu, req.valid.params.id, req.valid.body.contenu)));
  r.get('/seances/:id/dossier-annote', { summary: 'Mon dossier annoté en PDF : documents de la séance, annotations incorporées, filigrane nominatif', tags: T, elu: true, params: SeanceP, query: ExportQ, responses: { 200: 'PDF' } },
    async (req, res) => {
      const f = await annotations.exporter(req.elu, req.valid.params.id, { avecPartagees: req.valid.query.partagees === '1' });
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`); res.setHeader('Cache-Control', 'no-store'); res.send(f.buffer);
    });
  r.get('/collegues', { summary: 'Élus avec qui partager une note', tags: T, elu: true }, async (req, res) => res.json(await espace.collegues(req.elu)));
  r.get('/seances/:id/notes', { summary: 'Mes notes et celles qu’on a partagées avec moi', tags: T, elu: true, params: SeanceP }, async (req, res) => res.json(await espace.notes(req.elu, req.valid.params.id)));
  r.post('/seances/:id/notes', { summary: 'Crée ou modifie une note (privée par défaut ; partage avec mon groupe ou des élus nommés)', tags: T, elu: true, params: SeanceP, body: Note, responses: { 201: 'Créée' },
    description: 'Les notes appartiennent à l’élu : ni les agents, ni le SCC, ni les administrateurs ne peuvent les lire.' },
  async (req, res) => res.status(201).json(await espace.noter(req.elu, req.valid.params.id, req.valid.body)));
  r.delete('/notes/:id', { summary: 'Supprime une de mes notes', tags: T, elu: true, params: NoteP }, async (req, res) => res.json(await espace.supprimerNote(req.elu, req.valid.params.id)));

  r.get('/seances/:id/direct', { summary: 'Suivi de la séance en direct : point en cours et avancement (attente longue)', tags: T, elu: true, params: SeanceP, query: DirectQ,
    description: 'Vue minimale : point en cours, points clos et — si le paramètre `elus.affiche_resultats` le permet — « adoptée / rejetée ». Aucune note, aucun décompte.' },
  async (req, res) => res.json(await espace.direct(req.elu, req.valid.params.id, req.valid.query.since, req.valid.query.wait * 1000)));

  return [a, r];
};
