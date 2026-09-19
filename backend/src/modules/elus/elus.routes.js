const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PI = P.extend({ id: Id });
const ADMIN = ['org_admin', 'scc'];
const Flag = z.enum(['true', 'false']).transform((v) => v === 'true');

const ListQ = z.object({ q: z.string().max(80).optional(), actif: z.enum(['true', 'false', 'all']).default('true'), groupeId: Id.optional(), estElu: Flag.optional() });
const Elu = z.object({
  nom: z.string().trim().min(1).max(120), prenom: z.string().trim().max(120).optional(), email: z.email().optional(), telephone: z.string().max(40).optional(),
  role: z.string().max(80).optional(), delegation: z.string().max(160).optional(), estElu: z.boolean().optional(), groupeId: Id.nullable().optional(),
  mandatDebut: z.iso.date().nullable().optional(), mandatFin: z.iso.date().nullable().optional(),
});
const EluPatch = Elu.partial().extend({ actif: z.boolean().optional() });
const Groupe = z.object({ nom: z.string().trim().min(2).max(120), couleur: z.string().max(20).optional(), ordre: z.number().int().optional() });
const GroupePatch = Groupe.partial().extend({ actif: z.boolean().optional() });

module.exports = ({ makeRouter, elus }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');
  const T = ['élus'];

  r.get('/elus', { summary: "Élus et membres de l'organisme", tags: T, org: true, params: P, query: ListQ },
    async (req, res) => { const q = req.valid.query; res.json({ items: await elus.list(req.org.id, { q: q.q, actif: q.actif === 'all' ? null : q.actif === 'true', groupeId: q.groupeId, estElu: q.estElu }) }); });
  r.post('/elus', { summary: 'Ajoute un élu ou un membre non élu (saisie manuelle)', tags: T, org: true, roles: ADMIN, params: P, body: Elu, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await elus.create(req.ctx, req.org.id, req.valid.body)));
  r.post('/elus/synchronisation', { summary: 'Synchronise les élus depuis le Hub DSI', tags: T, org: true, roles: ADMIN, params: P,
    description: "Identité en lecture seule (Hub) ; le groupe politique et le mandat, saisis ici, ne sont jamais écrasés. Les élus absents du Hub sont désactivés, pas supprimés." },
  async (req, res) => res.json(await elus.syncFromHub(req.ctx, req.org.id)));
  r.get('/elus/:id', { summary: 'Fiche d\'un élu', tags: T, org: true, params: PI }, async (req, res) => res.json(await elus.get(req.org.id, req.valid.params.id)));
  r.put('/elus/:id', { summary: 'Modifie un élu (identité seulement pour la saisie manuelle)', tags: T, org: true, roles: ADMIN, params: PI, body: EluPatch },
    async (req, res) => res.json(await elus.update(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/groupes-politiques', { summary: 'Groupes politiques', tags: T, org: true, params: P }, async (req, res) => res.json({ items: await elus.groupes(req.org.id) }));
  r.post('/groupes-politiques', { summary: 'Crée un groupe politique', tags: T, org: true, roles: ADMIN, params: P, body: Groupe, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await elus.createGroupe(req.ctx, req.org.id, req.valid.body)));
  r.put('/groupes-politiques/:id', { summary: 'Modifie un groupe politique', tags: T, org: true, roles: ADMIN, params: PI, body: GroupePatch },
    async (req, res) => res.json(await elus.updateGroupe(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/groupes-politiques/:id', { summary: 'Supprime un groupe politique (ses élus deviennent « non inscrits »)', tags: T, org: true, roles: ADMIN, params: PI, responses: { 204: 'Supprimé' } },
    async (req, res) => { await elus.removeGroupe(req.ctx, req.org.id, req.valid.params.id); res.status(204).end(); });

  return [r];
};
