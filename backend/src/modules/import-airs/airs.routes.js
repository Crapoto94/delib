const { z } = require('zod');

const T = ['import AIRS DELIB'];
const ROLES = ['org_admin', 'scc']; // IMP-18 : administrateur d'organisme et SCC
const OrgP = z.object({ orgId: z.coerce.number().int().positive() });
const LotP = OrgP.extend({ id: z.coerce.number().int().positive() });
const ItemP = LotP.extend({ itemId: z.coerce.number().int().positive() });
const ConcP = LotP.extend({ cid: z.coerce.number().int().positive() });
const Ligne = z.record(z.string(), z.unknown());
const Colonne = z.object({ source: z.string().min(1).max(80), cible: z.string().min(1).max(80) });
const MappingItem = z.object({
  tableName: z.string().regex(/^[a-z0-9_]{2,64}$/), libelle: z.string().max(200).optional(),
  entiteCible: z.enum(['brut', 'seance', 'acte']).optional(), cleColonne: z.string().max(80).optional(),
  colonnes: z.array(Colonne).max(60).optional(), obligatoire: z.boolean().optional(), ordre: z.number().int().optional(), actif: z.boolean().optional(),
});
const Cible = z.object({ cibleType: z.string().max(40).nullish(), cibleId: z.number().int().positive().nullish(), cibleCode: z.string().max(200).nullish(), cibleLibelle: z.string().max(300).nullish() });

module.exports = ({ makeRouter, airs }) => {
  const r = makeRouter('/api/v1/organismes');

  r.get('/:orgId/import-airs', { summary: "Import AIRS DELIB : lots, axes et concordances bloquantes", tags: T, org: true, roles: ROLES, params: OrgP },
    async (req, res) => res.json(await airs.lister(req.ctx, req.org.id)));

  r.get('/:orgId/import-airs/cibles', {
    summary: "Cibles proposées pour un axe de concordance (référentiels, directions, services, agents, élus…)", tags: T, org: true, roles: ROLES,
    params: OrgP, query: z.object({ axe: z.string().min(2).max(40), q: z.string().max(100).default('') }),
  }, async (req, res) => res.json(await airs.cibles(req.org.id, req.valid.query.axe, req.valid.query.q)));

  r.post('/:orgId/import-airs/agents/verifier', {
    summary: "Contrôle AD / RH d'agents cités par AIRS (jamais connectés) — sans création", tags: T, org: true, roles: ROLES, params: OrgP,
    body: z.object({ valeurs: z.array(z.object({ identifiant: z.string().max(200).optional(), nom: z.string().max(200).optional() })).max(50) }),
  }, async (req, res) => res.json(await airs.verifierAgents(req.ctx, req.org.id, req.valid.body.valeurs)));

  r.get('/:orgId/import-airs/mapping', { summary: 'Mapping déclaratif des tables AIRS lues', tags: T, org: true, roles: ROLES, params: OrgP },
    async (req, res) => res.json(await airs.getMapping(req.ctx, req.org.id)));
  r.put('/:orgId/import-airs/mapping', { summary: 'Met à jour le mapping des tables AIRS (MCD inconnu : configuration)', tags: T, org: true, roles: ['org_admin'], params: OrgP, body: z.object({ items: z.array(MappingItem).max(100) }) },
    async (req, res) => res.json(await airs.setMapping(req.ctx, req.org.id, req.valid.body.items)));

  r.post('/:orgId/import-airs/lots', { summary: "Crée un lot de reprise", tags: T, org: true, roles: ROLES, params: OrgP, responses: { 201: 'Créé' },
    body: z.object({ label: z.string().min(1).max(200), sourceKind: z.enum(['json', 'tables']).default('json'), mode: z.enum(['passes', 'preparation']).default('passes') }) },
  async (req, res) => { const lot = await airs.creerLot(req.ctx, req.org.id, req.valid.body); res.status(201).json(lot); });

  r.get('/:orgId/import-airs/lots/:id', { summary: "Détail d'un lot : concordances, items, blocages, journal", tags: T, org: true, roles: ROLES, params: LotP },
    async (req, res) => res.json(await airs.detail(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/:orgId/import-airs/lots/:id/charger', { summary: "Charge les lignes AIRS dans le sas (JSONB, rien n'est interprété)", tags: T, org: true, roles: ['org_admin'], params: LotP,
    body: z.object({ data: z.record(z.string(), z.array(Ligne)) }) },
  async (req, res) => res.json(await airs.charger(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.post('/:orgId/import-airs/lots/:id/charger-demo', { summary: "Charge le jeu d'essai (recette sans source réelle, IMP-19)", tags: T, org: true, roles: ROLES, params: LotP },
    async (req, res) => res.json(await airs.chargerDemo(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/:orgId/import-airs/lots/:id/analyser', { summary: "Analyse le sas : items détectés et valeurs à concorder", tags: T, org: true, roles: ROLES, params: LotP },
    async (req, res) => res.json(await airs.analyser(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/:orgId/import-airs/lots/:id/concordances', { summary: 'Concordances du lot, par axe', tags: T, org: true, roles: ROLES, params: LotP,
    query: z.object({ axe: z.string().max(40).optional() }) },
  async (req, res) => res.json(await airs.concordances(req.org.id, req.valid.params.id, req.valid.query)));

  r.post('/:orgId/import-airs/lots/:id/concordances/auto', { summary: 'Relance les propositions de concordance', tags: T, org: true, roles: ROLES, params: LotP },
    async (req, res) => res.json({ proposees: await airs.proposer(req.org.id, req.valid.params.id) }));

  r.post('/:orgId/import-airs/lots/:id/concordances/:cid', { summary: 'Décide une concordance (cible choisie, ou valeur ignorée)', tags: T, org: true, roles: ROLES, params: ConcP,
    body: Cible.extend({ etat: z.enum(['proposee', 'automatique', 'manuelle', 'ignoree']).optional() }) },
  async (req, res) => res.json(await airs.decider(req.ctx, req.org.id, req.valid.params.id, req.valid.params.cid, req.valid.body)));

  r.get('/:orgId/import-airs/lots/:id/actes', { summary: 'Items du sas (actes et séances) avec leurs blocages', tags: T, org: true, roles: ROLES, params: LotP,
    query: z.object({ kind: z.enum(['seance', 'acte']).optional() }) },
  async (req, res) => res.json(await airs.items(req.ctx, req.org.id, req.valid.params.id, req.valid.query)));

  r.post('/:orgId/import-airs/lots/:id/actes/:itemId/publier', { summary: 'Publie un acte du sas en acte historique', tags: T, org: true, roles: ROLES, params: ItemP },
    async (req, res) => res.json(await airs.publierItem(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId)));
  r.post('/:orgId/import-airs/lots/:id/actes/:itemId/ignorer', { summary: "Ignore un item du sas", tags: T, org: true, roles: ROLES, params: ItemP },
    async (req, res) => res.json(await airs.ignorerItem(req.ctx, req.org.id, req.valid.params.id, req.valid.params.itemId)));

  r.post('/:orgId/import-airs/lots/:id/publier', { summary: 'Publie tous les items prêts (rapport item par item)', tags: T, org: true, roles: ROLES, params: LotP },
    async (req, res) => res.json(await airs.publierTout(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/:orgId/import-airs/lots/:id/depublier', { summary: 'Retire les actes publiés de ce lot (jamais de suppression physique)', tags: T, org: true, roles: ROLES, params: LotP },
    async (req, res) => res.json(await airs.dePublier(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/:orgId/import-airs/lots/:id/annuler', { summary: "Annule le lot (retire ses publications)", tags: T, org: true, roles: ROLES, params: LotP },
    async (req, res) => res.json(await airs.annuler(req.ctx, req.org.id, req.valid.params.id)));

  return [r];
};
