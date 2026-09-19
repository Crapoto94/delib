const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id, id: Id });
const PS = P.extend({ sid: Id });
const Contexte = z.string().trim().min(10).max(3000).describe("Nouveau contexte : objet, bénéficiaire, montants, dates, ce qui change par rapport à l'ancien dossier");
const Copie = z.object({ adapter: z.boolean().default(false).describe("Demander à l'IA de proposer les adaptations"), contexte: Contexte.optional() })
  .refine((d) => !d.adapter || !!d.contexte, { message: 'Le contexte est obligatoire pour une copie assistée par IA', path: ['contexte'] });
const Adapt = z.object({ contexte: Contexte });
const ListQ = z.object({ statut: z.enum(['pending', 'accepted', 'edited', 'rejected', 'obsolete']).optional() });
const Decision = z.object({ decision: z.enum(['accept', 'reject']), replacement: z.string().max(5000).optional().describe('Remplacement édité par l\'agent (facultatif)') });
const T = ['assistant IA'];

module.exports = ({ makeRouter, ai }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/actes/:id');

  r.post('/copie', {
    summary: 'Copie ce dossier en nouveau brouillon, avec adaptation proposée par l\'IA (facultative)', tags: T, org: true, params: P, body: Copie, responses: { 201: 'Créé' },
    description: "Copie simple (fiche, textes) ; avec `adapter: true`, l'IA PROPOSE des remplacements et des alertes selon le `contexte`. Rien n'est appliqué sans décision explicite de l'agent (D21). Si l'IA est indisponible, la copie simple est quand même créée (`iaError`).",
  }, async (req, res) => res.status(201).json(await ai.copy(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/ia/adaptation', { summary: "Demande (ou redemande) les propositions d'adaptation pour ce brouillon", tags: T, org: true, params: P, body: Adapt,
    description: 'Les propositions en attente sont remplacées ; les décisions déjà prises sont conservées.' },
  async (req, res) => res.json(await ai.suggest(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/ia/propositions', { summary: 'Propositions et alertes de l\'IA pour ce dossier', tags: T, org: true, params: P, query: ListQ },
    async (req, res) => res.json({ items: await ai.list(req.ctx, req.org.id, req.valid.params.id, req.valid.query) }));

  r.post('/ia/propositions/:sid/decision', { summary: 'Accepte (avec ou sans édition) ou refuse une proposition', tags: T, org: true, params: PS, body: Decision,
    description: "Accepter applique le remplacement dans le texte (nouvelle version, suivi des modifications si le dossier est en circuit). Une alerte ne peut qu'être écartée. Il n'existe volontairement pas de « tout accepter »." },
  async (req, res) => res.json(await ai.decide(req.ctx, req.org.id, req.valid.params.id, req.valid.params.sid, req.valid.body)));

  return [r];
};
