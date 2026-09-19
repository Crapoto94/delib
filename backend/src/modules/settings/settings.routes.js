const { z } = require('zod');

const Key = z.string().regex(/^[a-z0-9_.]{1,100}$/, 'clé : minuscules, chiffres, . et _');
const OrgParams = z.object({ orgId: z.coerce.number().int().positive() });
const KeyParams = OrgParams.extend({ key: Key });
const PlatformKeyParams = z.object({ key: Key });
const Scope = z.enum(['organisme', 'instance', 'type_acte']);
const IdQ = z.coerce.number().int().positive().optional();

const ResolveQuery = z.object({ instanceId: IdQ, typeActeId: IdQ });
const PutBody = z.object({
  value: z.unknown().refine((v) => v !== undefined, 'value requis'),
  scope: Scope.default('organisme'),
  subId: IdQ.describe("Identifiant de l'instance ou du type d'acte (portées instance et type_acte)"),
});
const DeleteQuery = z.object({ scope: Scope.default('organisme'), subId: IdQ });
const PlatformPut = z.object({ value: z.unknown().refine((v) => v !== undefined, 'value requis') });

/** Paramètres hiérarchiques : plateforme -> organisme -> instance -> type d'acte. La valeur la plus spécifique l'emporte. */
module.exports = ({ makeRouter, settings }) => {
  const r = makeRouter('/api/v1/organismes');

  r.get('/:orgId/settings', {
    summary: "Paramètres résolus d'un organisme, avec l'origine de chaque valeur", tags: ['paramètres'], org: true, params: OrgParams, query: ResolveQuery,
    description: 'Chaque clé porte sa valeur et son origine (`platform`, `organisme`, `instance`, `type_acte`). Passer `instanceId` et/ou `typeActeId` pour résoudre jusqu\'à ce niveau.',
  }, async (req, res) => res.json({ settings: await settings.resolve(req.org.id, req.valid.query) }));

  r.put('/:orgId/settings/:key', {
    summary: 'Définit un paramètre à un niveau', tags: ['paramètres'], org: true, roles: ['org_admin'], params: KeyParams, body: PutBody,
  }, async (req, res) => res.json(await settings.put(req.ctx, { scope: req.valid.body.scope, organismeId: req.org.id, subId: req.valid.body.subId, key: req.valid.params.key, val: req.valid.body.value })));

  r.delete('/:orgId/settings/:key', {
    summary: 'Supprime un paramètre à un niveau (retour à la valeur héritée)', tags: ['paramètres'], org: true, roles: ['org_admin'], params: KeyParams, query: DeleteQuery, responses: { 204: 'Supprimé' },
  }, async (req, res) => {
    await settings.remove(req.ctx, { scope: req.valid.query.scope, organismeId: req.org.id, subId: req.valid.query.subId, key: req.valid.params.key });
    res.status(204).end();
  });

  const p = makeRouter('/api/v1/platform/settings');
  p.get('/', { summary: 'Paramètres de plateforme', tags: ['plateforme'], platform: true },
    async (req, res) => res.json({ settings: await settings.listPlatform() }));
  p.put('/:key', { summary: 'Définit un paramètre de plateforme', tags: ['plateforme'], platform: true, params: PlatformKeyParams, body: PlatformPut },
    async (req, res) => res.json(await settings.put(req.ctx, { scope: 'platform', key: req.valid.params.key, val: req.valid.body.value })));
  p.delete('/:key', { summary: 'Supprime un paramètre de plateforme', tags: ['plateforme'], platform: true, params: PlatformKeyParams, responses: { 204: 'Supprimé' } },
    async (req, res) => { await settings.remove(req.ctx, { scope: 'platform', key: req.valid.params.key }); res.status(204).end(); });

  return [r, p];
};
