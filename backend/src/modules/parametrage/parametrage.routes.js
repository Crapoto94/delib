const { z } = require('zod');
const { MODELES } = require('./modeles');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PC = P.extend({ id: Id });
const ADMIN = ['org_admin'];
const T = ['paramétrage'];

const Visible = z.object({ champ: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), egal: z.union([z.string().max(200), z.number(), z.boolean()]) }).nullable();
const Champ = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).describe('Identifiant technique, définitif'), libelle: z.string().trim().min(2).max(120), aide: z.string().trim().max(500).nullable().optional(),
  kind: z.enum(['texte', 'nombre', 'date', 'liste', 'booleen', 'elu', 'agent']), options: z.array(z.object({ valeur: z.string().min(1).max(80), libelle: z.string().min(1).max(120) })).max(100).optional(),
  obligatoire: z.boolean().optional(), typeActeId: Id.nullable().optional().describe('Vide : tous les types d’actes'), visibleSi: Visible.optional(),
  rolesSaisie: z.array(z.string().min(2).max(40)).max(20).optional().describe('Vide : tout éditeur de l’acte'), etapesSaisie: z.array(z.string().min(2).max(60)).max(30).optional().describe('Clés d’étapes du circuit ; « brouillon » = avant l’envoi'),
  ordre: z.number().int().min(0).max(1000).optional(),
});
const ChampUpd = Champ.omit({ code: true, kind: true, typeActeId: true }).partial().extend({ actif: z.boolean().optional() });
const ListQ = z.object({ typeId: Id.optional() });
const Import = z.object({ document: z.record(z.string(), z.unknown()), appliquer: z.boolean().default(false).describe('false : aperçu seulement') });

module.exports = ({ makeRouter, champs, configuration }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/champs', { summary: 'Champs personnalisés actifs (pour la fiche), éventuellement d’un type d’acte', tags: T, org: true, params: P, query: ListQ },
    async (req, res) => res.json({ items: await champs.list(req.org.id, { typeActeId: req.valid.query.typeId }) }));
  r.get('/champs/definitions', { summary: 'Toutes les définitions de champs, y compris désactivés (administration)', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json({ items: await champs.list(req.org.id, { inclureInactifs: true }) }));
  r.post('/champs', {
    summary: 'Crée un champ personnalisé', tags: T, org: true, roles: ADMIN, params: P, body: Champ, responses: { 201: 'Créé' },
    description: 'Types : texte, nombre, date, liste, oui/non, élu, agent. Obligatoire : bloque l’envoi au circuit. Droits de saisie par rôle et par étape ; condition d’affichage « champ = valeur ».',
  }, async (req, res) => res.status(201).json(await champs.create(req.ctx, req.org.id, req.valid.body)));
  r.put('/champs/:id', { summary: 'Modifie un champ (le code et le type ne changent jamais)', tags: T, org: true, roles: ADMIN, params: PC, body: ChampUpd },
    async (req, res) => res.json(await champs.update(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/champs/:id', { summary: 'Désactive un champ : les valeurs déjà saisies sont conservées', tags: T, org: true, roles: ADMIN, params: PC },
    async (req, res) => res.json(await champs.remove(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/configuration/export', {
    summary: 'Exporte la configuration de l’organisme (JSON) : paramètres, référentiels propres, champs, circuits, instances', tags: T, org: true, roles: ADMIN, params: P,
    description: 'Jamais de secret, de personne ni d’acte dans le fichier.',
  }, async (req, res) => {
    const doc = await configuration.exporter(req.ctx, req.org.id);
    res.setHeader('Content-Disposition', `attachment; filename="configuration-${doc.source.code}.json"`); res.json(doc);
  });
  r.post('/configuration/import', {
    summary: 'Importe une configuration : aperçu (appliquer = false) puis application', tags: T, org: true, roles: ADMIN, params: P, body: Import,
    description: 'Idempotent ; ne supprime jamais rien ; n’écrase aucun circuit (les circuits importés arrivent en brouillon) ; audité.',
  }, async (req, res) => res.json(await configuration.importer(req.ctx, req.org.id, req.valid.body.document, { appliquer: req.valid.body.appliquer })));
  r.get('/configuration/modeles', { summary: 'Modèles de configuration prêts à importer (ex. commune neutre)', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json({ items: Object.entries(MODELES).map(([code, m]) => ({ code, nom: m.nom, description: m.description })) }));
  r.get('/configuration/modeles/:code', { summary: 'Contenu d’un modèle de configuration', tags: T, org: true, roles: ADMIN, params: P.extend({ code: z.string().regex(/^[a-z0-9-]{2,40}$/) }) },
    async (req, res) => {
      const m = MODELES[req.valid.params.code];
      if (!m) return res.status(404).json({ error: 'Modèle inconnu', code: 'NOT_FOUND' });
      return res.json(m.document());
    });
  return [r];
};
