const { z } = require('zod');
const { E } = require('../../shared/errors');

const SearchQuery = z.object({ q: z.string().trim().min(2, 'au moins 2 caractères').max(100) });
const UserParams = z.object({ username: z.string().trim().min(1).max(128) });

/** Annuaire commun à tous les organismes (agents, directions, services), derrière le DirectoryPort. */
module.exports = ({ makeRouter, dir }) => {
  const r = makeRouter('/api/v1/directory');

  r.get('/directions', {
    summary: 'Directions et services (organigramme RH)', tags: ['annuaire'],
    description: "Source : organigramme RH du Hub DSI (codes et libellés). Sert notamment à rattacher les directions à un organisme. Mis en cache ; une panne du Hub sert le dernier organigramme connu.",
  }, async (req, res) => res.json({ items: await dir.directions() }));

  r.get('/organisation', {
    summary: 'Organigramme avec responsables (suggestion pour la table des titulaires)', tags: ['annuaire'], platform: true,
    description: "Directions et services avec leur responsable et leur poste, tels que connus des RH. Ne sert qu'à PROPOSER des titulaires (CIR-25) : la saisie reste manuelle.",
  }, async (req, res) => res.json({ items: await dir.organisationChart() }));

  r.get('/agents/search', { summary: 'Recherche un agent (nom, prénom, matricule, e-mail)', tags: ['annuaire'], query: SearchQuery },
    async (req, res) => res.json({ items: await dir.searchAgents(req.valid.query.q) }));

  r.get('/agents/noms', { summary: "« Prénom NOM » d'une liste d'identifiants de connexion", tags: ['annuaire'], query: z.object({ u: z.string().max(4000).describe('Identifiants séparés par des virgules (200 au plus)') }),
    description: "Sert à afficher les personnes par leur nom plutôt que par leur identifiant. Les identifiants inconnus sont absents de la réponse." },
  async (req, res) => res.json({ noms: await dir.names(req.valid.query.u.split(',')) }));
  r.get('/agents/autocompletion', { summary: 'Autocomplétion « @nom » : identifiant de connexion, nom, direction', tags: ['annuaire'], query: SearchQuery,
    description: 'Deux lettres au moins. Renvoie l\'identifiant à utiliser partout où un agent doit être désigné (titulaires, groupes, délégations, rôles, mentions).' },
  async (req, res) => res.json({ items: await dir.searchLogins(req.valid.query.q) }));

  r.get('/agents/:username', {
    summary: "Fiche d'un agent connu de l'application (cache)", tags: ['annuaire'], params: UserParams,
    description: "Un agent n'apparaît qu'après sa première connexion ; pour un agent jamais connecté, utiliser la recherche.",
  }, async (req, res) => {
    const a = await dir.getAgent(req.valid.params.username);
    if (!a) throw E.notFound('Agent inconnu (jamais connecté à VibeDélib)');
    res.json({ ...a, poste: await dir.posteAffiche({ displayName: a.displayName, nom: a.nom, prenom: a.prenom, direction: a.direction?.label, service: a.service, poste: a.poste }) });
  });

  return [r];
};
