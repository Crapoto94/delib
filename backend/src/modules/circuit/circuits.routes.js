const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PC = P.extend({ id: Id });
const PV = PC.extend({ n: Id });
const ROLES = ['org_admin', 'scc']; // D26 : le circuit est modifiable par l'administrateur d'organisme et par le SCC

const Graph = z.object({
  start: z.string().min(1).max(40),
  steps: z.array(z.record(z.string(), z.any())).max(60).describe('Étapes : { key, label, resolver:{kind,…}, mode, canEdit, optional, nonDelegable, slaDays, refusTo (étape de refus : par défaut l’étape précédente), onEnter, onDone }'),
  transitions: z.array(z.record(z.string(), z.any())).max(300).describe('Transitions : { from, to, when?, otherwise? }'),
});
const Create = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,40}$/), nom: z.string().trim().min(2).max(200),
  typeActeId: Id.optional(), directionCode: z.string().trim().max(40).optional(),
  fromTemplate: z.string().max(40).optional(), graph: Graph.optional(),
});
const Import = z.object({ format: z.enum(['vibedelib.circuit/1', 'ivrydelib.circuit/1']), code: z.string().regex(/^[a-z0-9_-]{2,40}$/), nom: z.string().trim().min(2).max(200), graph: Graph });
const Draft = z.object({ fromVersion: z.number().int().positive().optional(), comment: z.string().max(300).optional() });
const Simulation = z.object({
  typeActeId: Id.optional(), directionCode: z.string().trim().min(1).max(40), serviceCode: z.string().trim().max(40).optional(), redacteur: z.string().max(128).optional(),
  facts: z.object({ incidenceFinanciere: z.boolean().nullable(), montant: z.number().nullable(), urgence: z.boolean(), hasCommission: z.boolean() }).partial().optional(),
});
const Publish = z.object({
  comment: z.string().max(300).optional(),
  effect: z.enum(['nouveaux-seulement', 'migrer']).default('nouveaux-seulement'),
  mapping: z.record(z.string(), z.string()).optional().describe('Correspondance ancienne étape → nouvelle étape pour les actes en cours (effet « migrer »)'),
});
const Update = z.object({ nom: z.string().trim().min(2).max(200).optional(), typeActeId: Id.nullable().optional(), directionCode: z.string().trim().max(40).nullable().optional() });
const Dup = z.object({ code: z.string().regex(/^[a-z0-9_-]{2,40}$/), nom: z.string().trim().min(2).max(200) });
const Cmp = z.object({ a: Id, b: Id });
const ExportQ = z.object({ version: Id.optional() });

module.exports = ({ makeRouter, circuits }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/circuits');
  const spec = (s) => ({ org: true, roles: ROLES, params: PC, tags: ['éditeur de circuit'], ...s });

  r.get('/', { summary: "Circuits de l'organisme (avec versions)", tags: ['éditeur de circuit'], org: true, params: P },
    async (req, res) => res.json({ items: await circuits.list(req.org.id) }));
  r.get('/modeles', { summary: 'Modèles de circuit prêts à l\'emploi', tags: ['éditeur de circuit'], org: true, params: P },
    async (req, res) => res.json({ items: circuits.templates() }));

  r.post('/', {
    summary: 'Crée un circuit (brouillon v1) à partir d\'un modèle, d\'un graphe ou vide', tags: ['éditeur de circuit'], org: true, roles: ROLES, params: P, body: Create, responses: { 201: 'Créé' },
    description: "Un circuit peut être propre à un type d'acte et/ou à une direction ; le plus spécifique s'applique (CIR-65). Les groupes du modèle (financier, juridique, SCC) sont créés au besoin.",
  }, async (req, res) => res.status(201).json(await circuits.create(req.ctx, req.org.id, req.valid.body)));

  r.post('/import', { summary: 'Importe un circuit exporté (JSON)', tags: ['éditeur de circuit'], org: true, roles: ROLES, params: P, body: Import, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await circuits.create(req.ctx, req.org.id, { code: req.valid.body.code, nom: req.valid.body.nom, graph: req.valid.body.graph })));

  r.get('/:id', { summary: "Circuit et liste de ses versions", tags: ['éditeur de circuit'], org: true, params: PC },
    async (req, res) => res.json(await circuits.get(req.org.id, req.valid.params.id)));

  r.put('/:id', { summary: "Modifie les propriétés d'un circuit (nom, type d'acte, direction)", tags: ['éditeur de circuit'], org: true, roles: ROLES, params: PC, body: Update },
    async (req, res) => res.json(await circuits.update(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.delete('/:id', { summary: 'Supprime un circuit', tags: ['éditeur de circuit'], org: true, roles: ROLES, params: PC, responses: { 204: 'Supprimé' },
    description: "409 tant qu'un dossier a suivi ou suit ce circuit (l'historique d'un acte référence toujours sa version), ou s'il est le seul circuit publié." },
  async (req, res) => { await circuits.remove(req.ctx, req.org.id, req.valid.params.id); res.status(204).end(); });

  r.post('/:id/duplication', { summary: 'Duplique un circuit sous un nouveau code (brouillon v1)', tags: ['éditeur de circuit'], org: true, roles: ROLES, params: PC, body: Dup, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await circuits.duplicate(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.delete('/:id/versions/:n', { summary: 'Supprime un brouillon', tags: ['éditeur de circuit'], org: true, roles: ROLES, params: PV, responses: { 204: 'Supprimé' } },
    async (req, res) => { await circuits.deleteDraft(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n); res.status(204).end(); });

  r.get('/:id/export', { summary: 'Exporte un circuit en JSON (version publiée par défaut)', tags: ['éditeur de circuit'], org: true, roles: ROLES, params: PC, query: ExportQ },
    async (req, res) => res.json(await circuits.export(req.org.id, req.valid.params.id, req.valid.query.version)));

  r.get('/:id/comparaison', { summary: 'Compare deux versions', tags: ['éditeur de circuit'], org: true, params: PC, query: Cmp },
    async (req, res) => res.json(await circuits.diff(req.org.id, req.valid.params.id, req.valid.query.a, req.valid.query.b)));

  r.post('/:id/versions', { ...spec({ summary: 'Crée un nouveau brouillon (copie d\'une version : modification ou retour arrière)', body: Draft, responses: { 201: 'Créé' } }) },
    async (req, res) => res.status(201).json(await circuits.newDraft(req.ctx, req.org.id, req.valid.params.id, req.valid.body.fromVersion, req.valid.body.comment)));

  r.get('/:id/versions/:n', { summary: "Graphe d'une version", tags: ['éditeur de circuit'], org: true, params: PV },
    async (req, res) => res.json(await circuits.getVersion(req.org.id, req.valid.params.id, req.valid.params.n)));

  r.put('/:id/versions/:n', { ...spec({ summary: 'Modifie le graphe d\'un brouillon (étapes, transitions, conditions, règles)', params: PV, body: Graph }) },
    async (req, res) => res.json(await circuits.updateDraft(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n, req.valid.body)));

  r.post('/:id/versions/:n/controle', { ...spec({ summary: 'Contrôles de cohérence (CIR-61)', params: PV }),
    description: "Une seule étape initiale, étapes atteignables, pas d'impasse ni de boucle, sortie par défaut, résolveurs et conditions valides, groupes connus." },
  async (req, res) => res.json(await circuits.validate(req.org.id, req.valid.params.id, req.valid.params.n)));

  r.post('/:id/versions/:n/simulation', { ...spec({ summary: 'Simule le parcours pour un cas (qui serait désigné à chaque étape ?)', params: PV, body: Simulation }),
    description: 'CIR-62 : déroule le circuit avec les titulaires et groupes réels de l\'organisme, avant publication.' },
  async (req, res) => res.json(await circuits.simulate(req.org.id, req.valid.params.id, req.valid.params.n, req.valid.body)));

  r.post('/:id/versions/:n/publication', { ...spec({ summary: 'Publie une version', params: PV, body: Publish }),
    description: "Refusée s'il y a des erreurs. `effect` : `nouveaux-seulement` (défaut, les actes en cours gardent leur version) ou `migrer` (les actes en cours passent à la nouvelle version, avec `mapping` pour les étapes supprimées)." },
  async (req, res) => res.json(await circuits.publish(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n, req.valid.body)));

  return [r];
};
