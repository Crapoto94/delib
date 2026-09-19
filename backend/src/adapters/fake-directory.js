/**
 * Adaptateurs de remplacement (développement et tests) : aucune dépendance réseau, aucun identifiant réel.
 * Utilisés par les tests d'intégration et par le mode « sans APM » de développement.
 */
function createFakeAuth({ users = {}, failing = false } = {}) {
  // users : { 'dupont': { password, displayName, email } }
  const state = { failing, calls: 0 };
  return {
    state,
    async authenticate(username, password) {
      state.calls++;
      if (state.failing) { const { E } = require('../shared/errors'); throw E.upstream('AD indisponible (simulé)'); }
      const u = users[String(username).toLowerCase()];
      return { ok: !!u && u.password === password };
    },
    async getUser(identifier) {
      const key = String(identifier).toLowerCase();
      const u = users[key] || Object.entries(users).find(([, v]) => v.email === key)?.[1];
      const name = users[key] ? key : Object.entries(users).find(([, v]) => v === u)?.[0];
      if (!u) return null;
      return { username: name, displayName: u.displayName || name, givenName: null, surname: null, email: u.email || null };
    },
    async searchUsers(q) {
      return Object.entries(users).filter(([n]) => n.includes(String(q).toLowerCase()))
        .map(([n, u]) => ({ username: n, displayName: u.displayName || n, email: u.email || null }));
    },
    async ping() { return 1; },
  };
}

function createFakeDirectory({ directions = [], agents = [], elus = [], failing = false } = {}) {
  // agents : [{ username, displayName, email, service, direction (libellé), poste, matricule }]
  const state = { failing, calls: 0 };
  const guard = () => { state.calls++; if (state.failing) { const { E } = require('../shared/errors'); throw E.upstream('Annuaire indisponible (simulé)'); } };
  return {
    state,
    async listDirections() { guard(); return directions; },
    async listElus() { guard(); return elus; },
    async getOrganisationChart() { guard(); return directions.map((d) => ({ ...d, responsable: null, poste: null, vacant: false })); },
    async searchAgents(q) {
      guard();
      const s = String(q).toLowerCase();
      return agents.filter((a) => [a.username, a.displayName, a.email].some((v) => String(v || '').toLowerCase().includes(s)))
        .map((a) => ({ ...a, hasAd: true }));
    },
    async getAgentByEmail(email) {
      guard();
      const a = agents.find((x) => x.email === String(email).toLowerCase());
      return a ? { nom: a.displayName, prenom: null, email: a.email, matricule: a.matricule ?? null, service: a.service, direction: a.direction, fonction: a.poste, present: true } : null;
    },
    async ping() { guard(); return 1; },
  };
}

module.exports = { createFakeAuth, createFakeDirectory };

/** MailPort de remplacement : garde les messages en mémoire (tests, développement sans APM). `failNext(n)` simule une panne. */
function createFakeMail() {
  const state = { sent: [], failures: 0 };
  return {
    state,
    failNext(n = 1) { state.failures = n; },
    async send(message) {
      if (state.failures > 0) { state.failures--; const { E } = require('../shared/errors'); throw E.upstream('APM mail indisponible (simulé)'); }
      state.sent.push({ ...message, at: new Date() });
      return { ok: true };
    },
    async ping() { return 1; },
  };
}
module.exports.createFakeMail = createFakeMail;
