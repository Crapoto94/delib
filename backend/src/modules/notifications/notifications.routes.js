const { z } = require('zod');
const { FAMILIES } = require('./defaults');

const Id = z.coerce.number().int().positive();
const P = z.object({ orgId: Id });
const PA = P.extend({ id: Id });
const PC = P.extend({ code: z.string().regex(/^[a-z0-9_.-]{2,60}$/) });
const PM = PA.extend({ muteId: Id });
const ADMIN = ['org_admin', 'scc'];

const CenterQ = z.object({ unread: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const Pref = z.object({ family: z.enum(Object.keys(FAMILIES)), mode: z.enum(['immediate', 'digest', 'off']) });
const RulePref = z.object({ mode: z.enum(['immediate', 'inapp', 'off']).describe('immediate : comportement normal ; inapp : dans l\'outil seulement, pas de mail ; off : ne pas la recevoir') });
const PRule = P.extend({ code: z.string().regex(/^[a-z0-9_.-]{2,60}$/) });
const Mute = z.object({ days: z.number().min(0.1).max(180), scope: z.enum(['me', 'all']).default('me'), reason: z.string().max(300).optional() });
const Remind = z.object({ message: z.string().trim().max(1000).optional(), to: z.enum(['holders', 'redacteur']).default('holders') });
const Rule = z.object({
  nom: z.string().trim().min(2).max(200), enabled: z.boolean(), mandatory: z.boolean().describe('Obligatoire : toujours active, les utilisateurs ne peuvent pas la refuser'), condition: z.record(z.string(), z.any()).nullable(),
  recipients: z.array(z.string().max(80)).max(20), channels: z.array(z.enum(['inapp', 'mail', 'sms'])).min(1),
  palliers: z.array(z.record(z.string(), z.any())).max(20), subject: z.string().trim().min(2).max(300), body: z.string().trim().min(2).max(5000),
}).partial();
const PreviewB = z.object({ acteId: Id.optional() });
const DestQ = z.object({ code: z.string().regex(/^[a-z0-9_.-]{2,60}$/) });
const SimB = z.object({ at: z.iso.datetime() });
const JournalQ = z.object({ acteId: Id.optional(), recipient: z.string().max(128).optional(), rule: z.string().max(60).optional(), status: z.enum(['pending', 'sent', 'failed', 'skipped', 'digest']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const Holiday = z.object({ day: z.iso.date(), label: z.string().trim().max(120).optional() });
const Gen = z.object({ year: z.number().int().min(2000).max(2100) });

module.exports = ({ makeRouter, notifications }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');
  const T = ['notifications'];

  r.get('/notifications', { summary: 'Mon centre de notifications (cloche)', tags: T, org: true, params: P, query: CenterQ },
    async (req, res) => res.json(await notifications.center(req.ctx, req.org.id, req.valid.query)));
  r.post('/notifications/lues', { summary: 'Marque toutes mes notifications comme lues', tags: T, org: true, params: P },
    async (req, res) => res.json(await notifications.markAllRead(req.ctx, req.org.id)));
  r.post('/notifications/:id/lue', { summary: 'Marque une notification comme lue', tags: T, org: true, params: PA },
    async (req, res) => res.json(await notifications.markRead(req.ctx, req.org.id, req.valid.params.id)));

  r.get('/notifications/preferences', { summary: 'Mes préférences par famille (immédiat, synthèse, désactivé)', tags: T, org: true, params: P,
    description: 'Les familles obligatoires (actes à valider, délégations, administration) ne peuvent pas être désactivées.' },
  async (req, res) => res.json(await notifications.preferences(req.ctx, req.org.id)));
  r.put('/notifications/preferences', { summary: 'Modifie une préférence', tags: T, org: true, params: P, body: Pref },
    async (req, res) => res.json(await notifications.setPreference(req.ctx, req.org.id, req.valid.body.family, req.valid.body.mode)));

  r.put('/notifications/preferences/regles/:code', { summary: 'Choix pour UNE notification facultative : la recevoir, dans l\'outil seulement, ou pas du tout', tags: T, org: true, params: PRule, body: RulePref,
    description: 'Refusé (400) pour une notification obligatoire. Le choix n\'a d\'effet que pour son auteur.' },
  async (req, res) => res.json(await notifications.setRulePreference(req.ctx, req.org.id, req.valid.params.code, req.valid.body.mode)));

  // --- par acte
  r.get('/actes/:id/notifications/destinataires', {
    summary: 'Qui serait prévenu par une règle sur cet acte (aperçu)', tags: T, org: true, params: PA, query: DestQ,
    description: 'Résout les destinataires de la règle indiquée sans rien envoyer. Ex. `acte.rappele` : les personnes qui ont réellement eu affaire à l\'acte (validations, commentaires, amendements, avis), plus le rédacteur.',
  }, async (req, res) => res.json(await notifications.destinataires(req.ctx, req.org.id, req.valid.params.id, req.valid.query.code)));
  r.get('/actes/:id/notifications/sourdines', { summary: 'Sourdines et suspensions en cours sur un acte', tags: T, org: true, params: PA },
    async (req, res) => res.json({ items: await notifications.mutes(req.ctx, req.org.id, req.valid.params.id) }));
  r.post('/actes/:id/notifications/sourdine', {
    summary: 'Met en sourdine (moi) ou suspend (tous) les notifications d\'un acte', tags: T, org: true, params: PA, body: Mute, responses: { 201: 'Créé' },
    description: 'Sourdine personnelle limitée (paramètre `notifications.sourdine_max_jours`, 14 par défaut) et visible du SCC. La suspension pour tous est réservée à l\'administrateur, au SCC et au directeur.',
  }, async (req, res) => res.status(201).json(await notifications.mute(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));
  r.delete('/actes/:id/notifications/sourdine/:muteId', { summary: 'Lève une sourdine', tags: T, org: true, params: PM },
    async (req, res) => res.json(await notifications.unmute(req.ctx, req.org.id, req.valid.params.id, req.valid.params.muteId)));
  r.post('/actes/:id/relance', {
    summary: 'Relancer maintenant (message personnalisé)', tags: T, org: true, params: PA, body: Remind,
    description: 'Directeur, SCC, DGS, administrateur. Passe outre la sourdine et la plage horaire.',
  }, async (req, res) => res.json(await notifications.remind(req.ctx, req.org.id, req.valid.params.id, req.valid.body)));

  // --- administration des règles
  r.get('/notifications/regles', { summary: 'Règles de notification en vigueur (plateforme + surcharges de l\'organisme)', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json(await notifications.listRules(req.org.id)));
  r.put('/notifications/regles/:code', {
    summary: 'Modifie une règle pour cet organisme (crée une surcharge)', tags: T, org: true, roles: ['org_admin'], params: PC, body: Rule,
    description: 'Destinataires (résolveurs) : redacteur, holders, delegues, circuit, acteurs, mentions, scc, admins, superieur, chef_service, directeur, dga, dgs, agent:<login>. Variables de gabarit : {titre} {numero} {etape} {lien} {redacteur} {acteur} {motif} {echeance} {retard}… Audité (avant/après).',
  }, async (req, res) => res.json(await notifications.putRule(req.ctx, req.org.id, req.valid.params.code, req.valid.body)));
  r.delete('/notifications/regles/:code', { summary: 'Supprime la surcharge : retour à la règle de la plateforme', tags: T, org: true, roles: ['org_admin'], params: PC },
    async (req, res) => res.json(await notifications.resetRule(req.ctx, req.org.id, req.valid.params.code)));
  r.post('/notifications/regles/:code/apercu', { summary: 'Prévisualise le gabarit d\'une règle', tags: T, org: true, roles: ADMIN, params: PC, body: PreviewB },
    async (req, res) => res.json(await notifications.preview(req.ctx, req.org.id, req.valid.params.code, req.valid.body)));
  r.post('/notifications/regles/:code/test', { summary: 'M\'envoie un mail de test', tags: T, org: true, roles: ADMIN, params: PC, body: PreviewB },
    async (req, res) => res.json(await notifications.sendTest(req.ctx, req.org.id, req.valid.params.code, req.valid.body)));
  r.post('/notifications/simulation', {
    summary: 'Simulateur : à la date D, qui recevrait quoi ?', tags: T, org: true, roles: ADMIN, params: P, body: SimB,
    description: 'Ne crée rien et n\'envoie rien : renvoie les relances qui seraient émises à cette date d\'après l\'état actuel des actes.',
  }, async (req, res) => res.json(await notifications.simulate(req.org.id, req.valid.body)));
  r.get('/notifications/journal', { summary: 'Journal des envois (filtrable)', tags: T, org: true, roles: ADMIN, params: P, query: JournalQ },
    async (req, res) => res.json(await notifications.journal(req.org.id, req.valid.query)));
  r.get('/notifications/tableau', { summary: 'Tableau de bord : envois, actes bloqués, valideurs en retard', tags: T, org: true, roles: ADMIN, params: P },
    async (req, res) => res.json(await notifications.dashboard(req.org.id)));

  // --- calendrier
  r.get('/calendrier/jours-feries', { summary: 'Jours fériés et fermetures (plateforme + organisme)', tags: ['calendrier'], org: true, params: P },
    async (req, res) => res.json(await notifications.listHolidays(req.org.id)));
  r.post('/calendrier/jours-feries', { summary: 'Ajoute un jour férié ou une fermeture', tags: ['calendrier'], org: true, roles: ['org_admin'], params: P, body: Holiday, responses: { 201: 'Créé' } },
    async (req, res) => res.status(201).json(await notifications.addHoliday(req.ctx, req.org.id, req.valid.body)));
  r.post('/calendrier/jours-feries/generer', { summary: 'Génère les jours fériés français d\'une année', tags: ['calendrier'], org: true, roles: ['org_admin'], params: P, body: Gen },
    async (req, res) => res.json(await notifications.generateHolidays(req.ctx, req.org.id, req.valid.body.year)));
  r.delete('/calendrier/jours-feries/:id', { summary: 'Supprime un jour férié de l\'organisme', tags: ['calendrier'], org: true, roles: ['org_admin'], params: PA, responses: { 204: 'Supprimé' } },
    async (req, res) => { await notifications.removeHoliday(req.ctx, req.org.id, req.valid.params.id); res.status(204).end(); });

  return [r];
};
