const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id, id: Id });
const PS = P.extend({ sid: Id });
const Contexte = z.string().trim().min(10).max(3000).describe("Nouveau contexte : objet, bénéficiaire, montants, dates, ce qui change par rapport à l'ancien dossier");
const Copie = z.object({ adapter: z.boolean().default(false).describe("Demander à l'IA de proposer les adaptations"), contexte: Contexte.optional() })
  .refine((d) => !d.adapter || !!d.contexte, { message: 'Le contexte est obligatoire pour une copie assistée par IA', path: ['contexte'] });
const Adapt = z.object({ contexte: Contexte });
const Analyse = z.object({ type: z.enum(['orthographe', 'style', 'visas', 'complet']), textId: Id.optional().describe('Texte à analyser (par défaut : tous les textes du dossier)') });
const AllSpelling = z.object({ textId: Id });
const ListQ = z.object({ statut: z.enum(['pending', 'accepted', 'edited', 'rejected', 'obsolete']).optional(), textId: Id.optional() });
const Decision = z.object({ decision: z.enum(['accept', 'reject']), replacement: z.string().max(5000).optional().describe('Remplacement édité par l\'agent (facultatif)') });
const T = ['assistant IA'];

const JP = z.object({ orgId: Id, jid: Id });
const OrgP = z.object({ orgId: Id });
const JobsQ = z.object({ scope: z.enum(['mine', 'all']).default('mine'), acteId: Id.optional() });

const PromptP = OrgP.extend({ code: z.enum(['orthographe', 'style', 'visas', 'copie']) });
const PromptB = z.object({
  texte: z.string().max(6000).nullable().optional().describe('Consigne (rôle et mission) ; null : revenir à la consigne par défaut'),
  modele: z.string().trim().max(120).nullable().optional().describe('Modèle de l\'IA pour cette fonction ; null : modèle par défaut'),
}).refine((d) => d.texte !== undefined || d.modele !== undefined, { message: 'Rien à modifier' });

module.exports = ({ makeRouter, ai, aiQueue, aiPrompts }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/actes/:id');

  r.post('/copie', {
    summary: 'Copie ce dossier en nouveau brouillon, avec adaptation proposée par l\'IA (facultative)', tags: T, org: true, params: P, body: Copie, responses: { 201: 'Créé' },
    description: "Copie simple (fiche, textes) ; avec `adapter: true`, l'IA PROPOSE des remplacements et des alertes selon le `contexte`. Rien n'est appliqué sans décision explicite de l'agent (D21). L'interrogation de l'IA se fait EN ARRIÈRE PLAN : la réponse renvoie la copie et une tâche (`job`) dont on suit l'avancement ; si la file est pleine ou l'IA indisponible, la copie simple est quand même créée (`iaError`).",
  }, async (req, res) => res.status(201).json(await ai.copy(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));


  r.post('/ia/adaptation', { summary: "Demande (ou redemande) les propositions d'adaptation pour ce brouillon — en arrière plan", tags: T, org: true, params: P, body: Adapt, responses: { 202: 'Tâche déposée dans la file' },
    description: 'Renvoie 202 et la tâche ; les propositions en attente seront remplacées à la fin de la tâche, les décisions déjà prises sont conservées. 429 si la file ou votre quota est plein.' },
  async (req, res) => res.status(202).json(await ai.requestAdaptation(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/ia/analyse', { summary: "Demande une analyse de l'éditeur : orthographe, style, visas et considérants, ou contrôle complet — en arrière plan", tags: T, org: true, params: P, body: Analyse, responses: { 202: 'Tâche déposée dans la file' },
    description: "Le rédacteur (ou celui qui a la main sur l'étape) obtient des cartes de suggestions (catégorie, extrait, proposition, raison) ; rien n'est appliqué sans action explicite (IA-01, IA-09). Les références juridiques sont toujours renvoyées « à vérifier » (IA-05). 429 si la file ou votre quota est plein." },
  async (req, res) => res.status(202).json(await ai.requestAnalyse(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/ia/propositions/accepter-orthographe', { summary: "« Tout accepter (orthographe seule) » sur un texte", tags: T, org: true, params: P, body: AllSpelling,
    description: "Applique une à une, comme modifications attribuées à l'utilisateur, les corrections d'orthographe et de typographie encore en attente. Les autres catégories (style, visas, cohérence) ne sont jamais acceptées en bloc (IA-13)." },
  async (req, res) => res.json(await ai.acceptAllSpelling(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/ia/propositions', { summary: 'Propositions et alertes de l\'IA pour ce dossier', tags: T, org: true, params: P, query: ListQ },
    async (req, res) => res.json({ items: await ai.list(req.ctx, req.org.id, req.valid.params.id, req.valid.query) }));

  r.post('/ia/propositions/:sid/decision', { summary: 'Accepte (avec ou sans édition) ou refuse une proposition', tags: T, org: true, params: PS, body: Decision,
    description: "Accepter applique le remplacement dans le texte (nouvelle version, suivi des modifications si le dossier est en circuit). Une alerte ne peut qu'être écartée. Le seul « tout accepter » est celui de l'orthographe seule (route dédiée)." },
  async (req, res) => res.json(await ai.decide(req.ctx, req.org.id, req.valid.params.id, req.valid.params.sid, req.valid.body)));

  // ---- file d'attente
  const q = makeRouter('/api/v1/organismes/:orgId/ia');
  q.get('/taches', { summary: 'Mes tâches IA (en attente, en cours, récentes) — toutes pour l\'administrateur avec scope=all', tags: T, org: true, params: OrgP, query: JobsQ },
    async (req, res) => res.json({ items: await aiQueue.list(req.ctx, req.org.id, req.valid.query) }));
  q.get('/taches/:jid', { summary: "Avancement d'une tâche IA (statut, étape, position dans la file)", tags: T, org: true, params: JP },
    async (req, res) => res.json(await aiQueue.get(req.ctx, req.org.id, req.valid.params.jid)));
  q.delete('/taches/:jid', { summary: 'Annule une tâche IA (en attente : immédiat ; en cours : à la fin du texte en traitement)', tags: T, org: true, params: JP },
    async (req, res) => res.json(await aiQueue.cancel(req.ctx, req.org.id, req.valid.params.jid)));
  q.get('/file', { summary: "État de la file IA et limites en vigueur (administration)", tags: T, org: true, roles: ['org_admin'], params: OrgP,
    description: 'Paramètres (à régler dans les paramètres, par plateforme puis par organisme) : ai.max_concurrent, ai.max_par_utilisateur, ai.file_max, ai.file_max_par_utilisateur, ai.intervalle_ms, ai.timeout_s, ai.tentatives.' },
  async (req, res) => res.json(await aiQueue.overview(req.org.id)));

  q.get('/prompts', { summary: "Consignes envoyées à l'IA et modèle choisi pour chacune (administration)", tags: T, org: true, roles: ['org_admin'], params: OrgP,
    description: "Pour chaque fonction (orthographe, style, visas, copie assistée) : la consigne en vigueur et celle par défaut, le format de réponse imposé (non modifiable) et le modèle. `modeles` : liste fournie par l'IA interne (`null` si indisponible)." },
  async (req, res) => res.json(await aiPrompts.list(req.org.id)));
  q.put('/prompts/:code', { summary: "Modifie la consigne et/ou le modèle d'une fonction IA (`null` : valeur par défaut)", tags: T, org: true, roles: ['org_admin'], params: PromptP, body: PromptB,
    description: "Le format de réponse (JSON attendu, règles de sécurité) est toujours ajouté par le serveur : une consigne modifiée ne peut pas casser la lecture des propositions. Audité." },
  async (req, res) => res.json(await aiPrompts.set(req.ctx, req.org.id, req.valid.params.code, req.valid.body)));

  return [r, q];
};
