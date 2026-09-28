/**
 * Composition de l'application : assemble adaptateurs (ports), services et routes.
 * Les adaptateurs sont injectés : production = APM + Hub DSI ; tests = faux adaptateurs (aucun réseau).
 */
const { assertAuthPort, assertDirectoryPort, assertMailPort, assertAiPort, assertMeetingPort, assertBureauPort } = require('./ports');
const { createAudit } = require('./modules/audit/audit.service');
const { createAccess } = require('./modules/auth/access');
const { createSessions } = require('./modules/auth/sessions.repository');
const { createLoginGuard } = require('./modules/auth/login-guard');
const { createAuthService } = require('./modules/auth/auth.service');
const { createDirectoryService } = require('./modules/directory/directory.service');
const { createOrganigramme } = require('./modules/organigramme/organigramme.service');
const { createOrganismes } = require('./modules/organismes/organismes.service');
const { createSettings } = require('./modules/settings/settings.service');
const { createUploadLimit } = require('./shared/upload-limit');
const { createOnboarding } = require('./modules/me/onboarding.service');
const { createAmendements } = require('./modules/seances/amendements.service');
const { createEntrainement } = require('./modules/me/entrainement.service');
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
const { createDocs } = require('./modules/docs/docs.service');
const { createRgpd } = require('./modules/rgpd/rgpd.service');
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
const { createParcours } = require('./modules/seances/parcours.service');
const { createBibliotheque } = require('./modules/actes/bibliotheque.service');
const { createRelance } = require('./modules/seances/relance.service');
const { createSynthese } = require('./modules/seances/synthese.service');
const { createCalendrier } = require('./modules/seances/calendrier.service');
const { createKpis } = require('./modules/seances/kpis.service');
const { createTenue } = require('./modules/seances/tenue.service');
const { createPv } = require('./modules/seances/pv.service');
const { createGed } = require('./modules/ged/ged.service');
const { createChamps } = require('./modules/parametrage/champs.service');
const { createConfiguration } = require('./modules/parametrage/configuration.service');
const { createSauvegarde } = require('./modules/sauvegarde/sauvegarde.service');
const { createApiKeys } = require('./modules/externe/apikeys.service');
const { createExterne } = require('./modules/externe/externe.service');
const { createSms } = require('./adapters/sms');
const { createRecherche } = require('./modules/recherche/recherche.service');
const { createAlertes } = require('./modules/recherche/alertes.service');
const { createAnnotations } = require('./modules/espace-elus/annotations.service');
const { createGedSimulateur } = require('./adapters/ged-simulateur');
const { createAlfresco } = require('./adapters/alfresco');
const { createEluAuth } = require('./modules/espace-elus/elu-auth.service');
const { createEspaceElus } = require('./modules/espace-elus/espace.service');
const { createEluCalendrier } = require('./modules/espace-elus/elu-calendrier.service');
const { createTeletransmission } = require('./modules/teletransmission/tlt.service');
const { createParapheur } = require('./modules/parapheur/parapheur.service');
const { createDsihubParapheur } = require('./adapters/parapheur-dsihub');
const { createParapheurSimulateur } = require('./adapters/parapheur-simulateur');
const { createS2lowSimulateur } = require('./adapters/s2low-simulateur');
const { createApmO365 } = require('./adapters/apm-o365');
const { createCollecteurs } = require('./modules/collecteurs/collecteurs.service');
const { createOrganisation } = require('./modules/titulaires/organisation.service');
const { createConvocations } = require('./modules/convocations/convocations.service');
const { createUsers } = require('./modules/users/users.service');
const { createAi } = require('./modules/ai/ai.service');
const { createPrompts } = require('./modules/ai/prompts');
const { createAiQueue } = require('./modules/ai/queue');
const { createVisas } = require('./modules/ai/visas.service');
const { createAirs } = require('./modules/import-airs/airs.service');
const { createBureau } = require('./modules/bureau/bureau.service');
const { createTransitoire } = require('./shared/transitoire');
const { createBureauOnlyOffice } = require('./adapters/bureau-onlyoffice');
const { createBureauSimulateur } = require('./adapters/bureau-simulateur');
const { createBureauCollabora } = require('./adapters/bureau-collabora');

function buildContainer({ config, log, db, ad, directoryAdapter, mail, ai: aiAdapter, meeting, teletransmission, gedAdapters, smsHttp, sauvegardeTransport, guard, airsSource, parapheurAdapters, bureauAdapters }) {
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
  const uploadLimit = createUploadLimit({ settings, config });
  const onboarding = createOnboarding(db);
  const auth = createAuthService({ db, config, log, ad, dir, sessions, audit, guard: guard || createLoginGuard() });
  const bus = createBus(log);
  const transitoire = createTransitoire();
  // Bureau en ligne : un ou deux serveurs de documents, en services séparés. Le moteur par défaut est celui du `.env`
  // (BUREAU_MOTEUR) ; l'activation par organisme est un réglage (`bureau.edition_documents`), et le moteur qui ouvre
  // les documents en est un autre (`bureau.moteur`, choisi par l'administration). Sans moteur, l'adaptateur simulateur
  // garde le comportement d'aujourd'hui : dépôt manuel et conversion locale.
  const bureauPorts = bureauAdapters || {};
  if (!bureauAdapters) {
    bureauPorts.simulateur = createBureauSimulateur();
    if (config.bureau.url || config.bureau.moteur === 'onlyoffice') {
      bureauPorts.onlyoffice = createBureauOnlyOffice({ ...config.bureau, publicBaseUrl: config.publicBaseUrl, log, sources: (buffer, meta) => transitoire.mettre(buffer, meta) });
    }
    // Collabora n'existe que si son adresse navigateur est configurée : sinon il n'est pas proposé par l'administration.
    if (config.bureau.collaboraUrlNavigateur) {
      bureauPorts.collabora = createBureauCollabora({
        url: config.bureau.collaboraUrl, urlNavigateur: config.bureau.collaboraUrlNavigateur,
        publicBaseUrl: config.publicBaseUrl, langue: config.bureau.langue, log,
      });
    }
  }
  for (const impl of Object.values(bureauPorts)) assertBureauPort(impl);
  /** Moteur d'un organisme : son réglage s'il est déployé, sinon le moteur général du `.env`. */
  const portBureau = async (organismeId) => {
    const general = bureauPorts[config.bureau.moteur] || bureauPorts.simulateur;
    const nom = (await settings.resolve(organismeId))['bureau.moteur']?.value;
    return (nom && nom !== 'simulateur' && bureauPorts[nom]) || general;
  };
  // La conversion PDF emprunte le moteur de l'organisme : ONLYOFFICE rend le PDF au même titre qu'il édite, Collabora
  // n'ayant pas de convertisseur, c'est alors le repli LibreOffice qui produit le PDF (shared/convert.js).
  const bureauConversion = { versPdf: async (o) => (await portBureau(o.organismeId)).versPdf(o) };
  const late = {}; // services liés après coup pour éviter les dépendances circulaires (textes suivis, circuit…)
  const elus = createElus({ db, audit, directoryAdapter, log });
  late.elus = elus;
  const champs = createChamps({ db, audit, access });
  late.champs = champs;
  const refs = createReferentiels({ db, audit });
  const titulaires = createTitulaires({ db, audit, access });
  titulaires.setRhVacancy((d, sv) => dir.vacance(d, sv));
  titulaires.setDirectionGenerale(async (org) => (await dir.directionGenerale((await settings.resolve(org))['organisation.direction_generale']?.value))?.code ?? null);
  const redaction = createRedaction({ db, audit, access, titulaires, settings, bus });
  const acl = createActeAcl({ db, access, titulaires, settings });
  const actes = createActes({ db, audit, refs, redaction, dir, acl, bus, late, settings });
  const annexes = createAnnexes({ db, audit, storage, refs, actes, config, bus, uploadLimit, bureau: bureauConversion });
  bus.on('circuit.completed', (p) => annexes.finaliser(p.organismeId, p.acteId)); // validation finale : PDF des annexes Word/Excel
  const bureau = createBureau({ db, audit, actes, annexes, access, settings, ports: bureauPorts, config, transitoire, log, late });
  const comments = createComments({ db, audit, actes, acl, bus });
  const textes = createTextes({ db, audit, actes, acl, bus, storage, settings });
  late.texts = textes;
  const render = createRender({ db, audit, storage, refs, actes, textes, config, annexes, bureau, settings });
  const docs = createDocs({ render, config });
  const commissions = createCommissions({ db, audit, actes, acl, settings, bus, log, late });
  late.commissions = commissions;
  const seances = createSeances({ db, audit, actes, acl, settings, bus, late, meeting, log });
  late.seances = seances;
  const deadlines = createDeadlines({ db, audit, actes, acl, titulaires, settings, bus });
  late.deadlines = deadlines;
  const odj = createOdj({ db, audit, actes, acl, titulaires, settings, bus, late, storage, uploadLimit });
  late.odj = odj;
  const cahier = createCahier({ db, audit, render, odj, storage, log, bus });
  const kpis = createKpis({ db, odj, seances });
  const parcours = createParcours({ db, seances });
  const synthese = createSynthese({ db, kpis, parcours });
  const calendrier = createCalendrier({ db, audit, access, config });
  const tenue = createTenue({ db, audit, acl, access, seances, odj, bus });
  const pv = createPv({ db, audit, render, odj, tenue, actes, settings });
  const bibliotheque = createBibliotheque({ db, audit, render, pv, textes, storage });
  // télétransmission : le simulateur S²LOW tient lieu d'accès tant que le certificat n'est pas obtenu (D20, TLT-19) ; un adaptateur réel peut être injecté
  const tlt = createTeletransmission({ db, audit, actes, render, tenue, settings, storage, bus, adapter: teletransmission || createS2lowSimulateur({ db }), log, config, access, pv });
  acl.registerEditHook((ctx, a) => tlt.peutModifierTexte(ctx, a)); // le SCC modifie la délibération avant la transmission (TLT-32)
  const organisation = createOrganisation({ db, titulaires, dir });
  const organigramme = createOrganigramme({ db, dir, audit });
  const convocations = createConvocations({ db, audit, render, odj, seances, storage, mail, settings, config, log, dir });
  const aiQueue = createAiQueue({ db, settings, access, bus, log });
  const aiPrompts = createPrompts({ settings, ai: aiAdapter, log });
  const visas = createVisas({ db, audit, actes, settings, log });
  const ai = createAi({ db, audit, ai: aiAdapter, actes, textes, acl, log, queue: aiQueue, prompts: aiPrompts, visas, late });
  const users = createUsers({ db, audit, dir, organismes, access, log, settings, acl });
  const delegations = createDelegations({ db, audit, access, titulaires, dir, bus });
  const engine = createEngine({ db, audit, actes, acl, titulaires, delegations, comments, settings, bus, late });
  const circuits = createCircuits({ db, audit, engine, titulaires, bus });
  // parapheur : signature du maire pour les décisions et arrêtés (DSIHUB réel si configuré, sinon simulateur)
  const parapheur = createParapheur({ db, audit, actes, render, storage, bus, config, log, engine,
    adapters: parapheurAdapters || { dsihub: createDsihubParapheur({ tls: config.tls }), simulateur: createParapheurSimulateur() }, acl });
  bus.on('circuit.completed', (p) => parapheur.demanderEnvoiAuto(p.organismeId, p.acteId)); // fin de circuit d'un acte signé → envoi en signature
  const notifications = createNotifications({ db, audit, mail, engine, titulaires, delegations, settings, bus, config, log, actes, acl, late });
  const relance = createRelance({ db, audit, kpis, notifications, settings });
  // GED : simulateur persistant par défaut, Alfresco (REST v1) choisi par organisme ; adaptateurs injectables pour les tests
  const ged = createGed({ db, audit, config, log, adapters: gedAdapters || { simulateur: createGedSimulateur({ db }), alfresco: createAlfresco({ tls: config.tls }) }, render, tenue, pv, tlt, storage, cahier });
  storage.attach({ cible: (org) => ged.cibleStockage(org), ad: (org) => ged.adapteurLecture(org), dossier: (org, cible, categorie) => ged.dossierStockage(org, cible, categorie) }); // Alfresco comme stockage (GED-09)
  // pré-contrôle des références à l'entrée dans l'étape « Service juridique » (IA-37) : par le code, non bloquant, désactivable (ai.precontrole_juridique = false)
  bus.on('step.entered', async (p) => {
    if (p.stepKey !== 'juridique' || p.reassigned) return;
    if ((await settings.resolve(p.organismeId))['ai.precontrole_juridique']?.value === false) return;
    await ai.precontroleJuridique(p.organismeId, p.acteId);
  });
  bus.on('tlt.ar', (p) => (p.seanceId ? ged.auto(p) : null)); // l'AR reçu (XML, bordereau, acte tamponné) part en GED (TLT-35)
  bus.on('tenue.close', (p) => tlt.preparationAuto(p)); // préparation automatique des transmissions (TLT-33, désactivée par défaut)
  bus.on('tenue.close', (p) => ged.auto(p));
  bus.on('cahier.built', (p) => ged.auto(p)); // un cahier terminé part en GED sans attendre la clôture de la séance
  const sms = createSms({ db, config, settings, log, tls: config.tls, http: smsHttp });
  const eluAuth = createEluAuth({ db, config, mail, settings, audit, log, sms, ad });
  const espace = createEspaceElus({ db, audit, settings, render, tenue, storage, cahier, log, parapheur });
  // Ordre du jour arrêté (numérotation figée) → génère par avance les documents de l'espace élus (ELU-60, ELU-64).
  bus.on('odj.arrete', (p) => espace.figerDocumentsActe(p.organismeId, p.acteId, p.seanceId));
  // Contenu d'un acte modifié après l'arrêt de son ordre du jour : régénère par avance plutôt que d'attendre l'élu.
  bus.on('text.committed', (p) => espace.figerSiArrete(p.organismeId, p.acteId));
  const eluCalendrier = createEluCalendrier({ db, audit, espace, config });
  const annotations = createAnnotations({ db, audit, config, espace, settings });
  const amendements = createAmendements({ db, audit, tenue, textes });
  const entrainement = createEntrainement({ db, actes, textes, audit });
  const configuration = createConfiguration({ db, audit, settings, circuits, champs });
  const rgpd = createRgpd({ db, audit, config, settings });
  const recherche = createRecherche({ db, audit, acl, settings, storage, bus, log });
  late.recherche = recherche;
  const alertes = createAlertes({ db, access, recherche, log, notifications, config });
  const apiKeys = createApiKeys({ db, audit, log });
  const externe = createExterne({ db, render, storage });
  const sauvegarde = createSauvegarde({ db, audit, config, log, transport: sauvegardeTransport });
  const airs = createAirs({ db, audit, dir, source: airsSource, ad, storage }); // import de l'historique AIRS DELIB (section 25 bis, D111)
  // collecteurs d'arrêtés : moisson mail Graph / dossier, analyse IA, envoi en signature (parapheur) — créé après le parapheur, la messagerie et l'IA.
  const o365 = createApmO365(config);
  const collecteurs = createCollecteurs({ db, audit, settings, config, log, mail, ai: aiAdapter, prompts: aiPrompts, refs, storage, elus, parapheur, render, o365, engine, dir });
  bus.on('acte.document_signe', (p) => collecteurs.retourSigne(p.organismeId, p.acteId).catch((e) => log.warn({ acteId: p.acteId, err: e.message }, 'retour signé (collecteur) en erreur')));
  const scheduler = createScheduler({ db, notifications, config, log });
  scheduler.register('entrainement', (orgId) => entrainement.purger(orgId)); // purge des dossiers d'entraînement (UX-22)
  // sauvegarde nocturne (SAV-04) : plateforme entière, donc une seule fois par tick — portée par l'organisme par défaut
  scheduler.register('sauvegarde', async (orgId) => ((await db.get('SELECT is_default FROM organismes WHERE id = $1', [orgId]))?.is_default ? sauvegarde.siDue() : 0));
  scheduler.register('recherche-alertes', (orgId) => alertes.verifier(orgId)); // alertes de recherche (REC-29) : au plus une vérification par heure et par alerte
  scheduler.register('recherche', async (orgId) => (await recherche.balayer(orgId)).n); // rattrapage de l'index de recherche (REC-20)
  scheduler.register('collecteurs', (orgId) => collecteurs.runDt(orgId)); // collecteurs d'arrêtés : passages selon leur intervalle (1h/4h/24h)
  scheduler.register('teletransmission', async (orgId) => { const r = await tlt.suivre(orgId); return r.statuts + r.documents; }); // suivi périodique des statuts S²LOW (TLT-07)
  return { relance, synthese, calendrier, bibliotheque, parcours, visas, config, log, db, ad, directoryAdapter, mail, aiAdapter, meeting, audit, access, sessions, dir, organismes, settings, uploadLimit, onboarding, auth, bus, storage, late, refs, titulaires, redaction, acl, actes, annexes, bureau, comments, textes, render, docs, delegations, engine, circuits, notifications, scheduler, elus, commissions, seances, deadlines, odj, cahier, kpis, tenue, pv, tlt, ged, recherche, annotations, champs, configuration, rgpd, entrainement, amendements, sms, sauvegarde, apiKeys, externe, alertes, eluAuth, espace, eluCalendrier, organisation, organigramme, convocations, users, ai, aiQueue, aiPrompts, airs, parapheur, collecteurs, bureauPorts };
}

module.exports = { buildContainer };
