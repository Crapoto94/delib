const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const OrgP = z.object({ orgId: Id });
const IdP = OrgP.extend({ id: Id });
const T = ['visas et références'];
const ECRITURE = ['org_admin', 'scc'];

const date = z.union([z.iso.date(), z.literal(''), z.null()]).optional();
const Entree = z.object({
  cle: z.string().trim().min(1).max(120).describe("Clé normalisée : cgct:L2121-29 (article d'un code), cgct (code seul), loi:2015-991, decret:2016-360, arrete:2024-12…"),
  type: z.enum(['code', 'loi', 'ordonnance', 'decret', 'arrete', 'autre']).optional(),
  code: z.string().trim().max(60).nullable().optional(), article: z.string().trim().max(40).nullable().optional(),
  intitule: z.string().trim().min(2).max(500).describe("Libellé normalisé, tel qu'il doit être visé"),
  statut: z.enum(['en_vigueur', 'modifie', 'abroge']).optional(),
  dateDebut: date, dateFin: date, verifieLe: date,
  source: z.string().trim().max(500).nullable().optional(), note: z.string().trim().max(2000).nullable().optional(),
  matieres: z.array(Id).max(200).optional(), typesActe: z.array(Id).max(50).optional(),
});
const EntreeMaj = Entree.partial();
const Import = z.object({ format: z.enum(['json', 'csv']), contenu: z.string().min(2).max(2_000_000) });
const ListQ = z.object({ q: z.string().trim().max(120).optional(), statut: z.enum(['en_vigueur', 'modifie', 'abroge']).optional(), type: z.enum(['code', 'loi', 'ordonnance', 'decret', 'arrete', 'autre']).optional() });
const Controle = z.object({
  nom: z.string().trim().min(2).max(120), typeActeId: Id.nullable().optional(), matiereId: Id.nullable().optional(),
  regle: z.enum(['visa', 'mention']),
  cle: z.string().trim().max(120).nullable().optional().describe('Règle « visa » : clé de la bibliothèque attendue dans les visas'),
  motif: z.string().trim().max(500).nullable().optional().describe('Règle « mention » : expression attendue dans les textes'),
  estRegex: z.boolean().optional(), montantMin: z.number().nonnegative().nullable().optional(),
  gravite: z.enum(['bloquant', 'a_revoir', 'info']).optional(), message: z.string().trim().max(500).nullable().optional(), actif: z.boolean().optional(),
}).refine((d) => (d.regle === 'visa' ? !!d.cle : !!d.motif), { message: 'Règle « visa » : une clé ; règle « mention » : une expression' });
const ControleMaj = z.object({
  nom: z.string().trim().min(2).max(120).optional(), typeActeId: Id.nullable().optional(), matiereId: Id.nullable().optional(), regle: z.enum(['visa', 'mention']).optional(),
  cle: z.string().trim().max(120).nullable().optional(), motif: z.string().trim().max(500).nullable().optional(), estRegex: z.boolean().optional(), montantMin: z.number().nonnegative().nullable().optional(),
  gravite: z.enum(['bloquant', 'a_revoir', 'info']).optional(), message: z.string().trim().max(500).nullable().optional(), actif: z.boolean().optional(),
});

module.exports = ({ makeRouter, visas, ai }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/visas');

  r.get('/', { summary: "Bibliothèque de visas de l'organisme (textes normalisés, statut, validité, dernière vérification)", tags: T, org: true, params: OrgP, query: ListQ,
    description: "Lisible par tous les agents (les contrôles s'en servent). La bibliothèque est fournie vide : le juridique la maintient, ni le modèle ni le logiciel n'y mettent de droit de mémoire (IA-05)." },
  async (req, res) => res.json({ items: await visas.list(req.org.id, req.valid.query) }));
  r.post('/', { summary: 'Ajoute un texte à la bibliothèque (administrateur, SCC)', tags: T, org: true, roles: ECRITURE, params: OrgP, body: Entree, responses: { 201: 'Créée' } },
    async (req, res) => res.status(201).json(await visas.create(req.ctx, req.org.id, req.valid.body)));
  r.post('/import', { summary: 'Import en masse (JSON ou CSV) : crée ou met à jour par clé', tags: T, org: true, roles: ECRITURE, params: OrgP, body: Import,
    description: "CSV : en-tête `cle;type;code;article;intitule;statut;date_debut;date_fin;verifie_le;source`. Renvoie le nombre d'entrées créées et mises à jour, et les lignes en erreur (les autres sont importées)." },
  async (req, res) => res.json(await visas.importer(req.ctx, req.org.id, req.valid.body)));

  // listes de contrôle (déclarées avant « /:id » pour ne pas être prises pour un identifiant)
  r.get('/controles', { summary: "Listes de contrôle : visas et mentions attendus par type d'acte et matière", tags: T, org: true, params: OrgP },
    async (req, res) => res.json({ items: await visas.controles(req.org.id) }));
  r.post('/controles', { summary: 'Ajoute une règle de contrôle (visa attendu ou mention attendue)', tags: T, org: true, roles: ECRITURE, params: OrgP, body: Controle, responses: { 201: 'Créée' } },
    async (req, res) => res.status(201).json(await visas.creerControle(req.ctx, req.org.id, req.valid.body)));
  r.put('/controles/:id', { summary: 'Modifie ou désactive une règle de contrôle', tags: T, org: true, roles: ECRITURE, params: IdP, body: ControleMaj },
    async (req, res) => res.json(await visas.modifierControle(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/controles/:id', { summary: 'Supprime une règle de contrôle', tags: T, org: true, roles: ECRITURE, params: IdP },
    async (req, res) => res.json(await visas.supprimerControle(req.ctx, req.org.id, req.valid.params.id)));

  r.put('/:id', { summary: 'Modifie une entrée ; le passage à « abrogé » ou « modifié » prévient les rédacteurs des actes en cours qui la citent', tags: T, org: true, roles: ECRITURE, params: IdP, body: EntreeMaj },
    async (req, res) => res.json(await visas.update(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/:id', { summary: 'Supprime une entrée', tags: T, org: true, roles: ECRITURE, params: IdP },
    async (req, res) => res.json(await visas.remove(req.ctx, req.org.id, req.valid.params.id)));
  r.post('/:id/verification', { summary: "« Vérifié aujourd'hui » : atteste que le texte a été contrôlé à la source", tags: T, org: true, roles: ECRITURE, params: IdP },
    async (req, res) => res.json(await visas.marquerVerifie(req.ctx, req.org.id, req.valid.params.id)));
  r.get('/:id/actes-concernes', { summary: 'Actes en cours qui citent ce texte (veille : texte devenu obsolète)', tags: T, org: true, roles: ECRITURE, params: IdP },
    async (req, res) => res.json({ items: await visas.concernes(req.org.id, req.valid.params.id) }));

  // sur un dossier
  const a = makeRouter('/api/v1/organismes/:orgId/actes/:id');
  a.get('/visas/usuels', { summary: 'Bibliothèque des vus et considérants les plus utilisés, avec pastille de vérification', tags: T, org: true, params: IdP, query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(15) }),
    description: "Les lignes « Vu… » et « Considérant que… » les plus fréquentes des délibérations adoptées de l'organisme, rapprochées de la bibliothèque de visas : vérifié, à revoir, obsolète, à faire vérifier ou sans référence. Sert de bibliothèque de suggestion à la rédaction (sans IA, sans écriture)." },
  async (req, res) => res.json(await visas.usuels(req.ctx, req.org.id, req.valid.params.id, req.valid.query)));
  a.get('/ia/references', { summary: 'Rapport de vérification des références juridiques du dossier (sans IA, sans écriture)', tags: T, org: true, params: IdP,
    description: "Références extraites par règles (codes et articles, lois, décrets, arrêtés, délibérations antérieures), rapprochées de la bibliothèque à la date de la séance visée : à jour, à revoir, obsolète, introuvable. Ajoute les constats des listes de contrôle et l'ordre conventionnel des visas." },
  async (req, res) => res.json(await visas.rapport(req.ctx, req.org.id, req.valid.params.id)));
  a.post('/ia/references', { summary: 'Vérifie les références du dossier et dépose les constats dans les propositions (immédiat, sans IA)', tags: T, org: true, params: IdP,
    description: "Disponible même si l'IA est désactivée. Les constats sont des alertes (à écarter ou à corriger par l'agent), jamais appliquées automatiquement." },
  async (req, res) => res.json(await ai.verifierReferences(req.ctx, req.org.id, req.valid.params.id)));
  return [r, a];
};
