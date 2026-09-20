const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const Archivage = z.object({
  seuil: z.coerce.date().optional().describe('Date butoir : les actes terminés modifiés avant cette date sont concernés (défaut : durée de conservation paramétrée)'),
  motif: z.string().trim().max(500).optional(),
  dryRun: z.boolean().default(true).describe('true : aperçu sans effet ; false : application'),
});
const Pseudonymisation = z.object({
  seuil: z.coerce.date().optional().describe('Date butoir : les entrées d’audit antérieures sont concernées (défaut : durée de conservation paramétrée)'),
  dryRun: z.boolean().default(true),
});
const JournalQ = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) });

const ADMIN = ['org_admin'];
const T = ['rgpd'];

module.exports = ({ makeRouter, rgpd }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/rgpd/etat', {
    summary: 'État RGPD : durées de conservation, volumes et correspondances', tags: T, org: true, roles: ADMIN, params: P,
    description: "Rétentions paramétrées, nombre d'actes (dont archivés intermédiaires), entrées d'audit et pseudonymes.",
  }, async (req, res) => res.json(await rgpd.etat(req.ctx, req.org.id)));

  r.post('/rgpd/archivage-intermediaire', {
    summary: 'Archivage intermédiaire des actes (aperçu puis application)', tags: T, org: true, roles: ADMIN, params: P, body: Archivage,
    description: "Sort de l'usage courant les actes terminés et anciens (listes actives, recherche) sans les supprimer. `dryRun=true` renvoie un aperçu.",
  }, async (req, res) => res.json(await rgpd.archiver(req.ctx, req.org.id, req.valid.body)));

  r.post('/rgpd/pseudonymisation', {
    summary: 'Pseudonymisation des actions et journaux (aperçu puis application)', tags: T, org: true, roles: ADMIN, params: P, body: Pseudonymisation,
    description: "Remplace les identités et adresses IP des entrées d'audit anciennes par des pseudonymes stables. Le journal d'audit reste immuable ; la correspondance est conservée à part. `dryRun=true` renvoie un aperçu.",
  }, async (req, res) => res.json(await rgpd.pseudonymiser(req.ctx, req.org.id, req.valid.body)));

  r.get('/rgpd/operations', { summary: 'Journal des opérations RGPD', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json({ items: await rgpd.operations(req.ctx, req.org.id) }));

  r.get('/rgpd/pseudonymes', { summary: 'Correspondance des pseudonymes (ré-identification)', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json({ items: await rgpd.pseudonymes(req.ctx, req.org.id) }));

  r.get('/rgpd/journal', { summary: 'Journal d’audit pseudonymisé', tags: T, org: true, roles: ADMIN, params: P, query: JournalQ },
    async (req, res) => res.json(await rgpd.journalPseudonymise(req.ctx, req.org.id, req.valid.query)));

  return [r];
};
