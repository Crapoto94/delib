const { z } = require('zod');
const { E } = require('../../shared/errors');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PI = P.extend({ id: Id });
const T = ['API externe'];
const TA = ['clés d\'API'];
const Portee = z.enum(['actes:executoires', 'actes:adoptes', 'actes:encours']);

const ListeQ = z.object({
  categorie: z.enum(['executoires', 'adoptes', 'encours']).optional().describe('Restreint à une catégorie (sinon : toutes celles que la clé peut lire)'),
  annee: z.coerce.number().int().min(1900).max(2200).optional().describe('Année de la séance'), seanceId: Id.optional(), type: z.string().max(40).optional().describe('Code du type d\'acte'), matiere: z.string().max(40).optional().describe('Code de la matière'),
  q: z.string().trim().max(200).optional().describe('Recherche plein texte dans le titre (insensible à la casse et aux accents) ; accepte aussi un n° de suivi ou de délibération exact'),
  motCle: z.string().trim().max(60).optional().describe('Mot-clé du dossier (ou libellé de la matière), mot entier'),
  rapporteurId: Id.optional().describe('Rapporteur : identifiant fourni par GET /externe/rapporteurs'),
  dateDebut: z.iso.date().optional().describe('Date du conseil (à défaut, de création) à partir du jour indiqué, AAAA-MM-JJ'),
  dateFin: z.iso.date().optional().describe('Date du conseil (à défaut, de création) jusqu’au jour indiqué inclus, AAAA-MM-JJ'),
  modifieDepuis: z.iso.datetime().optional().describe('Ne renvoie que ce qui a changé depuis cet instant (ISO 8601) : synchronisation incrémentale'),
  tri: z.enum(['recent', 'seance']).default('recent'), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
const Categorie = z.object({ categorie: z.enum(['executoires', 'adoptes', 'encours']).optional() });
const Registre = z.object({ annee: z.coerce.number().int().min(1900).max(2200), limit: z.coerce.number().int().min(1).max(500).default(500), offset: z.coerce.number().int().min(0).default(0) });
const CleCreation = z.object({
  nom: z.string().trim().min(2).max(120).describe('Application cliente (ex. « Site de la Ville »)'), portees: z.array(Portee).min(1),
  ips: z.array(z.string().trim().max(50)).max(50).optional().describe('Adresses IP ou réseaux a.b.c.d/nn autorisés ; vide : toutes'),
  limiteMinute: z.number().int().min(1).max(6000).optional(), expireLe: z.iso.datetime().nullable().optional(),
  types: z.array(z.string().trim().min(1).max(40)).max(50).optional().describe('Codes des types d’actes visibles avec cette clé ; vide : tous les types'),
  dureeMois: z.number().int().min(1).max(24).optional().describe('Durée visible, en mois, avant aujourd’hui (24 au plus = 2 ans), d’après la date du conseil'),
  contenus: z.object({ acte: z.boolean().optional(), expose: z.boolean().optional(), annexes: z.boolean().optional() }).optional().describe('Ce qui peut être téléchargé : l’acte seul, l’exposé des motifs, les annexes'),
});
const CleModif = CleCreation.partial().extend({ actif: z.boolean().optional() });
const Renouv = z.object({ finAncienneLe: z.iso.datetime().optional().describe('Laisse l\'ancienne clé valable jusqu\'à cet instant (bascule en douceur) ; sinon elle est révoquée tout de suite') }).optional();

module.exports = ({ makeRouter, externe, apiKeys, db, settings }) => {
  // --------------------------------------------------------------------------------------------------- API externe (clé d'API)
  const x = makeRouter('/api/v1/externe');
  x.get('/cle', { summary: 'Identité de la clé : application, organisme, portées et catégories d\'actes accessibles', tags: T, apiKey: true }, async (req, res) => res.json(externe.cle(req.apiKey)));
  x.get('/seances', { summary: 'Conseils passés dont des actes sont visibles avec cette clé (liste de choix pour `seanceId`)', tags: T, apiKey: true, query: Categorie },
    async (req, res) => res.json(await externe.seances(req.apiKey, req.valid.query)));
  x.get('/rapporteurs', { summary: 'Rapporteurs des actes visibles avec cette clé (liste de choix pour `rapporteurId`)', tags: T, apiKey: true, query: Categorie },
    async (req, res) => res.json(await externe.rapporteurs(req.apiKey, req.valid.query)));
  x.get('/types', { summary: 'Types d’actes visibles avec cette clé (liste de choix pour `type`)', tags: T, apiKey: true, query: Categorie },
    async (req, res) => res.json(await externe.types(req.apiKey, req.valid.query)));
  x.get('/actes', {
    summary: 'Liste des actes visibles avec cette clé (exécutoires, adoptés, en cours selon ses portées)', tags: T, apiKey: true, query: ListeQ,
    description: 'Lecture seule. Réponse paginée { total, limit, offset, items }. `modifieDepuis` permet de ne récupérer que les changements. Les actes confidentiels, abandonnés, retirés, rejetés ou ajournés ne sont jamais renvoyés.',
  }, async (req, res) => res.json(await externe.lister(req.apiKey, req.valid.query)));
  x.get('/actes/:id', {
    summary: 'Un acte : métadonnées ; pour les actes exécutoires et adoptés, aussi le texte adopté, le PDF et les annexes publiables', tags: T, apiKey: true, params: z.object({ id: Id }),
    description: 'Un acte en cours de rédaction ne renvoie que ses métadonnées. 404 si l\'acte n\'existe pas OU si la clé n\'a pas le droit de le voir.',
  }, async (req, res) => res.json(await externe.detail(req.apiKey, req.valid.params.id)));
  x.get('/actes/:id/pdf', { summary: 'PDF de la délibération (première, ou `deliberationId`) — actes exécutoires et adoptés seulement', tags: T, apiKey: true, params: z.object({ id: Id }), query: z.object({ deliberationId: Id.optional() }), responses: { 200: 'PDF' } },
    async (req, res) => {
      const f = await externe.pdf(req.apiKey, req.valid.params.id, req.valid.query.deliberationId);
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${f.name}"`); res.setHeader('Cache-Control', 'private, max-age=300'); res.send(f.buffer);
    });
  x.get('/actes/:id/expose', { summary: 'PDF de l’exposé des motifs — si la clé est autorisée à le télécharger', tags: T, apiKey: true, params: z.object({ id: Id }), responses: { 200: 'PDF' } },
    async (req, res) => {
      const f = await externe.expose(req.apiKey, req.valid.params.id);
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${f.name}"`); res.setHeader('Cache-Control', 'private, max-age=300'); res.send(f.buffer);
    });
  x.get('/actes/:id/annexes/:annexeId', { summary: 'Annexe publiable d\'un acte exécutoire ou adopté (PDF)', tags: T, apiKey: true, params: z.object({ id: Id, annexeId: Id }), responses: { 200: 'PDF' } },
    async (req, res) => {
      const f = await externe.annexe(req.apiKey, req.valid.params.id, req.valid.params.annexeId);
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^\w.-]+/g, '_')}"`); res.send(f.buffer);
    });
  x.get('/registre', {
    summary: 'Registre des délibérations exécutoires d\'une année, dans l\'ordre des séances et des numéros', tags: T, apiKey: true, query: Registre,
    description: 'Exige la portée `actes:executoires`.',
  }, async (req, res) => {
    if (!req.apiKey.portees.includes('actes:executoires')) return res.status(403).json({ error: 'Cette clé n\'a pas le droit `actes:executoires`', code: 'FORBIDDEN' });
    return res.json(await externe.lister(req.apiKey, { ...req.valid.query, categorie: 'executoires', tri: 'seance' }));
  });

  // Spécification publique : uniquement l'API externe (jamais les routes internes), pour le Swagger publié en DMZ.
  x.get('/openapi.json', { summary: 'Spécification OpenAPI de l’API externe (sans authentification)', tags: T, auth: false }, (req, res) => {
    const full = req.app.locals.spec;
    const paths = Object.fromEntries(Object.entries(full.paths).filter(([k]) => k.startsWith('/api/v1/externe/')).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, op]) => op.security?.length))]).filter(([, v]) => Object.keys(v).length));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ ...full, info: { title: 'VibeDélib — API publique des actes', version: full.info.version, description: 'Lecture seule des actes (liste, recherche, téléchargement). Authentification par clé d’API : en-tête `Authorization: Bearer vd_…` ou `X-API-Key`. Le périmètre (types, durée, contenus) est fixé par la clé.' }, servers: [{ url: '/' }], paths, tags: [{ name: T[0] }],
      components: { ...full.components, securitySchemes: { apiKeyAuth: full.components.securitySchemes.apiKeyAuth } } });
  });

  // --------------------------------------------------------------------------------------------------- publication SANS authentification (page publique de la DMZ)
  // Désactivée par défaut : l'administrateur l'active (réglage `publication.deliberations_actif`). Délibérations exécutoires seulement,
  // non confidentielles, annexes publiables seulement, jamais l'exposé des motifs. Organisme = organisme par défaut.
  const pub = makeRouter('/api/v1/public/deliberations');
  const PubQ = z.object({ mois: z.coerce.number().int().min(1).max(24).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) });
  const PubJeton = z.object({ jeton: z.string().min(20).max(300).regex(/^[A-Za-z0-9_-]+$/) });
  const publication = async () => {
    const o = await db.get('SELECT id, nom FROM organismes WHERE is_default AND actif');
    const cfg = o ? await settings.resolve(o.id) : {};
    if (!o || cfg['publication.deliberations_actif']?.value !== true) throw E.notFound('Publication non activée');
    return { org: o, mois: Math.min(24, Math.max(1, Number(cfg['publication.deliberations_mois']?.value) || 6)) };
  };
  pub.get('/', { summary: 'Délibérations exécutoires des derniers mois (publiques), paginées, avec liens chiffrés vers le PDF et les annexes', tags: ['publication'], auth: false, query: PubQ,
    description: '404 tant que la publication n’est pas activée par l’administrateur. `mois` ne dépasse jamais la durée réglée (24 au plus). Les liens sont des jetons chiffrés : aucun numéro d’acte n’est exposé.' },
  async (req, res) => {
    const { org, mois } = await publication(); const q = req.valid.query;
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ organisme: org.nom, ...(await externe.publication(org.id, Math.min(mois, q.mois ?? mois), { limit: q.limit, offset: (q.page - 1) * q.limit })) });
  });
  pub.get('/f/:jeton', { summary: 'Document (délibération ou annexe) désigné par un lien chiffré de la liste', tags: ['publication'], auth: false, params: PubJeton, responses: { 200: 'PDF' } }, async (req, res) => {
    const { org, mois } = await publication();
    const f = await externe.documentPublic(org.id, mois, req.valid.params.jeton);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^\w.-]+/g, '_')}"`); res.setHeader('Cache-Control', 'public, max-age=300'); res.send(f.buffer);
  });

  // --------------------------------------------------------------------------------------------------- administration des clés (administrateur de l'organisme)
  const a = makeRouter('/api/v1/organismes/:orgId/cles-api');
  const ADMIN = ['org_admin'];
  a.get('/', { summary: 'Clés d\'API de l\'organisme (jamais la clé elle-même) et droits disponibles', tags: TA, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json({ items: await apiKeys.lister(req.org.id), portees: Object.entries(apiKeys.PORTEES).map(([code, description]) => ({ code, description })),
      contenus: Object.entries(apiKeys.CONTENUS).map(([code, description]) => ({ code, description })), dureeMax: apiKeys.DUREE_MAX,
      types: (await db.all("SELECT code, libelle FROM ref_items WHERE kind = 'type_acte' AND (organisme_id IS NULL OR organisme_id = $1) ORDER BY libelle", [req.org.id])) }));
  a.post('/', { summary: 'Crée une clé d\'API : la clé complète n\'est affichée qu\'une seule fois', tags: TA, org: true, roles: ADMIN, params: P, body: CleCreation, responses: { 201: 'Créée' },
    description: 'Seule l\'empreinte du secret est conservée. Les droits distinguent les actes exécutoires, les actes adoptés et les actes en cours de rédaction.' },
  async (req, res) => res.status(201).json(await apiKeys.creer(req.ctx, req.org.id, req.valid.body)));
  a.put('/:id', { summary: 'Modifie une clé (nom, droits, IP, limite, expiration, activation)', tags: TA, org: true, roles: ADMIN, params: PI, body: CleModif },
    async (req, res) => res.json(await apiKeys.modifier(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  a.post('/:id/renouvellement', { summary: 'Renouvelle une clé : nouvelle clé aux mêmes droits (affichée une seule fois), l\'ancienne est révoquée ou expire à la date indiquée', tags: TA, org: true, roles: ADMIN, params: PI, body: Renouv, responses: { 201: 'Nouvelle clé' } },
    async (req, res) => res.status(201).json(await apiKeys.renouveler(req.ctx, req.org.id, req.valid.params.id, req.valid.body || {})));
  a.delete('/:id', { summary: 'Révoque une clé (immédiat, irréversible)', tags: TA, org: true, roles: ADMIN, params: PI },
    async (req, res) => res.json(await apiKeys.revoquer(req.ctx, req.org.id, req.valid.params.id)));
  return [x, a, pub];
};
