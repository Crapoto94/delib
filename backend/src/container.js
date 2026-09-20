/**
 * Composition de l'application : assemble adaptateurs (ports), services et routes.
 * Les adaptateurs sont injectés : production = APM + Hub DSI ; tests = faux adaptateurs (aucun réseau).
 */
const { assertAuthPort, assertDirectoryPort, assertMailPort, assertAiPort, assertMeetingPort } = require('./ports');
const { createAudit } = require('./modules/audit/audit.service');
const { createAccess } = require('./modules/auth/access');
const { createSessions } = require('./modules/auth/sessions.repository');
const { createLoginGuard } = require('./modules/auth/login-guard');
const { createAuthService } = require('./modules/auth/auth.service');
const { createDirectoryService } = require('./modules/directory/directory.service');
const { createOrganismes } = require('./modules/organismes/organismes.service');
const { createSettings } = require('./modules/settings/settings.service');
const { createOnboarding } = require('./modules/me/onboarding.service');
const { createBus, createStorage } = require('./shared/infra');
const { createReferentiels } = require('./modules/referentiels/referentiels.service');
const { createTitulaires } = require('./modules/titulaires/titulaires.service');
const { createRedaction } = require('./modules/redaction/redaction.service');
const { createActeAcl } = require('./modules/actes/acl');
const { createActes } = require('./modules/actes/actes.service');
const { createAnnexes } = require('./modules/annexes/annexes.service');
const { createComments } = require('./modules/comments/comments.service');
const { createTextes } = require('./modules/textes/textes.service');
const { createRender } = require('./modules/render/render.service');
const { createDelegations } = require('./modules/circuit/delegations.service');
const { createEngine } = require('./modules/circuit/engine');
const { createCircuits } = require('./modules/circuit/circuits.service');
const { createNotifications } = require('./modules/notifications/notifications.service');
const { createScheduler } = require('./modules/notifications/scheduler');
const { createElus } = require('./modules/elus/elus.service');
const { createCommissions } = require('./modules/commissions/commissions.service');
const { createSeances } = require('./modules/seances/seances.service');
const { createDeadlines } = require('./modules/seances/deadlines.service');
const { createOdj } = require('./modules/seances/odj.service');
const { createCahier } = require('./modules/seances/cahier.service');
const { createKpis } = require('./modules/seances/kpis.service');
const { createTenue } = require('./modules/seances/tenue.service');
const { createPv } = require('./modules/seances/pv.service');
const { createGed } = require('./modules/ged/ged.service');
const { createRecherche } = require('./modules/recherche/recherche.service');
const { createGedSimulateur } = require('./adapters/ged-simulateur');
const { createAlfresco } = require('./adapters/alfresco');
const { createEluAuth } = require('./modules/espace-elus/elu-auth.service');
const { createEspaceElus } = require('./modules/espace-elus/espace.service');
const { createTeletransmission } = require('./modules/teletransmission/tlt.service');
const { createS2lowSimulateur } = require('./adapters/s2low-simulateur');
const { createOrganisation } = require('./modules/titulaires/organisation.service');
const { createConvocations } = require('./modules/convocations/convocations.service');
const { createUsers } = require('./modules/users/users.service');
const { createAi } = require('./modules/ai/ai.service');
const { createPrompts } = require('./modules/ai/prompts');
const { createAiQueue } = require('./modules/ai/queue');

function buildContainer({ config, log, db, ad, directoryAdapter, mail, ai: aiAdapter, meeting, teletransmission, gedAdapters, guard }) {
  assertAuthPort(ad);
  assertMailPort(mail);
  assertAiPort(aiAdapter);
  assertMeetingPort(meeting);
  assertDirectoryPort(directoryAdapter);
  const audit = createAudit(db);
  const access = createAccess(db);
  const sessions = createSessions(db);
  const dir = createDirectoryService({ db, adapter: directoryAdapter, ad, config, log });
  const storage = createStorage(config);
  const organismes = createOrganismes({ db, audit, storage });
  const settings = createSettings({ db, audit });
  const onboarding = createOnboarding(db);
  const auth = createAuthService({ db, config, log, ad, dir, sessions, audit, guard: guard || createLoginGuard() });
  const bus = createBus(log);
  const late = {}; // services liés après coup pour éviter les dépendances circulaires (textes suivis, circuit…)
  const elus = createElus({ db, audit, directoryAdapter, log });
  late.elus = elus;
  const refs = createReferentiels({ db, audit });
  const titulaires = createTitulaires({ db, audit, access });
  titulaires.setRhVacancy((d, sv) => dir.vacance(d, sv));
  titulaires.setDirectionGenerale(async (org) => (await dir.directionGenerale((await settings.resolve(org))['organisation.direction_generale']?.value))?.code ?? null);
  const redaction = createRedaction({ db, audit, access, titulaires, settings, bus });
  const acl = createActeAcl({ db, access, titulaires, settings });
  const actes = createActes({ db, audit, refs, redaction, dir, acl, bus, late });
  const annexes = createAnnexes({ db, audit, storage, refs, actes, config, bus });
  const comments = createComments({ db, audit, actes, acl, bus });
  const textes = createTextes({ db, audit, actes, acl, bus });
  late.texts = textes;
  const render = createRender({ db, audit, storage, refs, actes, textes, config });
  const commissions = createCommissions({ db, audit, actes, acl, settings, bus, log, late });
  late.commissions = commissions;
  const seances = createSeances({ db, audit, actes, acl, settings, bus, late, meeting, log });
  late.seances = seances;
  const deadlines = createDeadlines({ db, audit, actes, acl, titulaires, settings, bus });
  late.deadlines = deadlines;
  const odj = createOdj({ db, audit, actes, acl, titulaires, settings, bus, late, storage });
  late.odj = odj;
  const cahier = createCahier({ db, audit, render, odj, storage, log });
  const kpis = createKpis({ db, odj, seances });
  const tenue = createTenue({ db, audit, acl, access, seances, odj, bus });
  const pv = createPv({ db, audit, render, odj, tenue, actes });
  // télétransmission : le simulateur S²LOW tient lieu d'accès tant que le certificat n'est pas obtenu (D20, TLT-19) ; un adaptateur réel peut être injecté
  const tlt = createTeletransmission({ db, audit, actes, render, tenue, settings, storage, bus, adapter: teletransmission || createS2lowSimulateur({ db }), log, config });
  const organisation = createOrganisation({ db, titulaires, dir });
  const convocations = createConvocations({ db, audit, render, odj, seances, storage, mail, settings, config, log, dir });
  const aiQueue = createAiQueue({ db, settings, access, bus, log });
  const aiPrompts = createPrompts({ settings, ai: aiAdapter, log });
  const ai = createAi({ db, audit, ai: aiAdapter, actes, textes, acl, log, queue: aiQueue, prompts: aiPrompts });
  const users = createUsers({ db, audit, dir, organismes, access, log, settings, acl });
  const delegations = createDelegations({ db, audit, access, titulaires, dir, bus });
  const engine = createEngine({ db, audit, actes, acl, titulaires, delegations, comments, settings, bus, late });
  const circuits = createCircuits({ db, audit, engine, titulaires, bus });
  const notifications = createNotifications({ db, audit, mail, engine, titulaires, delegations, settings, bus, config, log, actes, acl, late });
  // GED : simulateur persistant par défaut, Alfresco (REST v1) choisi par organisme ; adaptateurs injectables pour les tests
  const ged = createGed({ db, audit, config, log, adapters: gedAdapters || { simulateur: createGedSimulateur({ db }), alfresco: createAlfresco({ tls: config.tls }) }, render, tenue, pv, tlt, storage, cahier });
  bus.on('tenue.close', (p) => ged.auto(p));
  const eluAuth = createEluAuth({ db, config, mail, settings, audit, log });
  const espace = createEspaceElus({ db, audit, settings, render, tenue, storage, cahier, log });
  const recherche = createRecherche({ db, audit, acl, settings, storage, bus, log });
  const scheduler = createScheduler({ db, notifications, config, log });
  scheduler.register('recherche', async (orgId) => (await recherche.balayer(orgId)).n); // rattrapage de l'index de recherche (REC-20)
  scheduler.register('teletransmission', async (orgId) => { const r = await tlt.suivre(orgId); return r.statuts + r.documents; }); // suivi périodique des statuts S²LOW (TLT-07)
  return { config, log, db, ad, directoryAdapter, mail, aiAdapter, meeting, audit, access, sessions, dir, organismes, settings, onboarding, auth, bus, storage, late, refs, titulaires, redaction, acl, actes, annexes, comments, textes, render, delegations, engine, circuits, notifications, scheduler, elus, commissions, seances, deadlines, odj, cahier, kpis, tenue, pv, tlt, ged, recherche, eluAuth, espace, organisation, convocations, users, ai, aiQueue, aiPrompts };
}

module.exports = { buildContainer };
