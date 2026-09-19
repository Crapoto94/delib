const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PA = P.extend({ id: Id });
const Validation = z.object({ comment: z.string().trim().max(2000).optional() });
const Refus = z.object({
  target: z.string().trim().min(1).max(60).default('previous').describe("« previous » (étape précédente réellement traversée), « first » (rédacteur) ou la clé d'une étape antérieure"),
  resume: z.enum(['direct', 'complet']).optional().describe('Reprise après correction : `direct` = retour à l\'étape qui refuse, `complet` = tout le circuit ; choisie par le refuseur'),
  motif: z.string().trim().min(3).max(2000),
});
const Lot = z.object({ ids: z.array(Id).min(1).max(100), comment: z.string().trim().max(2000).optional() });
const Reassign = z.object({ holders: z.array(z.string().trim().min(1).max(128)).min(1).max(50), motif: z.string().trim().min(3).max(1000) });
const Adhoc = z.object({
  afterKey: z.string().min(1).max(40), label: z.string().trim().min(2).max(120), motif: z.string().trim().min(3).max(1000),
  resolver: z.object({ kind: z.enum(['groupe', 'agent', 'titulaire']), code: z.string().optional(), username: z.string().optional(), fonction: z.string().optional() }),
  canEdit: z.boolean().optional(), slaDays: z.number().min(0).max(365).optional(),
});

/** Actions du circuit sur un acte et files de travail. */
module.exports = ({ makeRouter, engine }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/actes/:id/circuit', {
    summary: "Circuit d'un acte : parcours, état de chaque étape, mes actions possibles, historique", tags: ['circuit'], org: true, params: PA,
    description: "Chaque personne du circuit voit tout le parcours dès l'envoi, y compris avant son tour (VIS-01). `actions` indique ce que JE peux faire ; `refuseTargets` liste les étapes antérieures possibles.",
  }, async (req, res) => res.json(await engine.view(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/actes/:id/envoi', {
    summary: 'Envoie l\'acte au circuit (ou le renvoie après modification)', tags: ['circuit'], org: true, params: PA,
    description: "Contrôle de complétude (422 avec la liste de ce qui manque), blocage après la date limite de rédaction (NOT-04), choix du circuit publié, démarrage du suivi des modifications. Un acte renvoyé au rédacteur est renvoyé par cet appel ; avec la reprise « directe » il retourne à l'étape qui avait refusé.",
  }, async (req, res) => res.json(await engine.submit(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/actes/:id/validation', { summary: "Valide l'étape courante (titulaire ou délégué)", tags: ['circuit'], org: true, params: PA, body: Validation },
    async (req, res) => res.json(await engine.validate(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/actes/:id/refus', {
    summary: 'Demande une modification : renvoie l\'acte à une étape antérieure', tags: ['circuit'], org: true, params: PA, body: Refus,
    description: "Motif obligatoire (déposé dans la discussion). Cible libre parmi les étapes antérieures réellement traversées. La reprise (directe ou complète) est choisie par le refuseur.",
  }, async (req, res) => res.json(await engine.refuse(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/actes/:id/reaffectation', { summary: "Réaffecte les détenteurs de l'étape courante (départ, absence)", tags: ['circuit'], org: true, params: PA, body: Reassign },
    async (req, res) => res.json(await engine.reassign(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/actes/:id/circuit/etape', {
    summary: 'Ajoute une étape ponctuelle à ce seul acte', tags: ['circuit'], org: true, params: PA, body: Adhoc,
    description: 'Ex. avis juridique complémentaire (CIR-68). Administrateur, SCC ou DGS ; motif tracé ; le circuit publié n\'est pas modifié.',
  }, async (req, res) => res.json(await engine.addAdhocStep(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/actes/:id/circuit/recalcul', { summary: 'Recalcule la suite du parcours', tags: ['circuit'], org: true, roles: ['org_admin', 'scc'], params: PA },
    async (req, res) => res.json(await engine.recompute(req.valid.params.id, req.ctx)));

  r.get('/circuit/a-traiter', {
    summary: 'Ma file de travail', tags: ['circuit'], org: true, params: P,
    description: "Actes en attente de MA validation (titulaire ou délégué) et actes renvoyés à mon attention, avec l'échéance et le retard.",
  }, async (req, res) => res.json({ items: await engine.todo(req.ctx, req.org.id) }));

  r.get('/circuit/en-retard', { summary: 'Actes dont l\'étape courante a dépassé son délai (dans mon périmètre)', tags: ['circuit'], org: true, params: P },
    async (req, res) => res.json({ items: await engine.lateActes(req.ctx, req.org.id) }));

  r.post('/circuit/lot/validation', {
    summary: 'Valide plusieurs actes d\'un coup', tags: ['circuit'], org: true, params: P, body: Lot,
    description: "Chaque acte est traité séparément : un échec n'arrête pas les autres (CIR-50). Le refus reste unitaire.",
  }, async (req, res) => res.json(await engine.validateBatch(req.ctx, req.org.id, req.valid.body.ids, req.valid.body.comment)));

  return [r];
};
