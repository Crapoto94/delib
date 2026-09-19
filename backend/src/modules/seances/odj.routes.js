const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PS = P.extend({ id: Id });
const PI = PS.extend({ itemId: Id });
const PA = PS.extend({ acteId: Id });
const Motif = z.string().trim().min(3).max(500);
const T = ['ordre du jour'];

const Pending = z.object({ visee: z.enum(['cette', 'aucune', 'toutes']).default('toutes'), rubriqueId: Id.optional(), rapporteurId: Id.optional(), q: z.string().max(100).optional() });
const Affecter = z.object({ acteIds: z.array(Id).min(1).max(100), motif: Motif.optional() });
const Retrait = z.object({ motif: Motif.optional() });
const Point = z.object({ kind: z.enum(['libre', 'chapitre']).default('libre'), titre: z.string().trim().min(2).max(300), numerote: z.boolean().default(false), afterItemId: Id.optional(), motif: Motif.optional() });
const PointPatch = z.object({ titre: z.string().trim().min(2).max(300).optional(), numerote: z.boolean().optional(), motif: Motif.optional() });
const Ordre = z.object({ ids: z.array(Id).max(1000), motif: Motif.optional() });
const TriQ = z.object({ critere: z.enum(['rubrique', 'rapporteur', 'numero', 'alpha']) });
const Arret = z.object({ forcer: z.boolean().default(false) });
const Verrou = z.object({ force: z.boolean().default(false) });
const Pattern = z.object({ pattern: z.string().min(3).max(80).describe('Variables : {ANNEE} {N_SEANCE} {ORDRE} {ORDRE:03} {RUBRIQUE}') });
const Apercu = Pattern.extend({ seanceId: Id.optional() });

module.exports = ({ makeRouter, odj }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');
  const ADMIN = ['org_admin', 'scc'];

  r.get('/seances/:id/odj', { summary: "Ordre du jour d'une séance (numéros provisoires ou figés)", tags: T, org: true, params: PS,
    description: "Lignes classées : délibérations (une par délibération), points libres, chapitres. Avant l'arrêt les numéros sont provisoires et suivent le classement." },
  async (req, res) => res.json(await odj.get(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/seances/:id/odj/en-attente', { summary: "Actes en attente d'affectation (circuit terminé)", tags: T, org: true, roles: ADMIN, params: PS, query: Pending },
    async (req, res) => res.json({ items: await odj.pending(req.org.id, req.valid.params.id, req.valid.query) }));

  r.post('/seances/:id/odj/affectations', { summary: 'Affecte des actes à l\'ordre du jour', tags: T, org: true, params: PS, body: Affecter,
    description: "Crée une ligne par délibération de l'acte (l'exposé n'est imprimé qu'une fois par dossier). Après l'arrêt : motif obligatoire, l'ajout reçoit le numéro suivant (ou « bis », paramètre `odj.ajout_apres_arret`)." },
  async (req, res) => res.json(await odj.affecter(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.delete('/seances/:id/odj/actes/:acteId', { summary: "Retire un acte de l'ordre du jour", tags: T, org: true, params: PA, query: Retrait,
    description: "Avant l'arrêt : la ligne disparaît. Après : elle reste, marquée « retirée », son numéro n'est jamais réutilisé." },
  async (req, res) => res.json(await odj.retirerActe(req.ctx, req.org.id, req.valid.params.id, req.valid.params.acteId, req.valid.query)));

  r.post('/seances/:id/odj/points', { summary: 'Ajoute un point libre ou un chapitre', tags: T, org: true, params: PS, body: Point, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await odj.addPoint(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.put('/seances/:id/odj/points/:itemId', { summary: 'Modifie un point libre ou un chapitre', tags: T, org: true, params: PI, body: PointPatch },
    async (req, res) => res.json(await odj.updatePoint(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId, req.valid.body)));
  r.delete('/seances/:id/odj/points/:itemId', { summary: 'Supprime un point libre ou un chapitre', tags: T, org: true, params: PI, query: Retrait },
    async (req, res) => res.json(await odj.removePoint(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId, req.valid.query)));

  r.put('/seances/:id/odj/ordre', { summary: 'Enregistre le classement (résultat du glisser-déposer)', tags: T, org: true, params: PS, body: Ordre,
    description: "`ids` : toutes les lignes actives dans le nouvel ordre. Déplacer un groupe ou plusieurs lignes = envoyer le nouveau tableau. Enregistrement automatique côté client ; historisé." },
  async (req, res) => res.json(await odj.reorder(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.get('/seances/:id/odj/tri', { summary: 'Aide de tri : ordre proposé (rien n\'est enregistré)', tags: T, org: true, roles: ADMIN, params: PS, query: TriQ },
    async (req, res) => res.json(await odj.propose(req.ctx, req.org.id, req.valid.params.id, req.valid.query.critere)));

  r.get('/seances/:id/odj/controles', { summary: "Contrôles avant l'arrêt", tags: T, org: true, roles: ADMIN, params: PS }, async (req, res) => res.json(await odj.controles(req.org.id, req.valid.params.id)));
  r.post('/seances/:id/odj/arret', { summary: "Arrête l'ordre du jour (numéros figés)", tags: T, org: true, roles: ADMIN, params: PS, body: Arret,
    description: "422 avec la liste des anomalies, sauf `forcer`. Les notifications de classement partent UNE fois." },
  async (req, res) => res.json(await odj.arreter(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/seances/:id/odj/verrou', { summary: "Prend le verrou d'édition (10 min)", tags: T, org: true, params: PS, body: Verrou },
    async (req, res) => res.json(await odj.takeLock(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/seances/:id/odj/verrou', { summary: 'Libère le verrou', tags: T, org: true, params: PS }, async (req, res) => res.json(await odj.releaseLock(req.ctx, req.org.id, req.valid.params.id)));
  r.get('/seances/:id/odj/historique', { summary: 'Historique complet des modifications (qui, quand, avant/après)', tags: T, org: true, roles: ADMIN, params: PS },
    async (req, res) => res.json({ items: await odj.history(req.ctx, req.org.id, req.valid.params.id) }));

  r.get('/seances/:id/odj/export.csv', { summary: 'Tableau de suivi des délibérations numérotées (CSV)', tags: T, org: true, roles: ADMIN, params: PS },
    async (req, res) => { res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="odj-${req.valid.params.id}.csv"` }); res.send(await odj.exportCsv(req.ctx, req.org.id, req.valid.params.id)); });

  r.post('/numerotation/apercu', { summary: 'Aperçu en direct d\'un format de numérotation', tags: T, org: true, roles: ADMIN, params: P, body: Apercu },
    async (req, res) => res.json(await odj.previewNumbering(req.org.id, req.valid.body)));
  r.put('/seances/:id/odj/motif', { summary: 'Change le format de numérotation de cette séance (avant l\'arrêt)', tags: T, org: true, roles: ADMIN, params: PS, body: Pattern,
    description: 'Pour les séances futures ; les numéros déjà attribués ne bougent jamais.' },
  async (req, res) => res.json(await odj.setPattern(req.ctx, req.org.id, req.valid.params.id, req.valid.body.pattern)));

  return [r];
};
