/**
 * Reclasse le stockage GED existant (GED-11) : au lieu d'un dossier par date d'import avec des noms opaques, chaque
 * document est rangé par catégorie métier (annexes, convocations, ordres-du-jour, cahiers, parapheurs, contrôle de
 * légalité, gabarits, logos…), renommé lisiblement et accompagné de métadonnées (acte, séance, type, nature, matière,
 * rubrique, organisme, déposant).
 *
 * Le nœud Alfresco est DÉPLACÉ et mis à jour : son identifiant ne change pas, donc aucun re-téléversement et les clés
 * de stockage restent valides. Rejouable : un document déjà classé est ignoré.
 *
 *   node scripts/reclasser-ged.js --organisme 1                 # simulation (n'écrit rien)
 *   node scripts/reclasser-ged.js --organisme 1 --apply         # exécute
 *   node scripts/reclasser-ged.js --organisme 1 --apply --limite 100   # par petits lots
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { createAudit } = require('../src/modules/audit/audit.service');
const { createGed } = require('../src/modules/ged/ged.service');
const { createGedSimulateur } = require('../src/adapters/ged-simulateur');
const { createAlfresco } = require('../src/adapters/alfresco');

(async () => {
  const args = process.argv.slice(2);
  const val = (nom, def) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : def; };
  const organismeId = Number(val('--organisme', 1));
  const limite = Number(val('--limite', 0));
  const appliquer = args.includes('--apply');
  if (!Number.isInteger(organismeId) || organismeId <= 0) { console.error('Usage : node scripts/reclasser-ged.js --organisme <id> [--apply] [--limite <n>]'); process.exit(2); }

  const config = loadConfig(); const log = createLogger('warn');
  const db = createDb(config, log);
  const audit = createAudit(db);
  // GED minimale : seuls le paramétrage, le stockage et les adaptateurs servent au reclassement.
  const ged = createGed({ db, audit, config, log, adapters: { simulateur: createGedSimulateur({ db }), alfresco: createAlfresco({ tls: config.tls }) }, render: {}, tenue: {}, pv: {}, tlt: {}, storage: {}, cahier: {} });
  const ctx = { username: 'reclassement', kind: 'system', isPlatformAdmin: false, organismes: [], roles: [], orgIds: [organismeId], agent: null, displayName: 'Reclassement GED' };

  const r = await ged.reclasserStockage(ctx, organismeId, { appliquer, limite });
  console.log(JSON.stringify(r, null, 2));
  await db.close();
})().catch((e) => { console.error(`Échec : ${e.message}`); process.exit(1); });
