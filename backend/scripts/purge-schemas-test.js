/**
 * Supprime les schémas jetables des tests d'intégration (`vibedelib_test_<8 hex>`) restés dans la base après un test interrompu.
 * Ne touche JAMAIS au schéma applicatif : seuls les noms qui correspondent exactement au motif sont retenus, et les schémas
 * créés il y a moins de 15 minutes (un test peut encore tourner) sont ignorés.
 *
 *   node scripts/purge-schemas-test.js            essai à blanc : liste ce qui serait supprimé
 *   node scripts/purge-schemas-test.js --apply    supprime réellement
 */
const path = require('path');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const MOTIF = /^vibedelib_test_[0-9a-f]{8}$/;
const MIN_AGE_MS = 15 * 60 * 1000;

(async () => {
  const apply = process.argv.includes('--apply');
  const config = loadConfig(); const db = createDb(config, createLogger('warn'));
  try {
    if (MOTIF.test(db.schema)) throw new Error('Le schéma applicatif ressemble à un schéma de test : arrêt par sécurité');
    // date de création approximative : plus ancienne ligne de schema_migrations du schéma de test
    const rows = await db.all("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'vibedelib\\_test\\_%' ORDER BY schema_name");
    const cibles = []; let recents = 0; let horsMotif = 0;
    for (const { schema_name: s } of rows) {
      if (!MOTIF.test(s)) { horsMotif++; continue; }
      const m = await db.get(`SELECT min(applied_at) AS t FROM "${s}".schema_migrations`).catch(() => null);
      if (m?.t && Date.now() - new Date(m.t).getTime() < MIN_AGE_MS) { recents++; continue; }
      cibles.push(s);
    }
    console.log(`${rows.length} schémas « vibedelib_test_ » trouvés : ${cibles.length} à supprimer, ${recents} récents ignorés, ${horsMotif} hors motif ignorés. Schéma applicatif : ${db.schema} (intact).`);
    if (!apply) { console.log('Essai à blanc : rien n\'a été supprimé. Relancez avec --apply.'); return; }
    let ok = 0;
    for (const s of cibles) { try { await db.query(`DROP SCHEMA "${s}" CASCADE`); ok++; } catch (e) { console.error(`  échec ${s} : ${e.message}`); } }
    console.log(`${ok} schémas supprimés.`);
  } catch (e) { console.error('ERREUR :', e.message); process.exitCode = 1; } finally { await db.close(); }
})();
