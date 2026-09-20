const { z } = require('zod');
const { TYPES } = require('./convocations.service');

const Id = z.coerce.number().int().positive();
const PS = z.object({ orgId: Id, id: Id });
const PV = PS.extend({ n: Id });
const Envoi = z.object({
  eluIds: z.array(Id).max(500).optional().describe('Élus convoqués (par défaut : tous les membres de l\'instance)'),
  agents: z.array(z.string().trim().min(1).max(128)).max(300).default([]).describe('Agents de la Ville convoqués (identifiants de connexion)'),
  objet: z.string().trim().max(200).optional(),
  message: z.string().trim().max(3000).optional().describe('Texte ajouté à la convocation et au mail'),
  urgence: z.boolean().default(false).describe("Convocation adressée en urgence : délai réduit, motif obligatoire"),
  urgenceMotif: z.string().trim().max(500).optional(),
});
const JournalQ = z.object({ type: z.enum(TYPES).optional(), destinataireId: Id.optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) });
const Relance = z.object({ cible: z.enum(['non_lecteurs', 'sans_reponse']).default('non_lecteurs') });
const Tok = z.object({ token: z.string().min(20).max(64) });
const Reponse = z.object({ reponse: z.enum(['present', 'absent']), commentaire: z.string().trim().max(500).optional() });
const T = ['convocations'];
const ROLES = ['org_admin', 'scc'];

module.exports = ({ makeRouter, convocations, limiter }) => {
  const r = makeRouter('/api/v1/organismes/:orgId/seances/:id/convocation');

  r.get('/preparation', { summary: "Écran d'envoi : convoqués possibles, ordre du jour arrêté ?, contrôle du délai, versions", tags: T, org: true, roles: ROLES, params: PS },
    async (req, res) => res.json(await convocations.preparation(req.ctx, req.org.id, req.valid.params.id)));

  r.post('/', { summary: 'Envoie la convocation (ou un modificatif) aux élus et aux agents choisis', tags: T, org: true, roles: ROLES, params: PS, body: Envoi, responses: { 202: 'Envoi lancé' },
    description: "Préconditions : ordre du jour arrêté et délai respecté (5 jours francs par défaut — `convocation.delai_jours_francs` ; réduit en urgence avec motif — `convocation.delai_urgence`). Chaque convoqué reçoit un LIEN PERSONNEL unique (`/c/<jeton>`) dont l'ouverture et les consultations sont journalisées. Un nouvel envoi après une première convocation est un modificatif (nouvelle version, différences d'ordre du jour, nouveaux liens). L'envoi des mails se fait en arrière plan." },
  async (req, res) => res.status(202).json(await convocations.envoyer(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  r.get('/versions', { summary: 'Versions de la convocation, avec compteurs de suivi', tags: T, org: true, roles: ROLES, params: PS },
    async (req, res) => res.json({ items: await convocations.versions(req.ctx, req.org.id, req.valid.params.id) }));
  r.get('/versions/:n', { summary: "Détail d'une version", tags: T, org: true, roles: ROLES, params: PV },
    async (req, res) => res.json(await convocations.get(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n)));
  r.get('/versions/:n/destinataires', { summary: 'Convoqués : envoi, ouverture, convocation et ordre du jour consultés, accusé, réponse, relances', tags: T, org: true, roles: ROLES, params: PV },
    async (req, res) => res.json({ items: await convocations.destinataires(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n) }));
  r.get('/versions/:n/journal', { summary: 'Journal de preuve (envois, ouvertures, consultations, accusés, réponses, relances)', tags: T, org: true, roles: ROLES, params: PV, query: JournalQ },
    async (req, res) => res.json(await convocations.journal(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n, req.valid.query)));
  r.get('/versions/:n/statistiques', { summary: 'Statistiques : taux, répartition élus / agents / groupes, chronologie, non-lecteurs', tags: T, org: true, roles: ROLES, params: PV },
    async (req, res) => res.json(await convocations.stats(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n)));
  r.post('/versions/:n/relance', { summary: "Relance ceux qui n'ont pas consulté la convocation (ou n'ont pas répondu)", tags: T, org: true, roles: ROLES, params: PV, body: Relance,
    description: 'Même lien personnel ; seule la version la plus récente peut être relancée.' },
  async (req, res) => res.json(await convocations.relancer(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n, req.valid.body)));
  r.get('/versions/:n/export.csv', { summary: "Preuve d'envoi et de consultation (CSV)", tags: T, org: true, roles: ROLES, params: PV, responses: { 200: 'CSV' } },
    async (req, res) => {
      const csv = await convocations.exportCsv(req.ctx, req.org.id, req.valid.params.id, req.valid.params.n);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="convocation-v${req.valid.params.n}-suivi.csv"`); res.send(csv);
    });

  // ---- côté convoqué : lien personnel, sans connexion (le jeton EST l'authentification, 192 bits)
  const pub = makeRouter('/api/v1/public/convocations/:token');
  const meta = (req) => ({ ip: req.ip, ua: req.get('user-agent') });
  pub.get('/', { summary: 'Ouvre la convocation par le lien personnel du convoqué (enregistre l\'ouverture)', tags: T, auth: false, limiter, params: Tok },
    async (req, res) => res.json(await convocations.openToken(req.valid.params.token, meta(req))));
  const pdf = (kind) => async (req, res) => {
    const f = await convocations.pdfToken(req.valid.params.token, kind, meta(req));
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${f.name}"`); res.setHeader('Cache-Control', 'private, no-store'); res.send(f.buffer);
  };
  pub.get('/convocation.pdf', { summary: 'PDF de la convocation (enregistre la consultation)', tags: T, auth: false, limiter, params: Tok, responses: { 200: 'PDF' } }, pdf('convocation'));
  pub.get('/ordre-du-jour.pdf', { summary: "PDF de l'ordre du jour (enregistre la consultation)", tags: T, auth: false, limiter, params: Tok, responses: { 200: 'PDF' } }, pdf('odj'));
  pub.post('/accuse', { summary: "« J'ai pris connaissance »", tags: T, auth: false, limiter, params: Tok },
    async (req, res) => res.json(await convocations.accuseToken(req.valid.params.token, meta(req))));
  pub.post('/reponse', { summary: 'Réponse de présence (présent / absent excusé)', tags: T, auth: false, limiter, params: Tok, body: Reponse },
    async (req, res) => res.json(await convocations.reponseToken(req.valid.params.token, req.valid.body, meta(req))));

  return [r, pub];
};
