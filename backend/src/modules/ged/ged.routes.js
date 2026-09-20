const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PS = P.extend({ id: Id });
const ADMIN = ['org_admin'];
const ARCH = ['org_admin', 'scc'];
const T = ['GED'];

const Config = z.object({
  actif: z.boolean(), mode: z.enum(['simulation', 'alfresco']), url: z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/.+/i.test(v), 'URL http(s) attendue'),
  utilisateur: z.string().trim().max(120), motDePasse: z.string().max(200).describe('Vide : le mot de passe enregistré est conservé. Jamais renvoyé par l\'API.'),
  racine: z.string().trim().max(300).describe('Identifiant de nœud, ou chemin relatif à Company Home (ex. /Sites/archives/documentLibrary) ; vide = racine du dépôt'),
  autoArchivage: z.boolean(),
}).partial();
const Essai = Config.pick({ mode: true, url: true, utilisateur: true, motDePasse: true, racine: true }).optional();
const NodeQ = z.object({ nodeId: z.string().regex(/^[0-9a-fA-F-]{8,64}$/).optional() });
const NodeP = P.extend({ nodeId: z.string().regex(/^[0-9a-fA-F-]{8,64}$/) });
const DocQ = z.object({ seanceId: Id.optional() });

module.exports = ({ makeRouter, ged }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/ged');

  r.get('/config', { summary: 'Paramétrage de la GED Alfresco (le mot de passe n\'est jamais renvoyé)', tags: T, org: true, roles: ADMIN, params: P }, async (req, res) => res.json(await ged.config(req.org.id)));
  r.put('/config', { summary: 'Modifie le paramétrage de la GED (mode simulation ou Alfresco, URL, compte, racine, archivage actif / automatique)', tags: T, org: true, roles: ADMIN, params: P, body: Config,
    description: 'Le mot de passe est chiffré au repos. Pour activer le mode Alfresco, l\'URL, le compte et le mot de passe sont obligatoires.' },
  async (req, res) => res.json(await ged.setConfig(req.ctx, req.org.id, req.valid.body)));
  r.post('/test', { summary: 'Teste la connexion à la GED (configuration enregistrée, ou celle proposée dans le corps sans l\'enregistrer)', tags: T, org: true, roles: ADMIN, params: P, body: Essai,
    description: 'Ne lève pas d\'erreur : renvoie `{ ok, message, details }` avec un diagnostic (authentification, dossier racine, réseau), la version et l\'édition du dépôt, et le temps de réponse.' },
  async (req, res) => res.json(await ged.tester(req.ctx, req.org.id, req.valid.body || null)));
  r.post('/plan', { summary: 'Crée le plan de classement (idempotent) : séances par année, registre des délibérations, sous-dossiers numérotés avec finalité et conservation', tags: T, org: true, roles: ADMIN, params: P, responses: { 201: 'Créé' },
    description: 'Ce qui existe déjà n\'est jamais recréé. La durée de conservation portée par chaque dossier est indicative : à faire valider par le service des archives.' },
  async (req, res) => res.status(201).json(await ged.creerPlan(req.ctx, req.org.id)));
  r.get('/explorateur', { summary: 'Explore le plan de classement (enfants d\'un dossier, ou de la racine)', tags: T, org: true, roles: ARCH, params: P, query: NodeQ }, async (req, res) => res.json(await ged.explorer(req.ctx, req.org.id, req.valid.query.nodeId)));
  r.get('/noeuds/:nodeId/contenu', { summary: 'Contenu d\'un document déposé en GED (PDF)', tags: T, org: true, roles: ARCH, params: NodeP, responses: { 200: 'PDF' } },
    async (req, res) => { const b = await ged.contenu(req.ctx, req.org.id, req.valid.params.nodeId); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="document.pdf"'); res.send(b); });
  r.post('/seances/:id/archivage', { summary: 'Archive (ou met à jour) tous les documents d\'une séance en GED : idempotent, nouvelle version si un document a changé', tags: T, org: true, roles: ARCH, params: PS,
    description: 'Convocation, ordre du jour, exposé, projet et annexes de chaque délibération, cahier, procès-verbal, liste, extraits du registre, accusés de réception. Un échec sur un document n\'arrête pas les autres et reste rejouable.' },
  async (req, res) => res.json(await ged.archiverSeance(req.ctx, req.org.id, req.valid.params.id)));
  r.get('/synchronisation', { summary: 'État comparé VibeDélib / GED, séance par séance : à archiver, à mettre à jour, en erreur, manquants, synchronisés', tags: T, org: true, roles: ARCH, params: P },
    async (req, res) => res.json(await ged.etatSynchro(req.ctx, req.org.id)));
  r.post('/synchronisation', { summary: 'Synchronise vers la GED (local → GED) : dépose ce qui manque ou a changé, pour les séances indiquées ou toutes', tags: T, org: true, roles: ARCH, params: P,
    body: z.object({ seanceIds: z.array(Id).max(100).optional() }).optional(),
    description: 'Idempotent et rejouable. Un échec sur une séance n’arrête pas les autres ; le compte rendu indique ce qui a été déposé, mis à jour ou refusé.' },
  async (req, res) => res.json(await ged.synchroniser(req.ctx, req.org.id, req.valid.body || {})));
  r.post('/verification', { summary: 'Vérifie (GED → local) que chaque document déposé existe toujours dans la GED ; les absents sont marqués « manquants » et seront redéposés', tags: T, org: true, roles: ARCH, params: P },
    async (req, res) => res.json(await ged.verifier(req.ctx, req.org.id)));
  r.get('/documents', { summary: 'Documents déposés en GED (chemin, nœud, version, date, statut)', tags: T, org: true, roles: ARCH, params: P, query: DocQ }, async (req, res) => res.json(await ged.documents(req.ctx, req.org.id, req.valid.query)));

  return [r];
};
