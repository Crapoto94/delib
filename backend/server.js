/**
 * Point d'entrée : configuration -> base -> migrations -> amorçage -> HTTP. Arrêt propre sur SIGINT / SIGTERM.
 */
const { loadConfig } = require('./src/config');
const { createLogger } = require('./src/shared/logger');
const { createDb } = require('./src/db/pool');
const { migrate } = require('./src/db/migrate');
const { createApmAd } = require('./src/adapters/apm-ad');
const { createHubDirectory } = require('./src/adapters/hub-directory');
const { createApmMail } = require('./src/adapters/apm-mail');
const { createApmAi } = require('./src/adapters/apm-ai');
const { createGraphTeams } = require('./src/adapters/graph-teams');
const { buildContainer } = require('./src/container');
const { createApp } = require('./src/http/app');
const { bootstrap } = require('./src/bootstrap');

async function main() {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const db = createDb(config, log);

  if (config.autoMigrate) await migrate(db, log);
  const c = buildContainer({ config, log, db, ad: createApmAd(config), directoryAdapter: createHubDirectory(config), mail: createApmMail(config), ai: createApmAi(config), meeting: createGraphTeams(config) });
  await bootstrap(c);

  const app = createApp(c);
  const server = app.listen(config.port, () => log.info({ port: config.port, env: config.env, schema: config.db.schema }, 'IvryDélib démarré'));

  c.aiQueue.start();
  if (config.schedulerEnabled) c.scheduler.start();
  else log.info('planificateur désactivé (SCHEDULER_ENABLED=false) : ni relances ni envoi de mails');

  const stop = async (signal) => {
    log.info({ signal }, 'arrêt en cours');
    c.scheduler.stop(); c.aiQueue.stop();
    server.close(async () => { await db.close().catch(() => {}); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
