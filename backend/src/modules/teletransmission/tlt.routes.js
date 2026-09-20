const { z } = require('zod');
const { SCENARIOS } = require('../../adapters/s2low-simulateur');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PS = P.extend({ id: Id });
const PT = P.extend({ tid: Id });
const PD = P.extend({ did: Id });
const ROLES = ['org_admin', 'scc', 'teletransmission'];
const T = ['télétransmission'];
const Scenario = z.enum(Object.keys(SCENARIOS));

const Config = z.object({
  fournisseur: z.string().regex(/^[a-z0-9_]{2,20}$/).describe('Tiers de télétransmission : s2low (défaut), fast (à venir)'),
  url: z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/.+/i.test(v), 'URL http(s) attendue'), utilisateur: z.string().trim().max(120),
  motDePasse: z.string().max(200).describe('Vide : le mot de passe enregistré est conservé. Jamais renvoyé par l\'API.'),
  mode: z.enum(['simulation', 'test', 'production']), modeEnvoi: z.enum(['A', 'B']).describe('A : envoi direct ; B : préparation puis confirmation sur S²LOW (recommandé)'),
  scenario: Scenario.describe('Scénario de simulation par défaut'), siren: z.string().regex(/^\d{0,9}$/), departement: z.string().regex(/^\d{0,3}$/), arrondissement: z.string().regex(/^\d{0,1}$/),
  motif: z.string().trim().min(3).max(80).describe('Motif du numéro transmis : {ANNEE} {TYPE_SEANCE} {N_SEANCE:02} {ORDRE:03}'), doubleValidation: z.boolean(),
  rolesEnvoi: z.array(z.enum(['org_admin', 'scc', 'teletransmission'])).max(3).describe('Rôles autorisés à envoyer et confirmer'), envoiAuto: z.boolean().describe("Envoie aussitôt après la préparation (incompatible avec la double validation)"),
  confirmationAuto: z.boolean().describe("Mode B : confirme aussitôt après l'envoi"), preparationAuto: z.boolean().describe('Prépare les délibérations adoptées à la clôture de la séance'), modificationTexte: z.boolean().describe('Le SCC peut modifier le texte avant la transmission'),
}).partial();
const Preparer = z.object({ itemIds: z.array(Id).min(1).max(200), scenario: Scenario.optional().describe('Scénario de simulation pour ces transmissions'), envoyer: z.boolean().default(false).describe("Enchaîne l'envoi des transmissions préparées (« Préparer et envoyer »)") });
const Lot = z.object({ ids: z.array(Id).min(1).max(200) });
const Affichage = z.object({ date: z.iso.date().nullable().describe('Date de publication par voie d\'affichage ; null : reprend la date de l\'AR') });
const Annuler = z.object({ motif: z.string().trim().max(300).optional() });
const Reponse = z.object({ typeEnvoie: z.union([z.literal(3), z.literal(4)]).describe('3 : refus d’envoi de pièce ; 4 : envoi de pièce'), message: z.string().trim().max(1000).optional() });
const Avancer = z.object({ transactionId: Id.optional(), remoteId: z.string().regex(/^S2L-\d+$/).optional().describe('Identifiant S²LOW (simulateur) : alternative à transactionId'), pas: z.number().int().min(1).max(10).default(1) });
const ListQ = z.object({ seanceId: Id.optional() });
const Tampon = z.object({ dateAffichage: z.iso.date().optional() });

const send = (res, f) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${f.name}"`); res.send(f.buffer); };

module.exports = ({ makeRouter, tlt }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/teletransmission');

  r.get('/config', { summary: 'Paramètres de télétransmission (mode, envoi A/B, identifiants, motif du numéro, scénario de simulation)', tags: T, org: true, roles: ROLES, params: P,
    description: 'Tant que l’accès à S²LOW n’est pas obtenu (D20), le mode est « simulation » : le simulateur rejoue les réponses de S²LOW, dont les retours de la préfecture.' },
  async (req, res) => res.json(await tlt.config(req.org.id)));
  r.post('/test', { summary: 'Teste la connexion au tiers de télétransmission choisi', tags: T, org: true, roles: ['org_admin'], params: P,
    description: 'Ne lève pas d’erreur : renvoie `{ ok, message, fournisseur, mode }`.' }, async (req, res) => res.json(await tlt.tester(req.ctx, req.org.id)));
  r.put('/config', { summary: 'Modifie les paramètres de télétransmission', tags: T, org: true, roles: ['org_admin'], params: P, body: Config },
    async (req, res) => res.json(await tlt.setConfig(req.ctx, req.org.id, req.valid.body)));
  r.get('/tableau', { summary: 'Tableau de bord : à préparer, en attente de confirmation, en attente d’AR, en erreur, documents de la préfecture à traiter', tags: T, org: true, roles: ROLES, params: P },
    async (req, res) => res.json(await tlt.tableau(req.ctx, req.org.id)));

  r.get('/seances/:id/lot', { summary: 'Lot de télétransmission d’une séance : délibérations adoptées (et exclues avec leur raison), numéro transmis, contrôles préalables', tags: T, org: true, roles: ROLES, params: PS },
    async (req, res) => res.json(await tlt.lot(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/seances/:id/preparation', { summary: 'Prépare la transmission de délibérations (PDF, numéro transmis, classification) — aucun envoi', tags: T, org: true, roles: ROLES, params: PS, body: Preparer,
    description: 'Les délibérations qui ont des contrôles bloquants sont refusées avec leurs raisons ; les autres sont préparées.' },
  async (req, res) => res.json(await tlt.preparer(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/transactions', { summary: 'Transactions de télétransmission', tags: T, org: true, roles: ROLES, params: P, query: ListQ },
    async (req, res) => res.json(await tlt.liste(req.ctx, req.org.id, req.valid.query)));
  r.post('/transactions/envoi-lot', { summary: "Envoie plusieurs transmissions préparées d'un coup (chacune est traitée seule : une erreur n'arrête pas les autres)", tags: T, org: true, roles: ROLES, params: P, body: Lot,
    description: "Renvoie, pour chaque transmission, `ok` ou la raison du refus. Double validation et rôles autorisés s'appliquent à chacune." },
  async (req, res) => res.json(await tlt.envoyerLot(req.ctx, req.org.id, req.valid.body.ids, { confirmer: false })));
  r.post('/transactions/confirmation-lot', { summary: "Mode B : confirme plusieurs transmissions postées « en attente » d'un coup", tags: T, org: true, roles: ROLES, params: P, body: Lot },
    async (req, res) => res.json(await tlt.confirmerLot(req.ctx, req.org.id, req.valid.body.ids)));
  r.get('/transactions/:tid', { summary: 'Détail et journal d’une transaction', tags: T, org: true, roles: ROLES, params: PT },
    async (req, res) => res.json(await tlt.detail(req.ctx, req.org.id, req.valid.params.tid)));
  r.post('/transactions/:tid/envoi', { summary: 'Envoie la transaction à S²LOW (mode A : postée ; mode B : postée en attente de confirmation)', tags: T, org: true, roles: ROLES, params: PT,
    description: 'Action explicite. Avec la double validation, l’envoi doit être fait par une autre personne que celle qui a préparé. 409 si S²LOW refuse (KO + message).' },
  async (req, res) => res.json(await tlt.envoyer(req.ctx, req.org.id, req.valid.params.tid)));
  r.post('/transactions/:tid/confirmation', { summary: 'Mode B : confirme la transaction sur S²LOW (17 → 1)', tags: T, org: true, roles: ROLES, params: PT },
    async (req, res) => res.json(await tlt.confirmer(req.ctx, req.org.id, req.valid.params.tid)));
  r.put('/transactions/:tid/affichage', { summary: "Date d'affichage (publication) : mention « publié par voie d'affichage » de l'extrait du registre, saisie après l'AR", tags: T, org: true, roles: ROLES, params: PT, body: Affichage },
    async (req, res) => res.json(await tlt.definirAffichage(req.ctx, req.org.id, req.valid.params.tid, req.valid.body.date)));
  r.post('/transactions/:tid/annulation', { summary: 'Annule la transaction (avant l’acquittement)', tags: T, org: true, roles: ROLES, params: PT, body: Annuler },
    async (req, res) => res.json(await tlt.annuler(req.ctx, req.org.id, req.valid.params.tid, req.valid.body.motif)));
  r.get('/transactions/:tid/bordereau', { summary: 'Bordereau d’acquittement (PDF)', tags: T, org: true, roles: ROLES, params: PT, responses: { 200: 'PDF' } },
    async (req, res) => send(res, await tlt.bordereau(req.ctx, req.org.id, req.valid.params.tid)));
  r.get('/transactions/:tid/ar', { summary: "ARActe : champs lus de l'accusé de réception XML de la préfecture (identifiant, date de réception, acte reçu)", tags: T, org: true, roles: ROLES, params: PT },
    async (req, res) => { const f = await tlt.arXml(req.ctx, req.org.id, req.valid.params.tid); res.json({ nom: f.name, ...f.champs }); });
  r.get('/transactions/:tid/ar.xml', { summary: "Télécharge l'ARActe (fichier XML de la préfecture)", tags: T, org: true, roles: ROLES, params: PT, responses: { 200: 'XML' } },
    async (req, res) => { const f = await tlt.arXml(req.ctx, req.org.id, req.valid.params.tid); res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`); res.send(f.buffer); });
  r.get('/transactions/:tid/extrait', { summary: "Extrait du registre de la délibération transmise, tamponné avec l'AR de la préfecture (PDF)", tags: T, org: true, roles: ROLES, params: PT, responses: { 200: 'PDF' } },
    async (req, res) => send(res, await tlt.extrait(req.ctx, req.org.id, req.valid.params.tid)));
  r.get('/transactions/:tid/acte-tamponne', { summary: 'Acte transmis, tamponné avec la date de publication (PDF)', tags: T, org: true, roles: ROLES, params: PT, query: Tampon, responses: { 200: 'PDF' } },
    async (req, res) => send(res, await tlt.acteTamponne(req.ctx, req.org.id, req.valid.params.tid, req.valid.query.dateAffichage)));

  r.post('/suivi', { summary: 'Interroge S²LOW maintenant : statuts, ARActe, documents de la préfecture', tags: T, org: true, roles: ROLES, params: P },
    async (req, res) => res.json(await tlt.suivre(req.org.id, req.ctx.username)));
  r.get('/documents', { summary: 'Documents de la préfecture (demandes de pièces, lettres d’observations, déférés…)', tags: T, org: true, roles: ROLES, params: P },
    async (req, res) => res.json(await tlt.documents(req.ctx, req.org.id)));
  r.post('/documents/:did/reponse', { summary: 'Répond à une demande de pièces complémentaires de la préfecture', tags: T, org: true, roles: ROLES, params: PD, body: Reponse },
    async (req, res) => res.json(await tlt.repondre(req.ctx, req.org.id, req.valid.params.did, req.valid.body)));
  r.post('/documents/:did/cloture', { summary: 'Clôt un document de la préfecture sans réponse (lettre d’observations traitée, par exemple)', tags: T, org: true, roles: ROLES, params: PD },
    async (req, res) => res.json(await tlt.clore(req.ctx, req.org.id, req.valid.params.did)));

  r.get('/simulation', { summary: 'Simulation : état du serveur S²LOW factice et scénarios disponibles', tags: T, org: true, roles: ROLES, params: P },
    async (req, res) => res.json(await tlt.simulation(req.ctx, req.org.id)));
  r.post('/simulation/avancer', { summary: 'Simulation : fait avancer le serveur factice (statuts, AR, retours de la préfecture), puis rejoue le suivi', tags: T, org: true, roles: ROLES, params: P, body: Avancer,
    description: 'Sans `transactionId`, toutes les transactions de l’organisme qui peuvent avancer franchissent `pas` étape(s) de leur scénario. 409 hors mode simulation.' },
  async (req, res) => res.json(await tlt.avancer(req.ctx, req.org.id, req.valid.body)));

  return [r];
};
