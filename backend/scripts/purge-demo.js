/**
 * Supprime le jeu de DÉMONSTRATION (agents fictifs « demo.* », élus « @demo.ivry », leurs dossiers, séances créées par le script de démo,
 * titulaires, rôles et groupes qui s'y rattachent). Ne touche ni aux vrais agents, ni aux vrais élus, ni aux titulaires réels,
 * ni aux dossiers des vrais rédacteurs. Le journal d'audit est conservé.
 *
 *   node scripts/purge-demo.js            essai à blanc : compte ce qui serait supprimé (transaction annulée)
 *   node scripts/purge-demo.js --apply    supprime réellement
 */
const path = require('path');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const DEMO = "'demo.%'";
const STEPS = [
  ['convocations de démonstration (destinataires fictifs)', "DELETE FROM convocations WHERE id IN (SELECT convocation_id FROM convocation_destinataires WHERE username LIKE 'demo.%' OR elu_id IN (SELECT id FROM elus WHERE email LIKE '%@demo.ivry'))"],
  ['dossiers (actes) rédigés par des agents fictifs', `DELETE FROM actes WHERE redacteur LIKE ${DEMO}`],
  ['séances créées par le script de démo', "DELETE FROM seances WHERE created_by = 'seed'"],
  ['titulaires fictifs (ou leurs suppléants)', `DELETE FROM titulaires WHERE username LIKE ${DEMO} OR suppleant LIKE ${DEMO}`],
  ['postes de DGA tenus par des fictifs', `DELETE FROM dga_postes WHERE username LIKE ${DEMO} OR suppleant LIKE ${DEMO}`],
  ['rôles d\'agents fictifs', `DELETE FROM user_org_roles WHERE username LIKE ${DEMO}`],
  ['membres fictifs des groupes de valideurs', `DELETE FROM groupe_valideurs_membres WHERE username LIKE ${DEMO}`],
  ['secrétaires de commission fictifs', `DELETE FROM commission_secretaires WHERE username LIKE ${DEMO}`],
  ['droits de rédaction fictifs', `DELETE FROM redaction_grants WHERE username LIKE ${DEMO}`],
  ['notifications et préférences fictives', `DELETE FROM notifications WHERE username LIKE ${DEMO} OR username LIKE 'elu:%'`],
  ['journal d\'envoi de notifications fictif', `DELETE FROM notification_log WHERE recipient LIKE ${DEMO} OR recipient LIKE 'elu:%'`],
  ['préférences de notification fictives', `DELETE FROM notification_prefs WHERE username LIKE ${DEMO}`],
  ['sourdines de notification fictives', `DELETE FROM notification_mutes WHERE username LIKE ${DEMO}`],
  ['élus fictifs', "DELETE FROM elus WHERE email LIKE '%@demo.ivry'"],
  ['groupes politiques sans aucun élu', 'DELETE FROM groupes_politiques g WHERE NOT EXISTS (SELECT 1 FROM elus e WHERE e.groupe_id = g.id)'],
  ['agents fictifs', "DELETE FROM agent_ref WHERE source = 'demo'"],
];

(async () => {
  const apply = process.argv.includes('--apply');
  const config = loadConfig(); const db = createDb(config, createLogger('warn'));
  try {
    await db.tx(async (t) => {
      for (const [label, sql] of STEPS) {
        const r = await t.run(sql);
        console.log(`${String(r.changes).padStart(5)}  ${label}`);
      }
      if (!apply) throw Object.assign(new Error('essai à blanc'), { dry: true });
    }, { bypass: true });
    console.log('\nSuppression appliquée.');
  } catch (e) {
    if (e.dry) console.log('\nEssai à blanc : rien n\'a été supprimé. Relancez avec --apply.'); else { console.error('ERREUR :', e.message); process.exitCode = 1; }
  } finally { await db.close(); }
})();
