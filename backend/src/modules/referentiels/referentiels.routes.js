const { z } = require('zod');
const { KINDS } = require('./referentiels.service');

const Kind = z.enum(KINDS);
const OrgKind = z.object({ orgId: z.coerce.number().int().positive(), kind: Kind });
const OrgKindId = OrgKind.extend({ id: z.coerce.number().int().positive() });
const Create = z.object({
  code: z.string().trim().min(1).max(40), libelle: z.string().trim().min(1).max(300),
  parentCode: z.string().max(40).optional(), ordre: z.number().int().optional(), meta: z.record(z.string(), z.unknown()).optional(),
});
const Update = z.object({ libelle: z.string().trim().min(1).max(300).optional(), ordre: z.number().int().optional(), actif: z.boolean().optional(), meta: z.record(z.string(), z.unknown()).optional() });
const Override = z.object({ actif: z.boolean().optional(), libelle: z.string().trim().min(1).max(300).optional() });
const Import = z.object({ text: z.string().min(3).max(500000).describe('Contenu du fichier matieres.txt') });
const ListQuery = z.object({ includeInactive: z.enum(['true', 'false']).default('false') });

/** Référentiels : jeu commun (plateforme) + valeurs propres et surcharges par organisme. */
module.exports = ({ makeRouter, refs }) => {
  const r = makeRouter('/api/v1/organismes');

  r.get('/:orgId/referentiels/matiere/tree', { summary: 'Arbre des matières (feuilles sélectionnables)', tags: ['référentiels'], org: true, params: z.object({ orgId: z.coerce.number() }) },
    async (req, res) => res.json({ items: await refs.matiereTree(req.org.id) }));

  r.get('/:orgId/referentiels/:kind', {
    summary: "Valeurs d'un référentiel, héritage et surcharges appliqués", tags: ['référentiels'], org: true, params: OrgKind, query: ListQuery,
    description: 'kind : type_acte, nature, rubrique, matiere, annexe_type. Les valeurs inactives ne sont listées que sur demande.',
  }, async (req, res) => res.json({ items: await refs.list(req.valid.params.kind, req.org.id, { includeInactive: req.valid.query.includeInactive === 'true' }) }));

  r.post('/:orgId/referentiels/matiere/import', {
    summary: 'Importe la nomenclature des matières pour cet organisme', tags: ['référentiels'], org: true, roles: ['org_admin'], params: z.object({ orgId: z.coerce.number() }), body: Import,
    description: 'Idempotent. Tri numérique, corrections signalées (MAT-06).',
  }, async (req, res) => res.json(await refs.importMatieres(req.ctx, req.valid.body.text, req.org.id)));

  r.post('/:orgId/referentiels/:kind', { summary: 'Ajoute une valeur propre à l\'organisme', tags: ['référentiels'], org: true, roles: ['org_admin'], params: OrgKind, body: Create, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await refs.create(req.ctx, { kind: req.valid.params.kind, organismeId: req.org.id, ...req.valid.body })));

  r.put('/:orgId/referentiels/:kind/:id', { summary: 'Modifie une valeur propre à l\'organisme', tags: ['référentiels'], org: true, roles: ['org_admin'], params: OrgKindId, body: Update },
    async (req, res) => res.json(await refs.update(req.ctx, req.valid.params.id, req.org.id, req.valid.body)));

  r.put('/:orgId/referentiels/:kind/:id/override', {
    summary: 'Masque ou renomme une valeur commune pour cet organisme', tags: ['référentiels'], org: true, roles: ['org_admin'], params: OrgKindId, body: Override,
  }, async (req, res) => res.json(await refs.setOverride(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  const p = makeRouter('/api/v1/platform/referentiels');
  p.post('/matiere/import', { summary: 'Importe la nomenclature commune des matières', tags: ['plateforme'], platform: true, body: Import },
    async (req, res) => res.json(await refs.importMatieres(req.ctx, req.valid.body.text, null)));
  p.post('/:kind', { summary: 'Ajoute une valeur commune', tags: ['plateforme'], platform: true, params: z.object({ kind: Kind }), body: Create, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await refs.create(req.ctx, { kind: req.valid.params.kind, organismeId: null, ...req.valid.body })));
  p.put('/:kind/:id', { summary: 'Modifie une valeur commune', tags: ['plateforme'], platform: true, params: z.object({ kind: Kind, id: z.coerce.number().int().positive() }), body: Update },
    async (req, res) => res.json(await refs.update(req.ctx, req.valid.params.id, null, req.valid.body)));

  return [r, p];
};
