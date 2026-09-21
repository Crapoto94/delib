const { z } = require('zod');
const { STATUTS, SEANCE_TYPES } = require('./seances.service');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PI = P.extend({ id: Id });
const ADMIN = ['org_admin', 'scc'];
const Dt = z.union([z.iso.datetime(), z.iso.date()]);

const Numbering = z.object({ pattern: z.string().min(3).max(120).describe('Variables : {ANNEE} {N_SEANCE} {ORDRE} {ORDRE:03} {RUBRIQUE} ; préfixes, suffixes et séparateurs libres') }).passthrough();
const Instance = z.object({ code: z.string().regex(/^[a-z0-9_-]{2,40}$/), nom: z.string().trim().min(2).max(160), kind: z.enum(['conseil', 'commission', 'autre']).optional(), commissionId: Id.optional(), numbering: Numbering.optional() });
const InstancePatch = z.object({ nom: z.string().trim().min(2).max(160), actif: z.boolean(), numbering: Numbering }).partial();
const Jalon = z.object({ code: z.string().regex(/^[a-z0-9_-]{2,40}$/), label: z.string().max(120), date: Dt });
const SeanceIn = z.object({
  instanceId: Id, type: z.enum(SEANCE_TYPES).optional(), dateSeance: z.iso.datetime(), lieu: z.string().max(200).optional(),
  dureeMinutes: z.number().int().min(15).max(720).optional(), dateLimiteRedaction: Dt.nullable().optional(), dateLimiteDgs: Dt.nullable().optional(), dateLimiteMadCommissions: Dt.nullable().optional(), dateEnvoiConvocation: Dt.nullable().optional(),
  jalonsExtra: z.array(Jalon).max(20).optional(), numbering: Numbering.optional(),
});
const SeancePatch = SeanceIn.omit({ instanceId: true }).partial().extend({ statut: z.enum(STATUTS).optional(), numbering: Numbering.nullable().optional() });
const TeamsB = z.object({ mode: z.enum(['auto', 'lien', 'aucun']), joinUrl: z.string().url().optional(), inviter: z.boolean().default(false) })
  .refine((d) => d.mode !== 'lien' || !!d.joinUrl, { message: 'Le lien Teams est obligatoire', path: ['joinUrl'] });
const ListQ = z.object({ kind: z.enum(['conseil', 'commission', 'autre']).optional(), commissionId: Id.optional(), instanceId: Id.optional(), statut: z.enum(STATUTS).optional(), from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().min(0).default(0) });
const DelQ = z.object({ destination: z.enum(['prochaine', 'aucune']).optional().describe('Que deviennent les actes : reportés sur la séance suivante, ou sans affectation'), motif: z.string().trim().max(500).optional(), forcer: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') });
const ProposeQ = z.object({ dateSeance: z.iso.datetime() });
const Report = z.object({ motif: z.string().trim().min(3).max(500), toSeanceId: Id.optional() });
const DerReq = z.object({ motif: z.string().trim().min(5).max(1000), nouvelleDateLimite: z.iso.datetime().optional() });
const DerDec = z.object({ decision: z.enum(['accordee', 'refusee']), motif: z.string().trim().max(1000).optional(), valideJusquAu: z.iso.datetime().optional() });
const DerQ = z.object({ statut: z.enum(['demandee', 'accordee', 'refusee', 'annulee']).optional(), acteId: Id.optional() });

module.exports = ({ makeRouter, seances, deadlines }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');
  const T = ['séances'];

  r.get('/instances', { summary: 'Instances (Conseil municipal, commissions…)', tags: T, org: true, params: P }, async (req, res) => res.json({ items: await seances.instances(req.org.id) }));
  r.post('/instances', { summary: 'Crée une instance', tags: T, org: true, roles: ADMIN, params: P, body: Instance, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await seances.createInstance(req.ctx, req.org.id, req.valid.body)));
  r.put('/instances/:id', { summary: 'Modifie une instance (dont le format de numérotation par défaut)', tags: T, org: true, roles: ADMIN, params: PI, body: InstancePatch },
    async (req, res) => res.json(await seances.updateInstance(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/seances', { summary: 'Séances (avec le nombre d\'actes en attente d\'affectation)', tags: T, org: true, params: P, query: ListQ },
    async (req, res) => res.json(await seances.list(req.org.id, req.valid.query)));
  r.get('/seances/retroplanning', { summary: "Rétroplanning (étapes et décalages) — étapes par défaut si non configuré", tags: T, org: true, params: P,
    description: "Chaque étape est à J-x jours ouvrés de la suivante ; la dernière est le jour du conseil. Réglable via le paramètre `seances.retroplanning` (objet `{ etapes: [{ code, label, jours }] }`)." },
  async (req, res) => res.json(await seances.retroplanning(req.org.id)));
  r.get('/seances/dates-proposees', { summary: 'Dates clés proposées pour une date de séance', tags: T, org: true, roles: ADMIN, params: P, query: ProposeQ,
    description: 'Rétroplanning configuré (`seances.retroplanning`) ou, à défaut, décalages historiques (`seances.decalage.*`). Renvoie les jalons datés.' },
  async (req, res) => res.json(await seances.proposeDates(req.org.id, req.valid.query.dateSeance)));
  r.get('/seances/hors-delai', { summary: 'Liste « hors délai » du SCC : actes bloqués par la date limite', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json(await seances.horsDelai(req.org.id)));
  r.post('/seances', { summary: 'Crée une séance (dates clés pré-remplies si non fournies)', tags: T, org: true, roles: ADMIN, params: P, body: SeanceIn, responses: { 201: 'Créé' },
    description: 'Une date seule (AAAA-MM-JJ) pour une date limite signifie « fin de journée, heure de Paris ».' },
  async (req, res) => res.status(201).json(await seances.create(req.ctx, req.org.id, req.valid.body)));
  r.get('/seances/:id', { summary: 'Séance, jalons et état', tags: T, org: true, params: PI }, async (req, res) => res.json(await seances.get(req.org.id, req.valid.params.id)));
  r.put('/seances/:id', { summary: 'Modifie une séance, ses dates clés ou son statut', tags: T, org: true, roles: ADMIN, params: PI, body: SeancePatch,
    description: 'Un changement de date limite recalcule d\'office les rappels (ils sont calculés à chaque passage du planificateur).' },
  async (req, res) => res.json(await seances.update(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.get('/seances/:id/suppression', { summary: 'Impact de la suppression : actes concernés, séance suivante proposée, convocations déjà envoyées', tags: T, org: true, roles: ADMIN, params: PI },
    async (req, res) => res.json(await seances.suppressionImpact(req.org.id, req.valid.params.id)));
  r.delete('/seances/:id', { summary: 'Supprime une séance (les actes sont reportés sur la suivante ou remis sans affectation)', tags: T, org: true, roles: ADMIN, params: PI, query: DelQ,
    description: "Refusé (409) pour une séance tenue ou dont le suivi est ouvert. `destination` est obligatoire quand des actes visent la séance ou sont à son ordre du jour : `prochaine` (409 s'il n'y a pas de séance suivante) ou `aucune`. Des convocations déjà envoyées demandent `forcer=true`." },
  async (req, res) => res.json(await seances.remove(req.ctx, req.org.id, req.valid.params.id, req.valid.query)));
  r.put('/seances/:id/teams', { summary: 'Associe (ou retire) une réunion Microsoft Teams à la séance', tags: T, org: true, roles: ADMIN, params: PI, body: TeamsB,
    description: "`auto` : crée la réunion Teams via Microsoft Graph (organisateur configuré côté serveur) ; `lien` : enregistre un lien de réunion Teams (https://teams.microsoft.com/…) ; `aucun` : retire le lien (et annule la réunion créée automatiquement). `inviter: true` envoie les invitations Teams aux membres." },
  async (req, res) => res.json(await seances.setTeams(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/seances/:id/non-traites', { summary: 'Actes non traités d\'une séance (candidats au report)', tags: T, org: true, roles: ADMIN, params: PI },
    async (req, res) => res.json(await seances.nonTraites(req.org.id, req.valid.params.id)));

  r.get('/actes/:id/seance-historique', { summary: 'Historique des séances visées, affectations et reports d\'un acte', tags: T, org: true, params: PI },
    async (req, res) => { await seances.assertActeVisible(req.ctx, req.org.id, req.valid.params.id); res.json({ items: await seances.history(req.valid.params.id) }); });
  r.post('/actes/:id/report', { summary: 'Reporte l\'acte à la séance suivante (ou à une séance donnée)', tags: T, org: true, params: PI, body: Report,
    description: 'SCC / administrateur ; le rédacteur peut reporter son propre acte tant qu\'il est en rédaction. Tracé dans l\'historique.' },
  async (req, res) => res.json(await seances.report(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  // --- dérogations
  r.get('/derogations', { summary: 'Demandes de dérogation (les miennes, ou toutes pour le SCC / DGS)', tags: ['dérogations'], org: true, params: P, query: DerQ },
    async (req, res) => res.json({ items: await deadlines.list(req.ctx, req.org.id, req.valid.query) }));
  r.post('/actes/:id/derogations', { summary: 'Demande une dérogation à la date limite de rédaction', tags: ['dérogations'], org: true, params: PI, body: DerReq, responses: { 201: 'Créé' },
    description: 'Rédacteur, chef de service ou directeur. Motif obligatoire ; nouvelle date limite souhaitée facultative.' },
  async (req, res) => res.status(201).json(await deadlines.request(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.post('/derogations/:id/decision', { summary: 'Accorde ou refuse une dérogation', tags: ['dérogations'], org: true, params: PI, body: DerDec,
    description: 'SCC ou DGS (paramètre `derogations.roles`). Une dérogation peut être limitée dans le temps (`valideJusquAu`) : passé ce délai, le blocage se réapplique.' },
  async (req, res) => res.json(await deadlines.decide(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/derogations/:id', { summary: 'Annule une demande en attente', tags: ['dérogations'], org: true, params: PI },
    async (req, res) => res.json(await deadlines.cancel(req.ctx, req.org.id, req.valid.params.id)));

  return [r];
};
