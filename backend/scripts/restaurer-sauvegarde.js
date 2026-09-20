/**
 * Restaure une sauvegarde VibeDélib dans un schéma PostgreSQL CIBLE (SAV-06).
 *
 *   node scripts/restaurer-sauvegarde.js "\\SRVIVRY2\shares3\DSI\vibedelib_2026-09-20_0200" --schema ivrydelib_restaure
 *
 * Le schéma cible doit être vide (il est créé et migré s'il n'existe pas). Ajoutez --forcer pour charger dans un schéma non vide (déconseillé).
 * Après restauration : faire pointer DB_SCHEMA sur le schéma restauré, redémarrer, puis « Recherche › Ré-indexer » et se reconnecter (les sessions ne sont pas sauvegardées).
 * Les fichiers stockés localement se restaurent en recopiant le dossier « fichiers » de la destination dans STORAGE_DIR.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { restaurer } = require('../src/modules/sauvegarde/restaurer');

(async () => {
  const args = process.argv.slice(2);
  const dossier = args.find((a) => !a.startsWith('--'));
  const i = args.indexOf('--schema'); const schema = i >= 0 ? args[i + 1] : null;
  if (!dossier || !schema || !/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) { console.error('Usage : node scripts/restaurer-sauvegarde.js <dossier de sauvegarde> --schema <schéma cible> [--forcer]'); process.exit(2); }
  const config = loadConfig(); const log = createLogger('warn');
  if (schema === config.db.schema && !args.includes('--forcer')) { console.error(`Refus : « ${schema} » est le schéma en service. Restaurez d'abord dans un autre schéma.`); process.exit(2); }
  const r = await restaurer({ config, log, dossier, schema, forcer: args.includes('--forcer') });
  console.log(`Restauré dans « ${schema} » : ${r.tables} tables, ${r.lignes} lignes.`);
  if (r.ecarts.length) { console.error('ÉCARTS :', r.ecarts.join(' | ')); process.exit(1); }
  console.log('Contrôle des nombres de lignes : conforme au manifeste.');
})().catch((e) => { console.error(`Échec : ${e.message}`); process.exit(1); });
