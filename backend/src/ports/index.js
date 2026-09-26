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
 *
 * BureauPort (« bureau en ligne » : éditer un document Office dans le navigateur, sans Word sur le poste) :
 *   capabilities()                    -> { enabled, formats: ['docx', 'xlsx', …], mobile, moteur }
 *   open({ cle, nom, mime, url, user, mobile }) -> { sdk?, src?, config? }   // ce que le navigateur charge
 *   verifyCallback(req)              -> { ok, payload, jeton }             // authentifie le rappel du moteur
 *   readBack({ url, filetype, jeton })-> { buffer, ext } | null            // relit le document renvoyé
 *   forcerSauvegarde(cle)            -> bool                               // demande au moteur d'enregistrer maintenant
 *   versPdf({ buffer, ext })         -> { buffer, moteur } | null           // conversion PDF mutualisée
 * La `cle` est l'identité du aller-retour (`annexe:<id>:v<version>:<auteur>:<nonce>`) : elle porte l'auteur, la version
 * attendue et la clé de session du moteur. Le port ne fait que le transport ; les droits, la version, l'audit et le PDF
 * restent dans le module `bureau` et le module `annexes`.
 */
const AUTH_METHODS = ['authenticate', 'getUser', 'searchUsers', 'ping'];
const DIRECTORY_METHODS = ['listDirections', 'getOrganisationChart', 'searchAgents', 'getAgentByEmail', 'ping'];

const MAIL_METHODS = ['send'];
const AI_METHODS = ['query'];
const MEETING_METHODS = ['available', 'create', 'update', 'cancel'];
const BUREAU_METHODS = ['capabilities', 'open', 'verifyCallback', 'readBack', 'forcerSauvegarde', 'versPdf'];

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
  assertBureauPort: (impl) => assertPort('BureauPort', impl, BUREAU_METHODS),
};
