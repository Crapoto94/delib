/**
 * Démonstration de la convocation : une séance dont l'ordre du jour (points libres) est arrêté, une convocation envoyée à des élus
 * et à des agents de la Ville — AVEC UNE MESSAGERIE FACTICE (aucun mail n'est réellement envoyé) — puis quelques consultations
 * simulées sur le serveur en marche (liens personnels), pour voir les statistiques et le journal.
 *
 *   node scripts/seed-demo-convocation.js [http://localhost:3021]
 */
const path = require('path');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { createHubDirectory } = require('../src/adapters/hub-directory');
const { createFakeAuth, createFakeMail, createFakeAi, createFakeMeeting } = require('../src/adapters/fake-directory');
const { buildContainer } = require('../src/container');
const { bootstrap } = require('../src/bootstrap');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SERVER = process.argv[2] || 'http://localhost:3021';
const inDays = (n) => new Date(Date.now() + n * 86400000);

async function main() {
  const config = loadConfig(); const log = createLogger('warn'); const db = createDb(config, log);
  const mail = createFakeMail();
  const c = buildContainer({ config, log, db, ad: createFakeAuth({}), directoryAdapter: createHubDirectory(config), mail, ai: createFakeAi(), meeting: createFakeMeeting({ available: false }) });
  const org = await bootstrap(c); const O = org.id;
  const ctx = await c.access.loadContext('machevalier');
  const inst = (await c.seances.instances(O)).find((i) => i.kind === 'conseil');
  const s = await c.seances.create(ctx, O, { instanceId: inst.id, dateSeance: inDays(45).toISOString(), lieu: 'Salle du conseil, Hôtel de ville' });
  for (const titre of ["Approbation du procès-verbal de la séance précédente", 'Communication des décisions du Maire', 'Vœu relatif aux services publics de proximité', 'Questions diverses']) {
    await c.odj.addPoint(ctx, O, s.id, { kind: 'libre', titre, numerote: true });
  }
  await c.odj.arreter(ctx, O, s.id, { forcer: true });
  const elus = (await db.all('SELECT id FROM elus WHERE organisme_id = $1 AND actif AND est_elu ORDER BY id LIMIT 14', [O])).map((r) => r.id);
  const agents = (await db.all("SELECT username FROM agent_ref WHERE username = 'machevalier' OR username LIKE 'demo.dir.%' OR username IN ('demo.scc', 'demo.dgs') ORDER BY username LIMIT 6")).map((r) => r.username);
  const r = await c.convocations.envoyer(ctx, O, s.id, { eluIds: elus, agents, message: 'Merci de confirmer votre présence avant le conseil.' });
  await c.convocations.idle();
  console.log(`Séance ${s.id} : convocation v${r.version} envoyée à ${elus.length} élus et ${agents.length} agents (messagerie factice : ${mail.state.sent.length} mails simulés).`);

  // consultations simulées sur le serveur en marche
  const tokens = (await db.all('SELECT id, kind, nom, token FROM convocation_destinataires WHERE convocation_id = $1 ORDER BY id', [r.id]));
  let i = 0;
  for (const d of tokens) {
    i++;
    if (i % 4 === 0) continue; // un convoqué sur quatre n'ouvre jamais son lien
    const u = `${SERVER}/api/v1/public/convocations/${d.token}`;
    await fetch(u);
    if (i % 3 !== 0) await fetch(`${u}/convocation.pdf`);
    if (i % 2 === 0) await fetch(`${u}/ordre-du-jour.pdf`);
    if (i % 5 === 0) await fetch(`${u}/accuse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (i % 3 === 1) await fetch(`${u}/reponse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reponse: i % 6 === 1 ? 'present' : 'absent' }) });
  }
  console.log(`Consultations simulées pour ${tokens.length} convoqués. Ouvrir : /seances/${s.id}/convocation`);
  await db.close();
}
main().catch((e) => { console.error('Échec :', e); process.exit(1); });
