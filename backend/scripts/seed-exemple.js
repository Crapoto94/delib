/**
 * Jeu d'EXEMPLE sur l'organisation RÉELLE : séances du conseil municipal (dont celle du 3 décembre 2026) et dossiers à tous les stades
 * du circuit. Contrairement à `seed-demo.js` (agents fictifs « demo.* », retirés par `purge-demo.js`), les rédacteurs et les valideurs
 * sont des PERSONNES RÉELLES de l'administration : les titulaires déjà désignés dans l'outil (directeurs, chefs de service, DGA, DGS)
 * et l'équipe DSI. Les responsables des groupes « service financier » et « service juridique » — s'ils sont vides — sont proposés
 * d'après l'organigramme RH (directeur de la direction concernée) ; tout se change ensuite dans Administration / Titulaires.
 * Aucun mail n'est envoyé (messagerie factice) ; rien n'est écrit dans le Hub ni dans l'AD.
 *
 *   node scripts/seed-exemple.js            crée le jeu (refuse s'il existe déjà : séance du 3 décembre 2026)
 *   node scripts/seed-exemple.js --reset    supprime d'abord la séance du 3 décembre, celles de l'exemple et leurs dossiers
 */
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { createHubDirectory } = require('../src/adapters/hub-directory');
const { createApmAd } = require('../src/adapters/apm-ad');
const { createFakeMail, createFakeAi, createFakeMeeting } = require('../src/adapters/fake-directory');
const { buildContainer } = require('../src/container');
const { bootstrap } = require('../src/bootstrap');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const ME = (process.env.SEED_ME || 'machevalier').toLowerCase();
const TAG = 'Exemple —'; // préfixe des titres : sert à retrouver et à supprimer le jeu
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10);

const TITRES = [
  ['Attribution d’une subvention exceptionnelle à l’association Ivry Sport Jeunesse', 'Le conseil est invité à soutenir l’action de l’association en faveur de la pratique sportive des jeunes ivryens.', 4500],
  ['Convention pluriannuelle d’objectifs 2026-2028 avec le Théâtre des Quartiers d’Ivry', 'La précédente convention triennale arrive à son terme ; la Ville souhaite renouveler son engagement partenarial.', 120000],
  ['Approbation du règlement intérieur des accueils de loisirs', 'Le règlement précise les conditions d’accueil, d’inscription et de tarification des accueils de loisirs municipaux.', null],
  ['Avenant n°2 au marché de fourniture de repas pour la restauration scolaire', 'L’avenant ajuste les quantités et prend en compte la revalorisation des prix prévue au contrat.', 38000],
  ['Création d’un poste de chargé de mission transition écologique', 'Pour piloter le plan climat, il est proposé de créer un emploi permanent de catégorie A.', 62000],
  ['Modification du tableau des effectifs au 1er janvier', 'Les évolutions de services rendent nécessaires plusieurs créations et suppressions de postes.', null],
  ['Cession d’une parcelle communale, rue Marat, à un bailleur social', 'La cession permet la réalisation de logements sociaux conformément au programme local de l’habitat.', 850000],
  ['Adhésion de la Ville au groupement de commandes pour l’achat d’électricité', 'Le groupement permet de mutualiser les achats d’énergie et d’obtenir de meilleurs prix.', 210000],
  ['Tarification des activités de la médiathèque pour l’année 2027', 'La grille tarifaire est actualisée pour tenir compte de l’inflation et de la fréquentation.', null],
  ['Autorisation de signer la convention de mise à disposition de la salle Robespierre', 'La salle sera mise à disposition d’associations locales à titre gracieux, selon un calendrier partagé.', null],
  ['Renouvellement de l’adhésion à l’association des maires d’Île-de-France', 'La cotisation annuelle donne accès aux services d’expertise et de conseil de l’association.', 9800],
  ['Subvention au centre social pour le projet « Ateliers numériques »', 'Le projet accompagne les habitants éloignés du numérique dans leurs démarches en ligne.', 15000],
];
const DISPOSITIF = (n) => `Article 1 : Le conseil municipal approuve la présente délibération${n ? ` pour un montant de ${n.toLocaleString('fr-FR')} euros` : ''}.\nArticle 2 : Monsieur le Maire, ou son représentant délégué, est autorisé à signer tout document nécessaire à son exécution.\nArticle 3 : Les crédits correspondants sont inscrits au budget de l’exercice en cours.`;
const VISAS = 'Vu le code général des collectivités territoriales, notamment ses articles L. 2121-29 et L. 2311-1 ;\nVu l’avis de la commission compétente ;\nConsidérant l’intérêt communal de l’opération ;';

const BASE = [
  'Le quartier du Petit-Ivry accueille chaque année un festival de quartier organisé par l’association Ivry en Fête.',
  'L’association sollicite une subvention pour financer la programmation artistique et la sécurité de l’événement.',
  'Le budget prévisionnel de la manifestation s’élève à 40 000 euros, dont 12 000 euros de recettes propres.',
  'La Ville soutient ce projet depuis plusieurs années, dans le cadre de sa politique culturelle de proximité.',
  'Il est proposé au conseil municipal d’attribuer à l’association une subvention de fonctionnement.',
].join('\n\n');
const EDITS = {
  chef_service: [(t) => t.replace('chaque année un festival de quartier', 'chaque année, depuis 2014, un festival de quartier'), 'Précision de la genèse du festival'],
  directeur: [(t) => t.replace('la programmation artistique et la sécurité de l’événement', 'la programmation artistique, la sécurité et l’accessibilité de l’événement'), 'Ajout de l’accessibilité'],
  financier: [(t) => t.replace('dont 12 000 euros de recettes propres', 'dont 12 000 euros de recettes propres ; la subvention demandée est de 18 000 euros'), 'Montant de la subvention'],
  juridique: [(t) => t.replace('Il est proposé au conseil municipal d’attribuer', 'Conformément à l’article L. 2311-7 du code général des collectivités territoriales, il est proposé au conseil municipal d’attribuer'), 'Base légale'],
  dga: [(t) => t.replace('de sa politique culturelle de proximité', 'de sa politique culturelle de proximité et de son plan Quartiers vivants'), 'Rattachement au plan Quartiers vivants'],
  dgs: [(t) => t.replace('depuis plusieurs années, ', '').replace('Il est proposé', 'Au vu de ces éléments, il est proposé'), 'Allègement et transition'],
  scc: [(t) => `${t}\n\nLa commission a été consultée sur ce projet.`, 'Mention de la commission'],
};

async function pdf(title) {
  const d = await PDFDocument.create();
  for (let i = 1; i <= 2; i++) { const p = d.addPage([595, 842]); p.drawText(`${title} — page ${i}`, { x: 50, y: 780, size: 14 }); p.drawText('Pièce d’exemple VibeDélib', { x: 50, y: 750, size: 10 }); }
  return Buffer.from(await d.save());
}

async function main() {
  const config = loadConfig(); const log = createLogger('warn'); const db = createDb(config, log);
  await migrate(db, log);
  const c = buildContainer({ config, log, db, ad: createApmAd(config), directoryAdapter: createHubDirectory(config), mail: createFakeMail(), ai: createFakeAi(), meeting: createFakeMeeting({ available: false }) });
  const org = await bootstrap(c); const O = org.id;
  const sys = { username: 'exemple', isPlatformAdmin: true, organismes: [], roles: [], orgIds: [O], agent: null, displayName: 'exemple' };
  const meCtx = await c.access.loadContext(ME);

  const A_ISO = '2026-12-03T17:30:00.000Z';
  const existing = await db.get("SELECT id FROM seances WHERE organisme_id = $1 AND date_seance = $2", [O, A_ISO]);
  if (process.argv.includes('--reset')) {
    await db.run("DELETE FROM actes WHERE organisme_id = $1 AND titre LIKE $2", [O, `${TAG}%`]);
    await db.run("DELETE FROM seances WHERE organisme_id = $1 AND date_seance IN ($2, $3, $4)", [O, A_ISO, '2027-01-07T17:30:00.000Z', '2026-10-03T16:30:00.000Z']);
    console.log('Jeu d’exemple précédent supprimé.');
  } else if (existing) { console.log('La séance du 3 décembre 2026 existe déjà. Relancez avec --reset pour la recréer.'); await db.close(); return; }

  // ---- personnes réelles : titulaires désignés, ou responsables de l'organigramme RH
  const chart = await c.dir.organisationChart();
  const data = await c.titulaires.loadResolution(O);
  const nodes = new Map(chart.map((d) => [d.code, d]));
  const rhv = (d, s) => { const n = nodes.get(d); const sn = s ? (n?.services || []).find((x) => x.code === s) : null; return { direction: !!n?.vacant, service: !!sn?.vacant }; };
  const who = (fonction, scope) => { const r = c.titulaires.resolveIn(data, fonction, scope, rhv); return r.vacant ? null : (r.holders[0] || null); };
  const ensureAgent = async (username) => {
    if (await db.get('SELECT 1 AS x FROM agent_ref WHERE username = $1', [username])) return;
    const hit = (await c.dir.searchAgents(username.slice(1))).find((a) => (a.email || '').split('@')[0].toLowerCase() === username) || null;
    await c.dir.syncOnLogin({ username, displayName: hit?.displayName || username, email: hit?.email || `${username}@${config.emailDomain || 'ivry94.fr'}` });
  };

  // groupes de valideurs vides : le responsable de la direction concernée d'après l'organigramme RH (modifiable ensuite)
  const groups = await c.titulaires.groups(O);
  const fillGroup = async (code, re) => {
    const g = groups.find((x) => x.code === code);
    if (!g || (g.membres || []).length) return;
    const node = chart.find((d) => re.test(d.label));
    const login = node?.responsable ? (await c.dir.loginsByName(node.responsable))[0] : null;
    if (login) { await ensureAgent(login); await c.titulaires.setGroupMembers(sys, O, g.id, [login]); console.log(`Groupe « ${code} » : ${login} (${node.label})`); }
  };
  await fillGroup('financier', /SERVICES FINANCIERS/i); await fillGroup('juridique', /JURIDIQ/i);

  // directions dont toute la chaîne est renseignée (DSI d'abord)
  const cast = [];
  for (const d of chart.filter((x) => (x.services || []).length)) {
    const directeur = who('directeur', { directionCode: d.code }); const dgaR = c.titulaires.resolveIn(data, 'dga', { directionCode: d.code }, rhv);
    if (!directeur || !(dgaR.holders.length || dgaR.direct === 'dgs')) continue;
    const chefs = {};
    for (const sv of d.services) { const memeNom = norm(sv.label) === norm(d.label); const ch = who('chef_service', { directionCode: d.code, serviceCode: sv.code, serviceSameAsDirection: memeNom }); if (ch) chefs[sv.code] = ch; }
    const propre = d.services.find((sv) => chefs[sv.code] && chefs[sv.code] !== directeur); // un service avec son propre chef
    const svc = propre || d.services.find((sv) => chefs[sv.code]);
    if (!svc) continue;
    cast.push({ d, svc, k: slug(d.code), directeur, chef: chefs[svc.code], red: propre ? chefs[svc.code] : directeur });
  }
  const dsi = cast.find((x) => /SYSTEMES D'INFORMATION/i.test(x.d.label));
  const chosen = [...(dsi ? [dsi] : []), ...cast.filter((x) => x !== dsi)].slice(0, 5);
  if (!chosen.length) throw new Error('Aucune direction dont la chaîne de validation (directeur, DGA ou DGS, chef de service) soit entièrement renseignée : complétez « Titulaires & droits ».');
  if (dsi) { // l'équipe DSI rédige elle-même ses dossiers
    const team = (await db.all("SELECT username FROM agent_ref WHERE source = 'ad' AND direction_code = $1 AND username <> $2 ORDER BY username", [dsi.d.code, ME])).map((r) => r.username);
    dsi.equipe = team;
  }
  for (const cs of chosen) { for (const u of [cs.red, cs.directeur, cs.chef, ...(cs.equipe || [])]) await ensureAgent(u); }
  console.log(`Directions retenues : ${chosen.map((x) => `${x.d.label} (rédacteur ${x.red})`).join(' | ')}`);

  // ---- élus réels, commissions existantes, séances
  const elus = (await db.all('SELECT id FROM elus WHERE organisme_id = $1 AND actif AND est_elu ORDER BY id', [O])).map((r) => r.id);
  const coms = await db.all('SELECT id FROM commissions WHERE organisme_id = $1 AND actif AND type = \'actes\' ORDER BY ordre, id', [O]);
  const inst = (await c.seances.instances(O)).find((i) => i.kind === 'conseil');
  const mkSeance = (iso, extra = {}) => c.seances.create(meCtx, O, { instanceId: inst.id, dateSeance: iso, lieu: 'Salle du conseil, Hôtel de ville', ...extra });
  const sA = await mkSeance(A_ISO); const sB = await mkSeance('2027-01-07T17:30:00.000Z');
  const sC = await mkSeance('2026-10-03T16:30:00.000Z', { dateLimiteRedaction: new Date(Date.now() - 86400000).toISOString() }); // date limite dépassée : blocage et dérogations

  // ---- dossiers
  const ref = async (k) => c.refs.list(k, O);
  const matieres = await ref('matiere'); const parents = new Set(matieres.map((m) => m.parentCode).filter(Boolean)); const leaves = matieres.filter((m) => !parents.has(m.code));
  const rubriques = await ref('rubrique'); const type = (await ref('type_acte')).find((t) => t.code === 'deliberation');
  const ctxOf = (u) => c.access.loadContext(u);
  let ti = 0;
  const mk = async (cs, { seance = sA, complet = true, financier = false, redacteur } = {}) => {
    const [titre, expose, montant] = TITRES[ti++ % TITRES.length];
    const ctx = await ctxOf(redacteur || cs.red);
    const a = await c.actes.create(ctx, O, { typeId: type.id, titre: `${TAG} ${titre}`, serviceCode: ctx.agent?.service_code && cs.d.services.some((s) => s.code === ctx.agent.service_code) ? ctx.agent.service_code : cs.svc.code });
    const fin = financier || !!montant;
    await c.actes.update(ctx, O, a.id, { matiereId: leaves[ti % leaves.length].id, rubriqueId: rubriques[ti % rubriques.length].id, incidenceFinanciere: fin, montant: fin ? montant : null, rapporteurId: elus[ti % elus.length], seanceViseeId: seance.id });
    if (complet) {
      for (const t of await c.textes.list(ctx, O, a.id)) {
        const md = t.kind === 'expose' ? `${expose}\n\nCette délibération s’inscrit dans les orientations du mandat.` : t.kind === 'visas' ? VISAS : DISPOSITIF(montant);
        await c.textes.commit(ctx, O, a.id, t.id, { markdown: md, baseVersion: t.version });
      }
    }
    return { a, ctx };
  };
  const holderOf = async (id) => (await db.get("SELECT holders FROM step_instances WHERE acte_id = $1 AND status = 'current'", [id]))?.holders?.[0] || null;
  const step = async (id, comment = 'Vu et validé.') => { const u = await holderOf(id); if (!u) return false; await ensureAgent(u); await c.engine.validate(await ctxOf(u), O, id, { comment }); return true; };
  const advanceUntil = async (id, key) => { for (let i = 0; i < 12; i++) { const a = await db.get('SELECT current_step_key FROM actes WHERE id = $1', [id]); if (a.current_step_key === key || !a.current_step_key) return true; if (!(await step(id))) return false; } return false; };
  const annexe = async (ctx, id, titre) => { const buf = await pdf(titre); await c.annexes.add(ctx, O, id, { titre, communicable: true }, { buffer: buf, originalname: `${slug(titre)}.pdf`, size: buf.length, mimetype: 'application/pdf' }); };

  const stats = { dossiers: 0, prets: [] };
  for (const [i, cs] of chosen.entries()) {
    await mk(cs); stats.dossiers++;                                              // 1. brouillon complet
    await mk(cs, { complet: false }); stats.dossiers++;                           // 2. brouillon incomplet
    const en = await mk(cs); await annexe(en.ctx, en.a.id, 'Note de présentation'); await c.engine.submit(en.ctx, O, en.a.id); stats.dossiers++; // 3. en circuit
    const dr = await mk(cs, { financier: i % 2 === 0 }); await annexe(dr.ctx, dr.a.id, 'Projet de convention'); await c.engine.submit(dr.ctx, O, dr.a.id);  // 4. modification suivie par le chef de service
    const chefU = await holderOf(dr.a.id);
    if (chefU) {
      const chefCtx = await ctxOf(chefU);
      const disp = (await c.textes.list(chefCtx, O, dr.a.id)).find((t) => t.kind === 'dispositif');
      const cur = await c.textes.view(chefCtx, O, dr.a.id, disp.id, { mode: 'propre' });
      await c.textes.commit(chefCtx, O, dr.a.id, disp.id, { markdown: cur.markdown.replace('sont inscrits', 'sont inscrits, sur proposition du service,').replace('Article 3', 'Article 3 (précision du chef de service)'), baseVersion: cur.version, reason: 'Relecture du chef de service' });
      await step(dr.a.id, 'Relu, précisé et validé.');
    }
    stats.dossiers++;
    if (i < 3) {                                                                  // 5. modification demandée
      const rf = await mk(cs); await c.engine.submit(rf.ctx, O, rf.a.id);
      const u = await holderOf(rf.a.id);
      if (u) { await c.engine.refuse(await ctxOf(u), O, rf.a.id, { target: 'first', resume: 'direct', motif: 'Précisez la base légale et le plan de financement avant de renvoyer le dossier.' }); stats.dossiers++; }
    }
    for (const seance of [sA, sA, sB]) {                                          // 6. terminés (circuit achevé) : à l'ordre du jour
      if (seance === sB && i >= 2) continue;
      const ok = await mk(cs, { seance }); await annexe(ok.ctx, ok.a.id, 'Annexe financière');
      const com = coms[(i + ti) % Math.max(coms.length, 1)];
      if (com) await c.commissions.addToActe(ok.ctx, O, ok.a.id, com.id);
      await c.engine.submit(ok.ctx, O, ok.a.id);
      const fini = await advanceUntil(ok.a.id, null);
      if (fini && com) await c.commissions.setAvis(meCtx, O, ok.a.id, com.id, { avis: 'favorable', commentaire: 'Avis favorable à l’unanimité des présents.', datePassage: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) });
      stats.dossiers++; if (fini) stats.prets.push({ id: ok.a.id, seance });
    }
    if (i === 0) { await mk(cs, { seance: sC }); stats.dossiers++; }             // brouillon visant la séance dont la date limite est dépassée
  }

  // ---- exposé amendé par une personne de chaque étape du circuit (suivi des modifications)
  {
    const cs = chosen[0]; const red = await ctxOf(cs.red);
    const a = await c.actes.create(red, O, { typeId: type.id, titre: `${TAG} Subvention à l’association Ivry en Fête pour le festival du Petit-Ivry (exposé amendé à chaque étape)`, serviceCode: red.agent?.service_code || cs.svc.code });
    await c.actes.update(red, O, a.id, { matiereId: leaves[0].id, rubriqueId: rubriques[0].id, incidenceFinanciere: true, montant: 18000, rapporteurId: elus[0], seanceViseeId: sA.id });
    for (const t of await c.textes.list(red, O, a.id)) await c.textes.commit(red, O, a.id, t.id, { markdown: t.kind === 'expose' ? BASE : t.kind === 'visas' ? VISAS : DISPOSITIF(18000), baseVersion: t.version });
    await c.engine.submit(red, O, a.id);
    for (let i = 0; i < 12; i++) {
      const cur = await db.get('SELECT current_step_key FROM actes WHERE id = $1', [a.id]);
      if (!cur.current_step_key) break;
      const u = await holderOf(a.id); if (!u) break;
      await ensureAgent(u); const w = await ctxOf(u); const edit = EDITS[cur.current_step_key];
      if (edit) {
        const ex = (await c.textes.list(w, O, a.id)).find((t) => t.kind === 'expose');
        const v = await c.textes.view(w, O, a.id, ex.id, { mode: 'propre' });
        await c.textes.commit(w, O, a.id, ex.id, { markdown: edit[0](v.markdown), baseVersion: v.version, reason: edit[1] });
      }
      await c.engine.validate(w, O, a.id, { comment: 'Relu, modifié et validé.' });
    }
    stats.dossiers++; stats.amende = a.id; if (!(await db.get('SELECT current_step_key FROM actes WHERE id = $1', [a.id])).current_step_key) stats.prets.push({ id: a.id, seance: sA });
  }

  // ---- ordre du jour de la séance du 3 décembre : procès-verbal, communications, dossiers terminés, questions diverses
  await c.odj.addPoint(meCtx, O, sA.id, { kind: 'libre', titre: 'Approbation du procès-verbal de la séance précédente', numerote: true });
  await c.odj.addPoint(meCtx, O, sA.id, { kind: 'libre', titre: 'Communication des décisions du Maire', numerote: true });
  for (const p of stats.prets.filter((x) => x.seance === sA)) { try { await c.odj.affecter(meCtx, O, sA.id, { acteIds: [p.id] }); } catch (e) { console.warn(`  affectation impossible (dossier ${p.id}) : ${e.message}`); } }
  await c.odj.addPoint(meCtx, O, sA.id, { kind: 'libre', titre: 'Questions diverses', numerote: true });
  for (const p of stats.prets.filter((x) => x.seance === sB)) { try { await c.odj.affecter(meCtx, O, sB.id, { acteIds: [p.id] }); } catch (e) { console.warn(`  affectation impossible (dossier ${p.id}) : ${e.message}`); } }
  const itemsA = await db.get('SELECT count(*)::int AS n FROM seance_items WHERE seance_id = $1', [sA.id]);

  // les notifications créées pendant la constitution du jeu ne sont pas destinées aux vraies personnes : on les retire
  await db.run("DELETE FROM notifications WHERE acte_id IN (SELECT id FROM actes WHERE titre LIKE $1)", [`${TAG}%`]);
  await db.run("DELETE FROM notification_log WHERE acte_id IN (SELECT id FROM actes WHERE titre LIKE $1)", [`${TAG}%`]);
  console.log(`\nJeu d'exemple créé : ${stats.dossiers} dossiers (dont l'exposé amendé n° ${stats.amende}), 3 séances ; séance du 3 décembre 2026 (n° ${sA.id}) : ${itemsA.n} points à l'ordre du jour.`);
  await db.close();
}

main().catch((e) => { console.error('Échec du jeu d’exemple :', e); process.exit(1); });
