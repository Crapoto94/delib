const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PI = P.extend({ id: Id });
const T = ['API externe'];
const TA = ['clés d\'API'];
const Portee = z.enum(['actes:executoires', 'actes:adoptes', 'actes:encours']);

const ListeQ = z.object({
  categorie: z.enum(['executoires', 'adoptes', 'encours']).optional().describe('Restreint à une catégorie (sinon : toutes celles que la clé peut lire)'),
  annee: z.coerce.number().int().min(1900).max(2200).optional().describe('Année de la séance'), seanceId: Id.optional(), type: z.string().max(40).optional().describe('Code du type d\'acte'), matiere: z.string().max(40).optional().describe('Code de la matière'),
  q: z.string().trim().max(200).optional().describe('Mot du titre, n° de suivi ou n° de délibération'),
  modifieDepuis: z.iso.datetime().optional().describe('Ne renvoie que ce qui a changé depuis cet instant (ISO 8601) : synchronisation incrémentale'),
  tri: z.enum(['recent', 'seance']).default('recent'), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
const Registre = z.object({ annee: z.coerce.number().int().min(1900).max(2200), limit: z.coerce.number().int().min(1).max(500).default(500), offset: z.coerce.number().int().min(0).default(0) });
const CleCreation = z.object({
  nom: z.string().trim().min(2).max(120).describe('Application cliente (ex. « Site de la Ville »)'), portees: z.array(Portee).min(1),
  ips: z.array(z.string().trim().max(50)).max(50).optional().describe('Adresses IP ou réseaux a.b.c.d/nn autorisés ; vide : toutes'),
  limiteMinute: z.number().int().min(1).max(6000).optional(), expireLe: z.iso.datetime().nullable().optional(),
});
const CleModif = CleCreation.partial().extend({ actif: z.boolean().optional() });
const Renouv = z.object({ finAncienneLe: z.iso.datetime().optional().describe('Laisse l\'ancienne clé valable jusqu\'à cet instant (bascule en douceur) ; sinon elle est révoquée tout de suite') }).optional();

module.exports = ({ makeRouter, externe, apiKeys }) => {
  // --------------------------------------------------------------------------------------------------- API externe (clé d'API)
  const x = makeRouter('/api/v1/externe');
  x.get('/cle', { summary: 'Identité de la clé : application, organisme, portées et catégories d\'actes accessibles', tags: T, apiKey: true }, async (req, res) => res.json(externe.cle(req.apiKey)));
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

  // --------------------------------------------------------------------------------------------------- administration des clés (administrateur de l'organisme)
  const a = makeRouter('/api/v1/organismes/:orgId/cles-api');
  const ADMIN = ['org_admin'];
  a.get('/', { summary: 'Clés d\'API de l\'organisme (jamais la clé elle-même) et droits disponibles', tags: TA, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json({ items: await apiKeys.lister(req.org.id), portees: Object.entries(apiKeys.PORTEES).map(([code, description]) => ({ code, description })) }));
  a.post('/', { summary: 'Crée une clé d\'API : la clé complète n\'est affichée qu\'une seule fois', tags: TA, org: true, roles: ADMIN, params: P, body: CleCreation, responses: { 201: 'Créée' },
    description: 'Seule l\'empreinte du secret est conservée. Les droits distinguent les actes exécutoires, les actes adoptés et les actes en cours de rédaction.' },
  async (req, res) => res.status(201).json(await apiKeys.creer(req.ctx, req.org.id, req.valid.body)));
  a.put('/:id', { summary: 'Modifie une clé (nom, droits, IP, limite, expiration, activation)', tags: TA, org: true, roles: ADMIN, params: PI, body: CleModif },
    async (req, res) => res.json(await apiKeys.modifier(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  a.post('/:id/renouvellement', { summary: 'Renouvelle une clé : nouvelle clé aux mêmes droits (affichée une seule fois), l\'ancienne est révoquée ou expire à la date indiquée', tags: TA, org: true, roles: ADMIN, params: PI, body: Renouv, responses: { 201: 'Nouvelle clé' } },
    async (req, res) => res.status(201).json(await apiKeys.renouveler(req.ctx, req.org.id, req.valid.params.id, req.valid.body || {})));
  a.delete('/:id', { summary: 'Révoque une clé (immédiat, irréversible)', tags: TA, org: true, roles: ADMIN, params: PI },
    async (req, res) => res.json(await apiKeys.revoquer(req.ctx, req.org.id, req.valid.params.id)));
  return [x, a];
};
