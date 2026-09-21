const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id, id: Id });
const PT = P.extend({ textId: Id });
const PV = PT.extend({ n: Id });
const ViewQ = z.object({ mode: z.enum(['suivi', 'propre', 'depuis']).default('suivi'), sinceAt: z.iso.datetime().optional() });
// 15 Mo : un texte peut embarquer des images (data-URL) insérées ou collées depuis Word.
const Commit = z.object({ markdown: z.string().max(15000000), baseVersion: z.number().int().min(1), reason: z.string().max(200).optional() });
const Draft = z.object({ markdown: z.string().max(15000000) });
const Cmp = z.object({ from: Id, to: Id });
const Resolve = z.object({ decision: z.enum(['accept', 'reject']), cids: z.array(z.string().max(40)).max(500).optional(), all: z.boolean().optional() })
  .refine((d) => d.all || (d.cids && d.cids.length), { message: 'cids ou all requis' });
const Seen = z.object({ version: z.number().int().min(1).optional() });

module.exports = ({ makeRouter, textes }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/actes/:id/textes');

  r.get('/', { summary: "Textes d'un acte (exposé, visas/considérants, dispositif)", tags: ['textes'], org: true, params: P },
    async (req, res) => res.json({ items: await textes.list(req.ctx, req.org.id, req.valid.params.id) }));

  r.get('/:textId', {
    summary: "Lit un texte : version propre, avec suivi, ou « depuis ma dernière lecture »", tags: ['textes'], org: true, params: PT, query: ViewQ,
    description: "`mode=suivi` : spans colorés par auteur (+ HTML échappé). `propre` : texte final. `depuis` : seules les modifications postérieures à la dernière lecture de l'utilisateur (ou à `sinceAt`) gardent leur couleur (TRK-07).",
  }, async (req, res) => res.json(await textes.view(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, req.valid.query)));

  r.put('/:textId', {
    summary: 'Enregistre le texte (calcule et fusionne le suivi des modifications)', tags: ['textes'], org: true, params: PT, body: Commit,
    description: "`baseVersion` = version lue ; 409 avec la version courante si le texte a changé entre-temps. Le suivi démarre à l'envoi au circuit ; avant, aucune coloration (TRK-03). Un instantané immuable est conservé à chaque enregistrement.",
  }, async (req, res) => res.json(await textes.commit(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, req.valid.body)));

  r.get('/:textId/brouillon', { summary: 'Mon brouillon privé', tags: ['textes'], org: true, params: PT },
    async (req, res) => res.json({ draft: await textes.getDraft(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId) }));
  r.put('/:textId/brouillon', { summary: 'Sauvegarde mon brouillon privé (auto-sauvegarde)', tags: ['textes'], org: true, params: PT, body: Draft },
    async (req, res) => res.json(await textes.saveDraft(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, req.valid.body.markdown)));
  r.delete('/:textId/brouillon', { summary: 'Supprime mon brouillon', tags: ['textes'], org: true, params: PT, responses: { 204: 'Supprimé' } },
    async (req, res) => { await textes.deleteDraft(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId); res.status(204).end(); });

  r.post('/:textId/verrou', { summary: "Prend le verrou souple d'édition (10 minutes)", tags: ['textes'], org: true, params: PT },
    async (req, res) => res.json(await textes.lock(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId)));
  r.delete('/:textId/verrou', { summary: 'Libère le verrou', tags: ['textes'], org: true, params: PT, responses: { 204: 'Libéré' } },
    async (req, res) => { await textes.unlock(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId); res.status(204).end(); });

  r.get('/:textId/versions', { summary: 'Historique des versions (instantanés)', tags: ['textes'], org: true, params: PT },
    async (req, res) => res.json({ items: await textes.versions(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId) }));
  r.get('/:textId/versions/:n', { summary: "Contenu d'une version", tags: ['textes'], org: true, params: PV },
    async (req, res) => res.json(await textes.version(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, req.valid.params.n)));
  r.get('/:textId/comparaison', { summary: 'Compare deux versions quelconques', tags: ['textes'], org: true, params: PT, query: Cmp },
    async (req, res) => res.json(await textes.compare(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, req.valid.query.from, req.valid.query.to)));

  r.post('/:textId/modifications', {
    summary: 'Accepte ou rejette des modifications (une par une, ou toutes)', tags: ['textes'], org: true, params: PT, body: Resolve,
    description: "Fonction paramétrable (D30). `all: true` = consolidation : toutes les modifications sont acceptées (version propre, TRK-10).",
  }, async (req, res) => res.json(await textes.resolve(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, req.valid.body)));

  r.post('/:textId/vu', { summary: 'Marque la version lue (base de la vue « depuis »)', tags: ['textes'], org: true, params: PT, body: Seen, responses: { 204: 'Enregistré' } },
    async (req, res) => { await textes.markSeen(req.ctx, req.org.id, req.valid.params.id, req.valid.params.textId, req.valid.body.version); res.status(204).end(); });

  return [r];
};
