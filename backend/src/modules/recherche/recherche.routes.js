const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PS = P.extend({ id: Id });
const T = ['recherche'];
const ADMIN = ['org_admin'];

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const Criteres = {
  q: z.string().trim().max(300).optional().describe('Mots, « expression exacte », OR, -exclusion, prefixe*, n° de suivi ou de délibération'),
  statut: z.string().max(40).optional(), typeId: Id.optional(), natureId: Id.optional(), matiereId: Id.optional().describe('Comprend les sous-niveaux'), rubriqueId: Id.optional(),
  rapporteurId: Id.optional(), directionCode: z.string().max(40).optional(), redacteur: z.string().max(128).optional(), seanceId: Id.optional(), instanceId: Id.optional(),
  resultat: z.enum(['adopte_unanimite', 'adopte_majorite', 'adopte_preponderante', 'rejete_preponderante', 'rejete']).optional(),
  annee: z.coerce.number().int().min(1900).max(2200).optional(),
  du: z.iso.date().optional().describe('Date de séance à partir du'), au: z.iso.date().optional().describe('Date de séance jusqu’au'),
  creeDu: z.iso.date().optional(), creeAu: z.iso.date().optional(), annexes: bool.optional(), incidence: bool.optional(),
};
const Q = z.object({ ...Criteres, tri: z.enum(['pertinence', 'date']).default('pertinence'), limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) });
const QExport = z.object(Criteres);
const Similaires = z.object({ acteId: Id.optional(), titre: z.string().trim().max(500).optional(), objet: z.string().trim().max(2000).optional() });
const Enregistrer = z.object({ nom: z.string().trim().min(2).max(80), requete: z.record(z.string(), z.unknown()) });

module.exports = ({ makeRouter, recherche }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/recherche');

  r.get('/', {
    summary: 'Recherche plein texte dans les actes (titre, objet, textes, annexes), avec facettes, extraits surlignés et filtrage par mes droits', tags: T, org: true, params: P, query: Q,
    description: 'Insensible aux accents et à la casse, français (« écoles » trouve « école »). Un mot, plusieurs mots (tous requis), « expression exacte », OR, -exclusion, prefixe*. Un n° de suivi (`123`) ou de délibération (`2026-4-012`) est reconnu. Sans résultat, repli tolérant aux fautes légères (`approchee: true`). Un acte que je ne peux pas voir n’apparaît ni dans les résultats, ni dans les compteurs, ni dans les extraits.',
  }, async (req, res) => res.json(await recherche.chercher(req.ctx, req.org.id, req.valid.query)));

  r.get('/export.csv', { summary: 'Exporte les résultats en CSV (mêmes critères, mêmes droits)', tags: T, org: true, params: P, query: QExport, responses: { 200: 'CSV' } },
    async (req, res) => {
      const csv = await recherche.exportCsv(req.ctx, req.org.id, req.valid.query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="recherche.csv"'); res.send(csv);
    });

  r.get('/similaires', { summary: 'Actes proches d’un acte (fiche) ou d’un titre en cours de saisie (création) : « des délibérations proches existent »', tags: T, org: true, params: P, query: Similaires },
    async (req, res) => res.json(await recherche.similaires(req.ctx, req.org.id, req.valid.query)));

  r.get('/enregistrees', { summary: 'Mes recherches enregistrées', tags: T, org: true, params: P }, async (req, res) => res.json({ items: await recherche.enregistrees(req.ctx, req.org.id) }));
  r.post('/enregistrees', { summary: 'Enregistre une recherche (critères compris)', tags: T, org: true, params: P, body: Enregistrer, responses: { 201: 'Créée' } },
    async (req, res) => res.status(201).json(await recherche.enregistrer(req.ctx, req.org.id, req.valid.body)));
  r.delete('/enregistrees/:id', { summary: 'Supprime une de mes recherches enregistrées', tags: T, org: true, params: PS },
    async (req, res) => res.json(await recherche.supprimerEnregistree(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/etat', { summary: 'État de l’index (actes indexés, en retard, annexes lues / sans texte), requêtes fréquentes et sans résultat (anonymisées)', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json(await recherche.etat(req.ctx, req.org.id)));
  r.post('/reindexation', { summary: 'Lance la ré-indexation complète en arrière-plan (les annexes déjà lues ne sont pas relues)', tags: T, org: true, roles: ADMIN, params: P, responses: { 202: 'Démarrée' } },
    async (req, res) => res.status(202).json(await recherche.reindexer(req.ctx, req.org.id)));
  return [r];
};
