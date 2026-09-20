const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const T = ['espace élus'];
const Email = z.string().trim().toLowerCase().email().max(200);
const Appareil = z.string().trim().min(8).max(200).optional().describe('Identifiant aléatoire de l’appareil (généré une fois par l’application), sert à mémoriser un appareil de confiance');

const Invitation = z.object({ motDePasse: z.string().min(12).max(200) });
const Oubli = z.object({ email: Email, organismeId: Id.optional() });
const Connexion = z.object({ email: Email, motDePasse: z.string().min(1).max(200), appareil: Appareil, organismeId: Id.optional() });
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

module.exports = ({ makeRouter, limiter, eluAuth, espace }) => {
  // ------------------------------------------------------------------------------------------------ authentification (publique)
  const a = makeRouter('/api/v1/elus-auth');
  a.post('/invitation/:token', { summary: 'Accepte l’invitation : choisit son mot de passe (lien reçu par mail, à usage unique)', tags: T, auth: false, limiter, params: z.object({ token: z.string().min(20).max(100) }), body: Invitation },
    async (req, res) => res.json(await eluAuth.accepterInvitation(req.valid.params.token, req.valid.body.motDePasse)));
  a.post('/oubli', { summary: 'Mot de passe oublié : envoie un nouveau lien (réponse toujours identique)', tags: T, auth: false, limiter, body: Oubli },
    async (req, res) => res.status(202).json(await eluAuth.oubli(req.valid.body.email, req.valid.body.organismeId)));
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
