/**
 * Aides de test. Les tests d'intégration tournent sur une VRAIE base PostgreSQL (celle du .env) mais dans un schéma
 * JETABLE propre à chaque fichier de test (vibedelib_test_<aléa>), supprimé à la fin. Le schéma applicatif réel n'est
 * jamais touché : chaque suppression est précédée d'un contrôle du préfixe.
 * Les services externes (AD/APM, Hub) sont remplacés par de faux adaptateurs : aucun réseau, aucun identifiant réel.
 */
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const { buildConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { buildContainer } = require('../src/container');
const { createApp } = require('../src/http/app');
const { bootstrap } = require('../src/bootstrap');
const { createFakeAuth, createFakeDirectory, createFakeMail, createFakeAi, createFakeMeeting } = require('../src/adapters/fake-directory');

const PREFIX = 'vibedelib_test_';

function testConfig(schema, overrides = {}) {
  return buildConfig({
    ...process.env,
    NODE_ENV: 'test',
    DB_SCHEMA: schema,
    DB_POOL_MAX: '3',
    JWT_SECRET: 'secret-de-test-au-moins-24-caracteres',
    JWT_TTL: '1h',
    SESSION_MAX_HOURS: '24',
    BOOTSTRAP_ADMINS: 'boot',
    LOCAL_ADMIN_ENABLED: 'true',
    LOCAL_ADMIN_USERNAME: 'secours',
    LOCAL_ADMIN_PASSWORD: 'mot-de-passe-de-secours-123',
    RLS_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    STORAGE_DIR: require('path').join(require('os').tmpdir(), 'vibedelib-test-' + process.pid),
    CORS_ORIGINS: 'http://localhost:5160',
    DIRECTORY_CACHE_TTL_MIN: '60',
    ...overrides,
  });
}

/** Jeu d'annuaire standard : deux directions (Ville, CCAS), quelques agents. */
const DIRECTIONS = [
  { code: 'A1', label: 'DIRECTION DES FINANCES', services: [{ code: 'A1a', label: 'BUDGET' }, { code: 'A1b', label: 'COMPTABILITÉ' }] },
  { code: 'J', label: 'DIRECTION CCAS', services: [{ code: 'Ja', label: 'AIDE SOCIALE' }] },
];
const USERS = {
  dupont: { password: 'pw-dupont', displayName: 'Dupont Alice', email: 'alice.dupont@ivry.test' },
  martin: { password: 'pw-martin', displayName: 'Martin Bruno', email: 'bruno.martin@ivry.test' },
  boot: { password: 'pw-boot', displayName: 'Boot Admin', email: 'boot@ivry.test' },
  nouveau: { password: 'pw-nouveau', displayName: 'Nouveau Agent', email: 'nouveau@ivry.test' },
  durand: { password: 'pw-durand', displayName: 'Durand Claire', email: 'claire.durand@ivry.test' },
  leroy: { password: 'pw-leroy', displayName: 'Leroy Denis', email: 'denis.leroy@ivry.test' },
  petit: { password: 'pw-petit', displayName: 'Petit Éva', email: 'eva.petit@ivry.test' },
  moreau: { password: 'pw-moreau', displayName: 'Moreau Luc', email: 'luc.moreau@ivry.test' },
};
const AGENTS = [
  { username: 'dupont', displayName: 'Dupont Alice', email: 'alice.dupont@ivry.test', service: 'BUDGET', direction: 'DIRECTION DES FINANCES', poste: 'Chargée de budget', matricule: '001' },
  { username: 'martin', displayName: 'Martin Bruno', email: 'bruno.martin@ivry.test', service: 'AIDE SOCIALE', direction: 'Direction CCAS', poste: 'Travailleur social', matricule: '002' },
  { username: 'durand', displayName: 'Durand Claire', email: 'claire.durand@ivry.test', service: 'BUDGET', direction: 'DIRECTION DES FINANCES', poste: 'Adjointe budget', matricule: '003' },
  { username: 'leroy', displayName: 'Leroy Denis', email: 'denis.leroy@ivry.test', service: 'COMPTABILITE', direction: 'DIRECTION DES FINANCES', poste: 'Comptable', matricule: '004' },
  { username: 'petit', displayName: 'Petit Éva', email: 'eva.petit@ivry.test', service: 'AIDE SOCIALE', direction: 'DIRECTION CCAS', poste: 'Assistante', matricule: '005' },
  { username: 'moreau', displayName: 'Moreau Luc', email: 'luc.moreau@ivry.test', service: 'COMPTABILITÉ', direction: 'DIRECTION DES FINANCES', poste: 'Agent comptable', matricule: '006' },
];

async function createTestEnv({ users = USERS, agents = AGENTS, directions = DIRECTIONS, elus = [], env = {}, guard, airsSource } = {}) {
  const schema = PREFIX + crypto.randomBytes(4).toString('hex');
  const config = testConfig(schema, env);
  const log = createLogger('silent');
  const db = createDb(config, log);
  await migrate(db, log);
  const ad = createFakeAuth({ users });
  const directoryAdapter = createFakeDirectory({ directions, agents, elus });
  const mail = createFakeMail();
  const ai = createFakeAi();
  const meeting = createFakeMeeting();
  const c = buildContainer({ config, log, db, ad, directoryAdapter, mail, ai, meeting, guard, airsSource });
  const boot = await bootstrap(c);
  // un élu (id 1) rapporteur par défaut des actes de test
  await db.query("INSERT INTO elus (organisme_id, source, nom, prenom, email, role) VALUES ($1, 'manual', 'Rapporteur', 'Martine', 'martine.rapporteur@ivry.test', 'Adjointe')", [boot.id]);
  const app = createApp(c);
  return {
    app, c, db, config, ad, directoryAdapter, mail, ai, meeting, schema,
    http: () => request(app),
    async close() {
      if (!schema.startsWith(PREFIX)) throw new Error('refus de supprimer un schéma hors préfixe de test');
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      await db.close();
    },
  };
}

/** Connexion via l'API ; renvoie le jeton. */
async function loginAs(env, username, password) {
  const r = await env.http().post('/api/v1/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`connexion de test refusée (${username}) : ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

/** PDF minimal valide pour les tests d'annexes. */
async function makePdf(pages = 1) {
  const { PDFDocument } = require('pdf-lib');
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 750 });
  return Buffer.from(await d.save());
}

/** Jeton de l'administrateur de plateforme amorcé (« boot »). */
const adminToken = (env) => loginAs(env, 'boot', 'pw-boot');

module.exports = { createTestEnv, loginAs, bearer, adminToken, makePdf, testConfig, PREFIX, USERS, AGENTS, DIRECTIONS };
