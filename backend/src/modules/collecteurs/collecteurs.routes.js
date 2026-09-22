const { z } = require('zod');

const Id = z.coerce.number().int().positive();

const Type = z.object({
  nom: z.string().min(3).max(80),
});

const Conf = z.object({
  // commun
  dossierSignes: z.string().max(200).optional(),
  essai: z.boolean().optional(),
  // mail (lu par l'API de la Ville : seule la boîte est indiquée, le paramétrage Graph reste côté APM)
  graphMailbox: z.string().max(200).optional(),
  retraitMail: z.boolean().optional(),
  // dossier
  cible: z.string().max(500).optional(),
  utilisateur: z.string().max(200).optional(),
  motDePasse: z.string().max(300).optional(),
  sousDossiers: z.enum(['gauche', 'elus']).optional(),
  mouvement: z.enum(['deplacer', 'supprimer']).optional(),
}).partial();

const Collecteur = z.object({
  nom: z.string().min(2).max(80),
  type: z.enum(['mail', 'dossier']),
  actif: z.boolean().optional(),
  intervalle: z.enum(['1h', '4h', '24h']).optional(),
  typeArreteId: z.number().int().positive().nullable().optional(),
  eluId: z.number().int().positive().nullable().optional(),
  emailRetour: z.string().email().nullable().optional(),
  config: Conf.optional(),
});

module.exports = ({ makeRouter, collecteurs }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');
  const P = z.object({ orgId: Id });
  const PI = P.extend({ id: Id });
  const common = { tags: ['collecteurs'], org: true, roles: ['org_admin', 'scc'] };

  // ---- catalogue des types d'arrêté ----------------------------------------------------------------------
  r.get('/collecteurs/types', { ...common, summary: 'Types d’arrêté du catalogue des collecteurs', params: P },
    async (req, res) => res.json({ items: await collecteurs.types(req.org.id) }));

  r.post('/collecteurs/types', { ...common, summary: 'Ajoute un type d’arrêté au catalogue', params: P, body: Type },
    async (req, res) => res.status(201).json(await collecteurs.ajouterType(req.ctx, req.org.id, req.valid.body.nom)));

  r.delete('/collecteurs/types/:id', { ...common, summary: 'Retire un type d’arrêté (s’il n’est plus utilisé)', params: PI },
    async (req, res) => res.json(await collecteurs.retirerType(req.ctx, req.org.id, req.valid.params.id)));

  // ---- collecteurs -----------------------------------------------------------------------------------------
  r.get('/collecteurs', { ...common, summary: 'Liste les collecteurs d’arrêtés', params: P },
    async (req, res) => res.json({ items: await collecteurs.list(req.ctx, req.org.id) }));

  r.post('/collecteurs', {
    ...common, summary: 'Crée un collecteur d’arrêtés (mail via l’API ville ou dossier)', params: P, body: Collecteur,
    description: 'Les mots de passe (partage) sont chiffrés au repos. Source « mail » : lue par l’API de la Ville (Graph côté APM) — seul le nom de la boîte est facultatif (à défaut, la boîte configurée dans l’API). Source « dossier » : `config.cible` (chemin local ou UNC), `config.sousDossiers` (« elus » = un sous-dossier par élu, « gauche » = les fichiers à la racine), `config.mouvement` (« deplacer » vers _traites/<date>, ou « supprimer »).',
  }, async (req, res) => res.status(201).json(await collecteurs.creer(req.ctx, req.org.id, req.valid.body)));

  r.get('/collecteurs/:id', { ...common, summary: 'Détail d’un collecteur', params: PI },
    async (req, res) => res.json(await collecteurs.get(req.ctx, req.org.id, req.valid.params.id)));

  r.put('/collecteurs/:id', {
    ...common, summary: 'Modifie un collecteur', params: PI, body: Collecteur.partial(),
    description: 'Patch partiel : seuls les champs présents sont mis à jour. Un mot de passe partage envoyé remplace le précédent.',
  }, async (req, res) => res.json(await collecteurs.maj(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.delete('/collecteurs/:id', {
    ...common, summary: 'Supprime un collecteur n’ayant jamais collecté', params: PI,
    description: 'Un collecteur qui a déjà collecté des arrêtés ne se supprime pas : désactivez-le (l’historique reste exploitable).',
  }, async (req, res) => res.json(await collecteurs.supprimer(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/collecteurs/:id/tester', { ...common, summary: 'Teste la source (partage ou boîte via l’API ville) sans rien moissonner', params: PI },
    async (req, res) => res.json(await collecteurs.tester(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/collecteurs/:id/collecter', { ...common, summary: 'Lance une collecte immédiate (bouton « Collecter maintenant »)', params: PI },
    async (req, res) => res.json(await collecteurs.collecterMaintenant(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/collecteurs/:id/collectes', { ...common, summary: 'Journal des collectes d’un collecteur', params: PI, query: z.object({ limite: z.coerce.number().int().min(1).max(200).optional() }) },
    async (req, res) => res.json({ items: await collecteurs.collectes(req.ctx, req.org.id, req.valid.params.id, { limite: req.valid.query.limite }) }));

  return [r];
};