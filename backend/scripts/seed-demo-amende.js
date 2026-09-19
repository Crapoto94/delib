/**
 * Démonstration : un exposé des motifs modifié par SEPT personnes différentes le long du circuit (suivi des modifications).
 * S'appuie sur le jeu créé par `seed-demo.js` (agents « demo.* »). Écrit le PDF de suivi dans backend/storage/demo-expose-amende.pdf.
 *
 *   node scripts/seed-demo-amende.js
 */
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { createHubDirectory } = require('../src/adapters/hub-directory');
const { createFakeAuth, createFakeMail, createFakeAi, createFakeMeeting } = require('../src/adapters/fake-directory');
const { buildContainer } = require('../src/container');
const { bootstrap } = require('../src/bootstrap');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const BASE = [
  "Le quartier du Petit-Ivry accueille chaque année un festival de quartier organisé par l'association Ivry en Fête.",
  "L'association sollicite une subvention pour financer la programmation artistique et la sécurité de l'événement.",
  "Le budget prévisionnel de la manifestation s'élève à 40 000 euros, dont 12 000 euros de recettes propres.",
  "La Ville soutient ce projet depuis plusieurs années, dans le cadre de sa politique culturelle de proximité.",
  "Il est proposé au conseil municipal d'attribuer à l'association une subvention de fonctionnement.",
].join('\n\n');

// une retouche par intervenant, dans l'ordre du circuit
const EDITS = {
  chef_service: [(t) => t.replace("chaque année un festival de quartier", "chaque année, depuis 2014, un festival de quartier"), 'Précision de la genèse du festival'],
  directeur: [(t) => t.replace("la programmation artistique et la sécurité de l'événement", "la programmation artistique, la sécurité et l'accessibilité de l'événement"), 'Ajout de l\'accessibilité'],
  financier: [(t) => t.replace("s'élève à 40 000 euros, dont 12 000 euros de recettes propres", "s'élève à 40 000 euros, dont 12 000 euros de recettes propres ; la subvention demandée est de 18 000 euros"), 'Montant de la subvention'],
  juridique: [(t) => t.replace("Il est proposé au conseil municipal d'attribuer", "Conformément à l'article L. 2311-7 du code général des collectivités territoriales, il est proposé au conseil municipal d'attribuer"), 'Base légale'],
  dga: [(t) => t.replace("dans le cadre de sa politique culturelle de proximité", "dans le cadre de sa politique culturelle de proximité et de son plan Quartiers vivants"), 'Rattachement au plan Quartiers vivants'],
  dgs: [(t) => t.replace("depuis plusieurs années, ", "").replace("Il est proposé", "Au vu de ces éléments, il est proposé"), 'Allègement et transition'],
  scc: [(t) => `${t}\n\nLa commission Culture, vie associative et jeunesse a été consultée sur ce projet.`, 'Mention de la commission'],
};

async function main() {
  const config = loadConfig();
  const log = createLogger('warn');
  const db = createDb(config, log);
  const c = buildContainer({ config, log, db, ad: createFakeAuth({}), directoryAdapter: createHubDirectory(config), mail: createFakeMail(), ai: createFakeAi(), meeting: createFakeMeeting({ available: false }) });
  const org = await bootstrap(c); const O = org.id;
  const ctxOf = (u) => c.access.loadContext(u);
  const ref = async (k) => c.refs.list(k, O);

  const red = (await db.get("SELECT * FROM agent_ref WHERE source = 'demo' AND username LIKE 'demo.red.%' AND service_code IS NOT NULL ORDER BY username LIMIT 1"));
  if (!red) throw new Error("Lancez d'abord scripts/seed-demo.js");
  const ctx = await ctxOf(red.username);
  const seance = await db.get("SELECT id FROM seances WHERE organisme_id = $1 ORDER BY date_seance DESC LIMIT 1", [O]);
  const matieres = await ref('matiere'); const parents = new Set(matieres.map((m) => m.parentCode).filter(Boolean));
  const type = (await ref('type_acte')).find((t) => t.code === 'deliberation');
  const elu = await db.get('SELECT id FROM elus WHERE organisme_id = $1 ORDER BY id LIMIT 1', [O]);
  const a = await c.actes.create(ctx, O, { typeId: type.id, titre: "Subvention à l'association Ivry en Fête pour le festival du Petit-Ivry (exposé amendé par 7 intervenants)", serviceCode: red.service_code });
  await c.actes.update(ctx, O, a.id, { matiereId: matieres.find((m) => !parents.has(m.code)).id, rubriqueId: (await ref('rubrique'))[0].id, incidenceFinanciere: true, montant: 18000, rapporteurId: elu.id, seanceViseeId: seance.id });
  for (const t of await c.textes.list(ctx, O, a.id)) {
    const md = t.kind === 'expose' ? BASE : t.kind === 'visas' ? 'Vu le code général des collectivités territoriales ;\nVu le budget primitif ;' : 'Article 1 : Une subvention de 18 000 euros est attribuée à l’association Ivry en Fête.\nArticle 2 : Monsieur le Maire est chargé de l’exécution de la présente délibération.';
    await c.textes.commit(ctx, O, a.id, t.id, { markdown: md, baseVersion: t.version });
  }
  await c.engine.submit(ctx, O, a.id);

  const auteurs = [];
  for (let i = 0; i < 12; i++) {
    const cur = await db.get('SELECT * FROM actes WHERE id = $1', [a.id]);
    if (!cur.current_step_key) break;
    const inst = await db.get("SELECT holders FROM step_instances WHERE acte_id = $1 AND status = 'current'", [a.id]);
    const who = await ctxOf(inst.holders[0]);
    const edit = EDITS[cur.current_step_key];
    if (edit) {
      const ex = (await c.textes.list(who, O, a.id)).find((t) => t.kind === 'expose');
      const v = await c.textes.view(who, O, a.id, ex.id, { mode: 'propre' });
      await c.textes.commit(who, O, a.id, ex.id, { markdown: edit[0](v.markdown), baseVersion: v.version, reason: edit[1] });
      auteurs.push(`${cur.current_step_key} : ${inst.holders[0]}`);
    }
    await c.engine.validate(who, O, a.id, { comment: 'Relu, modifié et validé.' });
  }
  const last = await db.get('SELECT id, statut, current_step_key FROM actes WHERE id = $1', [a.id]);
  console.log(`Acte n° ${a.id} (statut ${last.statut}, étape ${last.current_step_key}). Auteurs :\n  ${auteurs.join('\n  ')}`);
  const out0 = await c.render.renderActe(ctx, O, a.id, { cible: 'expose', mode: 'suivi', brouillon: false });
  const out = path.resolve(config.storage.dir, 'demo-expose-amende.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, out0.buffer || out0.pdf || out0);
  console.log('PDF de suivi :', out);
  await db.close();
}
main().catch((e) => { console.error('Échec :', e); process.exit(1); });
