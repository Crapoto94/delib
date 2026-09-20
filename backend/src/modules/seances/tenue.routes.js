const { z } = require('zod');
const { CHOIX } = require('./tenue.rules');

const Id = z.coerce.number().int().positive();
const PS = z.object({ orgId: Id, id: Id });
const PI = PS.extend({ itemId: Id });
const PM = PS.extend({ eluId: Id });
const ADMIN = ['org_admin', 'scc'];

const StateQ = z.object({
  since: z.coerce.number().int().min(0).default(0).describe('Dernière version connue : la réponse attend qu\'elle soit dépassée'),
  wait: z.coerce.number().int().min(0).max(30).default(0).describe('Attente longue en secondes (0 : réponse immédiate)'),
});
const Motif = z.object({ motif: z.string().trim().min(3).max(500) });
const Notes = z.object({ notes: z.string().max(20000) });
const Bureau = z.object({ presidentId: Id.nullable().optional(), secretaireId: Id.nullable().optional() }).refine((d) => d.presidentId !== undefined || d.secretaireId !== undefined, { message: 'Rien à modifier' });
const Presences = z.object({ eluIds: z.array(Id).min(1).max(400), etat: z.enum(['en_salle', 'sorti', 'absent', 'excuse']) });
const Procuration = z.object({ mandantId: Id, mandataireId: Id });
const Courant = z.object({ itemId: Id.optional(), sens: z.enum(['suivant', 'precedent']).optional() }).refine((d) => !!d.itemId !== !!d.sens, { message: 'Indiquez soit itemId, soit sens' });
const Scrutin = z.object({ scrutin: z.enum(['main_levee', 'public', 'secret', 'unanimite']) });
const Votes = z.object({ votes: z.array(z.object({ eluId: Id, choix: z.enum(CHOIX).nullable() })).min(1).max(400) });
const Cloture = z.object({ issue: z.enum(['vote', 'sans_vote', 'retire', 'ajourne']), motif: z.string().trim().max(500).optional() });

module.exports = ({ makeRouter, tenue }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/seances/:id/tenue');
  const T = ['suivi de séance'];

  r.get('/', {
    summary: 'État du suivi de séance (présences, pouvoirs, point en cours, votes) — synchronisation en direct', tags: T, org: true, params: PS, query: StateQ,
    description: "Avec `since` et `wait`, la requête reste en attente jusqu'à ce que la version dépasse `since` (ou `wait` secondes), puis renvoie l'état complet ; sans changement : `{ unchanged: true, version }`. Les notes administratives et le journal ne sont renvoyés qu'au secrétariat (`peutSaisir`).",
  }, async (req, res) => { const { since, wait } = req.valid.query; res.json(wait ? await tenue.attendre(req.ctx, req.org.id, req.valid.params.id, since, wait * 1000) : await tenue.etat(req.ctx, req.org.id, req.valid.params.id)); });

  r.post('/ouverture', { summary: 'Ouvre le suivi de séance (la séance passe à « tenue »)', tags: T, org: true, roles: ADMIN, params: PS },
    async (req, res) => res.json(await tenue.ouvrir(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/cloture', { summary: 'Clôt la séance (refusé tant qu\'un point est en cours)', tags: T, org: true, roles: ADMIN, params: PS },
    async (req, res) => res.json(await tenue.cloturer(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/deverrouillage', { summary: 'Déverrouille une séance close (administrateur, motif obligatoire)', tags: T, org: true, roles: ['org_admin'], params: PS, body: Motif },
    async (req, res) => res.json(await tenue.deverrouiller(req.ctx, req.org.id, req.valid.params.id, req.valid.body.motif)));

  r.put('/notes', { summary: 'Notes administratives de la séance', tags: T, org: true, roles: ADMIN, params: PS, body: Notes },
    async (req, res) => res.json(await tenue.setNotes(req.ctx, req.org.id, req.valid.params.id, req.valid.body.notes)));
  r.put('/bureau', { summary: 'Président et secrétaire de séance (parmi les membres)', tags: T, org: true, roles: ADMIN, params: PS, body: Bureau },
    async (req, res) => res.json(await tenue.setBureau(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.put('/presences', { summary: 'Présence d\'un ou plusieurs élus : en salle, sorti, absent, excusé (chaque changement est horodaté)', tags: T, org: true, roles: ADMIN, params: PS, body: Presences,
    description: "Sert aussi à saisir les arrivées, sorties et retours en cours de séance, et à traiter tout un groupe d'un coup. « sorti » n'a de sens que pour un élu présent." },
  async (req, res) => res.json(await tenue.setPresences(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.put('/procurations', { summary: 'Pouvoir : le mandant donne pouvoir au mandataire', tags: T, org: true, roles: ADMIN, params: PS, body: Procuration,
    description: 'Un seul pouvoir par mandataire ; un mandataire ne peut pas être mandant. Le pouvoir n\'est effectif que si le mandant n\'est pas en salle et que le mandataire l\'est.' },
  async (req, res) => res.json(await tenue.setProcuration(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/procurations/:eluId', { summary: 'Retire le pouvoir donné par ce mandant', tags: T, org: true, roles: ADMIN, params: PM },
    async (req, res) => res.json(await tenue.removeProcuration(req.ctx, req.org.id, req.valid.params.id, req.valid.params.eluId)));

  r.put('/courant', { summary: 'Point en cours : le choisir ou passer au suivant / précédent (affiché pour tous les suiveurs)', tags: T, org: true, roles: ADMIN, params: PS, body: Courant },
    async (req, res) => res.json(await tenue.setCourant(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.put('/points/:itemId/notes', { summary: 'Notes administratives d\'un point', tags: T, org: true, roles: ADMIN, params: PI, body: Notes },
    async (req, res) => res.json(await tenue.setPointNotes(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId, req.valid.body.notes)));
  r.put('/points/:itemId/scrutin', { summary: 'Mode de scrutin d\'un point', tags: T, org: true, roles: ADMIN, params: PI, body: Scrutin },
    async (req, res) => res.json(await tenue.setScrutin(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId, req.valid.body.scrutin)));
  r.put('/points/:itemId/votes', { summary: 'Votes : par élu, ou pour tout un groupe d\'un coup (`choix: null` efface)', tags: T, org: true, roles: ADMIN, params: PI, body: Votes,
    description: "Seuls votent les élus en salle et les mandants dont le mandataire est en salle ; les autres (absents, excusés, sortis) ne prennent pas part au vote, ni pour eux ni pour leur mandant : leur ligne est ignorée." },
  async (req, res) => res.json(await tenue.setVotes(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId, req.valid.body.votes)));
  r.post('/points/:itemId/cloture', { summary: 'Clôt un point : vote (résultat calculé, statut de l\'acte mis à jour), sans vote, retiré ou ajourné', tags: T, org: true, roles: ADMIN, params: PI, body: Cloture,
    description: "409 tant qu'un élu qui doit voter n'a pas de choix, ou en cas de partage des voix sans vote du président de séance (sa voix est prépondérante)." },
  async (req, res) => res.json(await tenue.cloturerPoint(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId, req.valid.body)));
  r.post('/points/:itemId/reouverture', { summary: 'Rouvre un point clos pour le corriger (motif obligatoire)', tags: T, org: true, roles: ADMIN, params: PI, body: Motif },
    async (req, res) => res.json(await tenue.rouvrirPoint(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId, req.valid.body.motif)));

  return [r];
};
