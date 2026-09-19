const { loadConfig } = require('../config');
const { createLogger } = require('../shared/logger');
const { createDb } = require('./pool');
const { migrate } = require('./migrate');

(async () => {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const db = createDb(config, log);
  try {
    const n = await migrate(db, log);
    log.info({ total: n }, 'migrations à jour');
  } finally { await db.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
