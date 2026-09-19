/**
 * Ports (architecture « ports et adaptateurs », manifeste §24) : le cœur métier ne parle qu'à ces contrats.
 * Chaque commune fournit ses adaptateurs ; ceux de la Ville sont dans src/adapters (APM, Hub DSI).
 *
 * AuthPort (annuaire d'authentification) :
 *   authenticate(username, password) -> { ok: boolean }        (lève AppError 502 si le service est indisponible)
 *   getUser(identifier)              -> { username, displayName, givenName, surname, email } | null
 *   searchUsers(q)                   -> [{ username, displayName, email }]
 *   ping()                           -> millisecondes
 *
 * DirectoryPort (agents, directions, services — annuaire COMMUN à tous les organismes) :
 *   listDirections()        -> [{ code, label, services: [{ code, label }] }]
 *   getOrganisationChart()  -> [{ code, label, responsable, poste, vacant, services: [...] }]
 *   searchAgents(q)         -> [{ username, displayName, email, service, direction, poste, matricule, hasAd }]
 *   getAgentByEmail(email)  -> { nom, prenom, email, matricule, service, direction, fonction, present } | null
 *   ping()                  -> millisecondes
 */
const AUTH_METHODS = ['authenticate', 'getUser', 'searchUsers', 'ping'];
const DIRECTORY_METHODS = ['listDirections', 'getOrganisationChart', 'searchAgents', 'getAgentByEmail', 'ping'];

const MAIL_METHODS = ['send'];
const AI_METHODS = ['query'];
const MEETING_METHODS = ['available', 'create', 'update', 'cancel'];

function assertPort(name, impl, methods) {
  const missing = methods.filter((m) => typeof impl?.[m] !== 'function');
  if (missing.length) throw new Error(`Adaptateur ${name} incomplet : méthodes manquantes (${missing.join(', ')})`);
  return impl;
}

module.exports = {
  assertAuthPort: (impl) => assertPort('AuthPort', impl, AUTH_METHODS),
  assertDirectoryPort: (impl) => assertPort('DirectoryPort', impl, DIRECTORY_METHODS),
  assertMeetingPort: (impl) => assertPort('MeetingPort', impl, MEETING_METHODS),
  assertAiPort: (impl) => assertPort('AiPort', impl, AI_METHODS),
  assertMailPort: (impl) => assertPort('MailPort', impl, MAIL_METHODS),
};
