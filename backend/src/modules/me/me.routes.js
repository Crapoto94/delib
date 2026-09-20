const { z } = require('zod');

const TourParams = z.object({ tourId: z.string().regex(/^[a-z0-9-]{1,60}$/) });
const TourBody = z.object({
  version: z.number().int().min(1),
  status: z.enum(['started', 'completed', 'skipped']),
  stepsDone: z.array(z.string().max(80)).max(200).optional(),
});

const Id = z.coerce.number().int().positive();

module.exports = ({ makeRouter, dir, onboarding, entrainement }) => {
  const r = makeRouter('/api/v1/me');

  r.get('/', {
    summary: "Profil de l'utilisateur connecté", tags: ['me'],
    description: "Identité, fiche agent (direction, service, poste), organismes accessibles avec leurs rôles, et tutoriels à proposer (`onboarding.toShow`, dont la visite de première connexion).",
  }, async (req, res) => {
    const c = req.ctx; const real = req.realCtx || req.ctx;
    const def = c.organismes.find((o) => o.isDefault) || c.organismes[0] || null;
    const agent = dir.toAgent(c.agent);
    // intitulé de poste officiel (organigramme RH) pour un responsable de direction ou de service
    if (agent) agent.poste = await dir.posteAffiche({ displayName: agent.displayName, nom: agent.nom, prenom: agent.prenom, direction: agent.direction?.label, service: agent.service, poste: agent.poste });
    res.json({
      username: c.username, displayName: c.displayName, email: c.email, kind: c.kind, isPlatformAdmin: c.isPlatformAdmin,
      agent: agent || null,
      organismes: c.organismes.map((o) => ({ id: o.id, code: o.code, nom: o.nom, type: o.type, isDefault: o.isDefault, roles: o.roles, via: o.via, vocabulaire: o.vocabulaire, hasLogo: !!o.hasLogo, logoVersion: o.logoVersion ?? null })),
      defaultOrganismeId: def?.id ?? null,
      onboarding: { toShow: await onboarding.toShow(c.username) },
      impersonation: c.impersonatedBy ? { by: c.impersonatedBy } : null,
      canImpersonate: real.isPlatformAdmin || real.roles.some((r) => ['org_admin', 'scc'].includes(r.role)),
    });
  });

  r.get('/context', {
    summary: "Contexte d'organisme (en-tête X-Organisme-Id)", tags: ['me'], org: true,
    description: "Illustre le mécanisme utilisé par les modules suivants : l'organisme est fourni par l'en-tête `X-Organisme-Id` et l'accès est vérifié côté serveur.",
  }, (req, res) => res.json({ organisme: req.org, roles: req.orgRoles }));

  r.get('/onboarding', { summary: 'Avancement des tutoriels', tags: ['me'] },
    async (req, res) => res.json({ tours: await onboarding.list(req.ctx.username) }));

  r.put('/onboarding/:tourId', {
    summary: "Enregistre l'avancement d'un tutoriel (commencé, terminé, ignoré)", tags: ['me'], params: TourParams, body: TourBody,
    description: "Un tutoriel terminé ou ignoré à la version courante n'est plus proposé ; une version plus récente le repropose.",
  }, async (req, res) => res.json(await onboarding.update(req.ctx.username, req.valid.params.tourId, req.valid.body)));

  r.get('/onboarding-stats', { summary: 'Mesure anonymisée des tutoriels : taux de complétion, étapes atteintes, étapes d’abandon', tags: ['me'], platform: true },
    async (req, res) => res.json({ tours: await onboarding.stats() }));

  // dossier d'entraînement : bac à sable de la visite guidée (UX-22)
  const o = makeRouter('/api/v1/organismes/:orgId');
  o.post('/entrainement', {
    summary: 'Crée (ou retrouve) mon dossier d’entraînement : un brouillon d’exemple qui ne part jamais dans un vrai circuit', tags: ['me'], org: true, params: z.object({ orgId: Id }), responses: { 201: 'Créé' },
    description: 'Rédaction, suivi des modifications, assistant IA et commentaires fonctionnent ; l’envoi au circuit est refusé, le dossier n’entre pas dans la recherche et se purge au bout de 14 jours.',
  }, async (req, res) => { const r = await entrainement.creer(req.ctx, req.org.id); res.status(r.cree ? 201 : 200).json(r); });

  return [r, o];
};
