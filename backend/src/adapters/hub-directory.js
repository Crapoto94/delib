/**
 * Adaptateur DirectoryPort — annuaire COMMUN des agents, via l'API métier Hub DSI (clé dsk_, en-tête X-API-Key).
 * Vérifié par le spike du lot 0 (docs/spike-lot0.md) :
 *   GET /api/admin/rh/services-tree         directions -> services (code + libellé), source RH SIIM
 *   GET /api/admin/rh/organisation-chart    idem avec responsable, poste, vacance
 *   GET /api/infra/rh-studio/agents/search  agents (username, displayName, email, service, direction, poste, matricule, hasAd)
 *   GET /api/infra/agents/presence?email=   fiche exacte { found, agent }
 * Attention : /api/directions-services n'est PAS l'organigramme (liste dérivée des réunions) — non utilisé.
 * La fiche agent renvoie la direction en LIBELLÉ : la résolution libellé -> code se fait dans le service d'annuaire.
 */
const { createHttpClient, call, asList } = require('./http-client');
const { E } = require('../shared/errors');

const clean = (s) => (typeof s === 'string' ? s.trim() : s);
// les codes commençant par « $ » sont des placeholders SIIM à ignorer
const isReal = (code) => typeof code === 'string' && code.trim() !== '' && !code.trim().startsWith('$');

function createHubDirectory(config) {
  const http = createHttpClient({ baseURL: config.hub.url, headers: { 'X-API-Key': config.hub.key }, tls: config.tls });

  async function get(service, url, params) {
    const r = await call(service, () => http.get(url, { params }));
    if (r.status === 401 || r.status === 403) throw E.upstream(`${service} : HTTP ${r.status} (clé dsk_ ou scope insuffisant ?)`);
    if (r.status !== 200) throw E.upstream(`${service} : HTTP ${r.status}`);
    return r.data;
  }

  const mapNode = (n) => ({
    code: clean(n.code), label: clean(n.label),
    responsable: n.responsable ?? null, poste: n.responsable_poste ?? null, vacant: !!n.vacant,
    services: asList(n.services).filter((s) => isReal(s.code)).map((s) => ({
      code: clean(s.code), label: clean(s.label), responsable: s.responsable ?? null, poste: s.responsable_poste ?? null, vacant: !!s.vacant,
    })),
  });

  return {
    async listDirections() {
      const d = await get('Hub services-tree', '/api/admin/rh/services-tree');
      return asList(d).filter((x) => isReal(x.code)).map((x) => ({
        code: clean(x.code), label: clean(x.label),
        services: asList(x.services).filter((s) => isReal(s.code)).map((s) => ({ code: clean(s.code), label: clean(s.label) })),
      }));
    },

    async getOrganisationChart() {
      const d = await get('Hub organisation-chart', '/api/admin/rh/organisation-chart');
      return asList(d).filter((x) => isReal(x.code)).map(mapNode);
    },

    async searchAgents(q) {
      const d = await get('Hub rh-studio/agents/search', '/api/infra/rh-studio/agents/search', { q });
      return asList(d).map((a) => ({
        username: String(a.username || '').toLowerCase() || null,
        displayName: a.displayName || null, email: (a.email || '').toLowerCase() || null,
        service: clean(a.service) || null, direction: clean(a.direction) || null,
        poste: clean(a.poste) || null, matricule: a.matricule ?? null, hasAd: !!a.hasAd,
      }));
    },

    async getAgentByEmail(email) {
      const d = await get('Hub agents/presence', '/api/infra/agents/presence', { email });
      if (!d?.found || !d.agent) return null;
      const a = d.agent;
      return {
        nom: a.nom || null, prenom: a.prenom || null, email: (a.email || email).toLowerCase(),
        matricule: a.matricule ?? null, service: clean(a.service) || null, direction: clean(a.direction) || null,
        fonction: clean(a.fonction) || null, present: a.present !== false,
      };
    },

    /** Élus de la Ville (GET /api/ville/elus) : identité seulement ; groupe politique et mandat sont saisis localement (CMN-02). */
    async listElus() {
      const d = await get('Hub ville/elus', '/api/ville/elus');
      return asList(d, 'elus').map((e) => ({
        externalId: String(e.id ?? e.email ?? `${e.nom}-${e.prenom}`),
        nom: clean(e.nom) || '', prenom: clean(e.prenom) || '', email: (clean(e.email) || '').toLowerCase() || null,
        telephone: clean(e.telephone) || null, role: clean(e.role) || null, delegation: clean(e.delegation) || null,
        civilite: clean(e.civilite ?? e.sexe ?? e.genre ?? e.civ) || null,
      })).filter((e) => e.nom);
    },

    async ping() {
      const t = Date.now();
      await get('Hub ville/config', '/api/ville/config');
      return Date.now() - t;
    },
  };
}

module.exports = { createHubDirectory };
