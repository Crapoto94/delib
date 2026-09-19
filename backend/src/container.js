/**
 * Composition de l'application : assemble adaptateurs (ports), services et routes.
 * Les adaptateurs sont injectés : production = APM + Hub DSI ; tests = faux adaptateurs (aucun réseau).
 */
const { assertAuthPort, assertDirectoryPort, assertMailPort } = require('./ports');
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
const { createUsers } = require('./modules/users/users.service');

function buildContainer({ config, log, db, ad, directoryAdapter, mail, guard }) {
  assertAuthPort(ad);
  assertMailPort(mail);
  assertDirectoryPort(directoryAdapter);
  const audit = createAudit(db);
  const access = createAccess(db);
  const sessions = createSessions(db);
  const dir = createDirectoryService({ db, adapter: directoryAdapter, config, log });
  const organismes = createOrganismes({ db, audit });
  const settings = createSettings({ db, audit });
  const onboarding = createOnboarding(db);
  const auth = createAuthService({ db, config, log, ad, dir, sessions, audit, guard: guard || createLoginGuard() });
  const bus = createBus(log);
  const storage = createStorage(config);
  const late = {}; // services liés après coup pour éviter les dépendances circulaires (textes suivis, circuit…)
  const elus = createElus({ db, audit, directoryAdapter, log });
  late.elus = elus;
  const refs = createReferentiels({ db, audit });
  const titulaires = createTitulaires({ db, audit, access });
  const redaction = createRedaction({ db, audit, access, titulaires, settings, bus });
  const acl = createActeAcl({ db, access, titulaires, settings });
  const actes = createActes({ db, audit, refs, redaction, dir, acl, bus, late });
  const annexes = createAnnexes({ db, audit, storage, refs, actes, config, bus });
  const comments = createComments({ db, audit, actes, acl, bus });
  const textes = createTextes({ db, audit, actes, acl, bus });
  late.texts = textes;
  const render = createRender({ db, audit, storage, refs, actes, textes, config });
  const commissions = createCommissions({ db, audit, actes, acl, settings, bus, log });
  late.commissions = commissions;
  const seances = createSeances({ db, audit, actes, acl, settings, bus, late });
  late.seances = seances;
  const deadlines = createDeadlines({ db, audit, actes, acl, titulaires, settings, bus });
  late.deadlines = deadlines;
  const odj = createOdj({ db, audit, actes, acl, titulaires, settings, bus, late });
  late.odj = odj;
  const users = createUsers({ db, audit, dir, organismes, access, log });
  const delegations = createDelegations({ db, audit, access, titulaires, dir, bus });
  const engine = createEngine({ db, audit, actes, acl, titulaires, delegations, comments, settings, bus, late });
  const circuits = createCircuits({ db, audit, engine, titulaires, bus });
  const notifications = createNotifications({ db, audit, mail, engine, titulaires, delegations, settings, bus, config, log, actes, acl, late });
  const scheduler = createScheduler({ db, notifications, config, log });
  return { config, log, db, ad, directoryAdapter, mail, audit, access, sessions, dir, organismes, settings, onboarding, auth, bus, storage, late, refs, titulaires, redaction, acl, actes, annexes, comments, textes, render, delegations, engine, circuits, notifications, scheduler, elus, commissions, seances, deadlines, odj, users };
}

module.exports = { buildContainer };
