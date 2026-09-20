/**
 * Jeu de données de DÉMONSTRATION pour tester l'application à la main.
 * Crée, sur l'organigramme RÉEL du Hub DSI (lecture seule) : des agents fictifs « demo.* », les titulaires, les groupes de
 * valideurs, des élus, des commissions, des séances et des dossiers à tous les stades du circuit.
 * Aucun mail n'est envoyé (MailPort factice) et rien n'est écrit dans le Hub ou l'AD.
 *
 *   node scripts/seed-demo.js            crée le jeu (refuse s'il existe déjà)
 *   node scripts/seed-demo.js --reset    supprime d'abord les actes et agents « demo.* » puis recrée
 *
 * Connexion aux comptes fictifs : DEV_LOGIN_PASSWORD du .env (identifiants demo.<rôle>.<direction>, voir la fin de l'exécution).
 * Compte de l'utilisateur réel (variable SEED_ME, défaut « machevalier ») : administrateur + SCC + directeur de sa direction.
 */
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { createHubDirectory } = require('../src/adapters/hub-directory');
const { createFakeAuth, createFakeMail, createFakeAi, createFakeMeeting } = require('../src/adapters/fake-directory');
const { buildContainer } = require('../src/container');
const { bootstrap } = require('../src/bootstrap');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const ME = (process.env.SEED_ME || 'machevalier').toLowerCase();
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000);

const TITRES = [
  ['Attribution d\'une subvention exceptionnelle à l\'association Ivry Sport Jeunesse', 'Le conseil est invité à soutenir l\'action de l\'association en faveur de la pratique sportive des jeunes ivryens.', 4500],
  ['Convention pluriannuelle d\'objectifs 2026-2028 avec le Théâtre des Quartiers d\'Ivry', 'La précédente convention triennale arrive à son terme ; la Ville souhaite renouveler son engagement partenarial.', 120000],
  ['Approbation du règlement intérieur des accueils de loisirs', 'Le règlement précise les conditions d\'accueil, d\'inscription et de tarification des accueils de loisirs municipaux.', null],
  ['Avenant n°2 au marché de fourniture de repas pour la restauration scolaire', 'L\'avenant ajuste les quantités et prend en compte la revalorisation des prix prévue au contrat.', 38000],
  ['Création d\'un poste de chargé de mission transition écologique', 'Pour piloter le plan climat, il est proposé de créer un emploi permanent de catégorie A.', 62000],
  ['Modification du tableau des effectifs au 1er janvier', 'Les évolutions de services rendent nécessaires plusieurs créations et suppressions de postes.', null],
  ['Cession d\'une parcelle communale, rue Marat, à un bailleur social', 'La cession permet la réalisation de logements sociaux conformément au programme local de l\'habitat.', 850000],
  ['Adhésion de la Ville au groupement de commandes pour l\'achat d\'électricité', 'Le groupement permet de mutualiser les achats d\'énergie et d\'obtenir de meilleurs prix.', 210000],
  ['Tarification des activités de la médiathèque pour l\'année 2027', 'La grille tarifaire est actualisée pour tenir compte de l\'inflation et de la fréquentation.', null],
  ['Autorisation de signer la convention de mise à disposition de la salle Robespierre', 'La salle sera mise à disposition d\'associations locales à titre gracieux, selon un calendrier partagé.', null],
];
const DISPOSITIF = (n) => `Article 1 : Le conseil municipal approuve la présente délibération ${n ? `pour un montant de ${n.toLocaleString('fr-FR')} euros` : ''}.\nArticle 2 : Monsieur le Maire, ou son représentant délégué, est autorisé à signer tout document nécessaire à son exécution.\nArticle 3 : Les crédits correspondants sont inscrits au budget de l'exercice en cours.`;
const VISAS = 'Vu le code général des collectivités territoriales, notamment ses articles L. 2121-29 et L. 2311-1 ;\nVu l\'avis de la commission compétente ;\nConsidérant l\'intérêt communal de l\'opération ;';

async function pdf(title) {
  const d = await PDFDocument.create();
  for (let i = 1; i <= 2; i++) { const p = d.addPage([595, 842]); p.drawText(`${title} — page ${i}`, { x: 50, y: 780, size: 14 }); p.drawText('Document de démonstration VibeDélib', { x: 50, y: 750, size: 10 }); }
  return Buffer.from(await d.save());
}

async function main() {
  const config = loadConfig();
  const log = createLogger('warn');
  const db = createDb(config, log);
  await migrate(db, log);
  const c = buildContainer({ config, log, db, ad: createFakeAuth({}), directoryAdapter: createHubDirectory(config), mail: createFakeMail(), ai: createFakeAi(), meeting: createFakeMeeting({ available: false }) });
  const org = await bootstrap(c);
  const O = org.id;
  const sys = { username: 'seed', isPlatformAdmin: true, organismes: [], roles: [], orgIds: [O], agent: null, displayName: 'seed' };

  if (process.argv.includes('--reset')) {
    const users = (await db.all("SELECT username FROM agent_ref WHERE source = 'demo'")).map((r) => r.username);
    if (users.length) {
      await db.run('DELETE FROM actes WHERE redacteur = ANY($1::text[])', [users]);
      await db.run('DELETE FROM titulaires WHERE username = ANY($1::text[]) OR created_by = $2', [users, 'seed']);
      await db.run('DELETE FROM user_org_roles WHERE username = ANY($1::text[])', [users]);
      await db.run('DELETE FROM commissions WHERE organisme_id = $1', [O]);
      await db.run('DELETE FROM groupes_politiques WHERE organisme_id = $1', [O]);
      await db.run("DELETE FROM notifications WHERE username LIKE 'demo.%' OR username LIKE 'elu:%'");
      await db.run("DELETE FROM notification_log WHERE recipient LIKE 'demo.%' OR recipient LIKE 'elu:%'");
      await db.run('DELETE FROM seance_items WHERE organisme_id = $1', [O]);
      await db.run('DELETE FROM seances WHERE organisme_id = $1 AND created_by = $2', [O, 'seed']);
      await db.run('DELETE FROM elus WHERE organisme_id = $1 AND email LIKE $2', [O, '%@demo.ivry']);
      await db.run("DELETE FROM agent_ref WHERE source = 'demo'");
      console.log(`Jeu de démonstration précédent supprimé (${users.length} agents).`);
    }
  } else if ((await db.get("SELECT 1 AS x FROM agent_ref WHERE source = 'demo' LIMIT 1"))) {
    console.log('Le jeu de démonstration existe déjà. Relancez avec --reset pour le recréer.'); await db.close(); return;
  }

  // ---- directions réelles (Hub) : la DSI de l'utilisateur d'abord, puis les premières qui ont des services
  const all = (await c.dir.directions()).filter((d) => d.code && d.services?.length);
  const meRow = await db.get('SELECT * FROM agent_ref WHERE username = $1', [ME]);
  const mine = all.find((d) => d.code === meRow?.direction_code) || all.find((d) => /SYSTEMES D'INFORMATION/i.test(d.label));
  const dirs = [...(mine ? [mine] : []), ...all.filter((d) => d !== mine)].slice(0, 6);
  if (!dirs.length) throw new Error("Aucune direction n'a pu être lue dans l'organigramme du Hub");
  console.log(`Directions retenues : ${dirs.map((d) => d.label).join(' | ')}`);

  // ---- agents fictifs
  const agent = (username, nom, prenom, poste, d, s) => db.run(
    `INSERT INTO agent_ref (username, nom, prenom, display_name, email, direction_code, direction_label, service_code, service_label, poste, source, actif)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'demo',true) ON CONFLICT (username) DO NOTHING`,
    [username, nom, prenom, `${prenom} ${nom}`, `${username}@demo.ivry`, d?.code ?? null, d?.label ?? null, s?.code ?? null, s?.label ?? null, poste]);
  const NOMS = [['Martin', 'Claire'], ['Bernard', 'Julien'], ['Dubois', 'Nadia'], ['Petit', 'Karim'], ['Moreau', 'Sophie'], ['Laurent', 'Thomas'], ['Simon', 'Inès'], ['Michel', 'Paul'], ['Garcia', 'Lucie'], ['Roux', 'Hugo']];
  let ni = 0; const next = () => NOMS[ni++ % NOMS.length];
  const cast = {};
  for (const d of dirs) {
    const k = String(d.code).toLowerCase(); const svc = d.services[0];
    cast[d.code] = { d, k, red: `demo.red.${k}`, dir: `demo.dir.${k}`, dga: `demo.dga.${k}`, chefs: {} };
    let [n, p] = next(); await agent(cast[d.code].red, n, p, 'Rédacteur·rice', d, svc);
    [n, p] = next(); await agent(cast[d.code].dir, n, p, 'Directeur·rice', d, null);
    [n, p] = next(); await agent(cast[d.code].dga, n, p, 'Directeur·rice général·e adjoint·e', d, null);
    for (const s of d.services) { const u = `demo.chef.${k}.${String(s.code).toLowerCase()}`; cast[d.code].chefs[s.code] = u; [n, p] = next(); await agent(u, n, p, 'Chef·fe de service', d, s); }
  }
  const common = { fin: 'demo.finances', jur: 'demo.juriste', scc: 'demo.scc', dgs: 'demo.dgs' };
  await agent(common.fin, 'Lefèvre', 'Amélie', 'Contrôleuse de gestion', null, null); await agent(common.jur, 'Faure', 'Marc-Antoine', 'Juriste', null, null);
  await agent(common.scc, 'Andre', 'Béatrice', 'Secrétaire des assemblées', null, null); await agent(common.dgs, 'Mercier', 'Olivier', 'Directeur général des services', null, null);

  // ---- rôles et titulaires
  const role = (u, r) => db.run('INSERT INTO user_org_roles (username, organisme_id, role, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [u, O, r, 'seed']);
  await role(common.scc, 'scc'); await role(ME, 'org_admin'); await role(ME, 'scc');
  const tit = (fonction, username, extra = {}) => c.titulaires.add(sys, O, { fonction, username, ...extra });
  await tit('dgs', common.dgs);
  for (const cs of Object.values(cast)) {
    const d = cs.d.code;
    await tit('directeur', cs.d.code === mine?.code ? ME : cs.dir, { directionCode: d });
    await tit('dga', cs.dga, { directionCode: d });
    for (const [sc, u] of Object.entries(cs.chefs)) await tit('chef_service', u, { directionCode: d, serviceCode: sc });
  }
  const groups = (await c.titulaires.groups(O));
  const setG = (code, users) => c.titulaires.setGroupMembers(sys, O, groups.find((g) => g.code === code).id, users);
  await setG('financier', [common.fin]); await setG('juridique', [common.jur]); await setG('scc', [common.scc]);

  // ---- élus, groupes, commissions, séances
  const gm = await c.elus.createGroupe(sys, O, { nom: 'Majorité municipale', couleur: '#2563EB', ordre: 1 });
  const go = await c.elus.createGroupe(sys, O, { nom: 'Opposition', couleur: '#D97706', ordre: 2 });
  // 39 conseillers fictifs (31 majorité, 8 opposition) ; les commissions viennent de seeds/commissions.json (délibération de création)
  const NOMS_E = ['Durand', 'Lemaire', 'Roussel', 'Benali', 'Vidal', 'Perrin', 'Nguyen', 'Colas', 'Fabre', 'Morin', 'Girard', 'Lambert', 'Chevalier', 'Blanc', 'Guerin', 'Boyer', 'Garnier', 'Mercier', 'Renard', 'Marchand', 'Dupuis', 'Lopez', 'Fontaine', 'Rolland', 'Leclerc', 'Meyer', 'Barre', 'Brun', 'Aubert', 'Poirier', 'Carpentier', 'Huet', 'Charpentier', 'Klein', 'Hamon', 'Collet', 'Jacob', 'Leroux', 'Da Silva'];
  const PRENOMS_E = ['Patrick', 'Inès', 'Yann', 'Samia', 'Étienne', 'Colette', 'David', 'Jeanne', 'Malik', 'Hélène', 'Bruno', 'Aïcha', 'Serge', 'Léa', 'Omar', 'Chloé', 'Rémi', 'Fatou', 'Marc', 'Nora', 'Alain', 'Sonia', 'Lucas', 'Mireille', 'Ibrahim', 'Camille', 'Denis', 'Zoé', 'Jacques', 'Manon', 'Karim', 'Odile', 'Vincent', 'Anaïs', 'Paul', 'Sarah', 'Louis', 'Nadège', 'Ali'];
  const ROLES_E = { 0: 'Maire', 1: 'Adjointe aux finances', 2: 'Adjoint à l’urbanisme', 3: 'Adjointe à la culture', 7: 'Adjointe à l’éducation' };
  const elus = [];
  for (let i = 0; i < 39; i++) {
    const opp = i >= 31;
    elus.push(await c.elus.create(sys, O, { nom: NOMS_E[i], prenom: PRENOMS_E[i], role: ROLES_E[i] || (i < 12 ? 'Adjoint·e' : 'Conseiller·ère municipal·e'), email: `${slug(PRENOMS_E[i])}.${slug(NOMS_E[i])}@demo.ivry`, groupeId: (opp ? go : gm).id }));
  }
  const maj = elus.slice(0, 31); const oppo = elus.slice(31);
  const COMS = require('../seeds/commissions.json');
  const coms = [];
  for (const [i, def] of COMS.entries()) {
    const cm = await c.commissions.create(sys, O, { nom: def.nom, description: def.thematiques.slice(0, 4).join(' · ') + '…', thematiques: def.thematiques, sieges: def.sieges, siegesOpposition: def.siegesOpposition, ordre: i });
    const pick = (list, n, off) => Array.from({ length: n }, (_, k) => list[(off + k) % list.length]);
    const members = [...pick(maj, def.sieges - def.siegesOpposition, i * 7 + 1), ...pick(oppo, def.siegesOpposition, i * 2)];
    await c.commissions.setMembres(sys, O, cm.id, members.map((e, j) => ({ eluId: e.id, fonction: j === 0 ? 'president' : j === 1 ? 'vice_president' : 'membre' })));
    await c.commissions.setSecretaires(sys, O, cm.id, [common.scc]);
    coms.push(cm);
  }
  const inst = (await c.seances.instances(O))[0];
  const mkSeance = (days, extra = {}) => c.seances.create({ ...sys, username: 'seed' }, O, { instanceId: inst.id, dateSeance: inDays(days).toISOString(), lieu: 'Salle du conseil, Hôtel de ville', ...extra });
  const sA = await mkSeance(75); const sB = await mkSeance(110);
  const sC = await mkSeance(14, { dateLimiteRedaction: inDays(-1).toISOString() }); // date limite dépassée : pour tester le blocage et les dérogations

  // ---- dossiers
  const ref = async (k) => c.refs.list(k, O);
  const matieres = await ref('matiere'); const parents = new Set(matieres.map((m) => m.parentCode).filter(Boolean)); const leaves = matieres.filter((m) => !parents.has(m.code));
  const rubriques = await ref('rubrique'); const type = (await ref('type_acte')).find((t) => t.code === 'deliberation');
  const ctxOf = (u) => c.access.loadContext(u);
  let ti = 0;
  const mk = async (cs, { seance = sA, complet = true, financier = false, service } = {}) => {
    const [titre, expose, montant] = TITRES[ti++ % TITRES.length];
    const ctx = await ctxOf(cs.red);
    const svc = service || cs.d.services[0];
    const a = await c.actes.create(ctx, O, { typeId: type.id, titre, serviceCode: svc.code });
    const fin = financier || !!montant;
    await c.actes.update(ctx, O, a.id, {
      matiereId: leaves[ti % leaves.length].id, rubriqueId: rubriques[ti % rubriques.length].id, incidenceFinanciere: fin, montant: fin ? montant : null,
      rapporteurId: elus[ti % elus.length].id, seanceViseeId: seance.id,
    });
    if (complet) {
      for (const t of await c.textes.list(ctx, O, a.id)) {
        const md = t.kind === 'expose' ? `${expose}\n\nCette délibération s'inscrit dans les orientations du mandat.` : t.kind === 'visas' ? VISAS : DISPOSITIF(montant);
        await c.textes.commit(ctx, O, a.id, t.id, { markdown: md, baseVersion: t.version });
      }
    }
    return { a, ctx };
  };
  const NEXT_USER = { chef_service: (cs, a) => cs.chefs[a.service_code] || Object.values(cs.chefs)[0], directeur: (cs) => (cs.d.code === mine?.code ? ME : cs.dir), financier: () => common.fin, juridique: () => common.jur, dga: (cs) => cs.dga, dgs: () => common.dgs, scc: () => common.scc };
  const step = async (cs, id) => {
    const a = await db.get('SELECT * FROM actes WHERE id = $1', [id]);
    const who = await ctxOf(NEXT_USER[a.current_step_key](cs, a));
    await c.engine.validate(who, O, id, { comment: 'Vu et validé.' });
  };
  const advanceUntil = async (cs, id, key) => { for (let i = 0; i < 12; i++) { const a = await db.get('SELECT current_step_key FROM actes WHERE id = $1', [id]); if (a.current_step_key === key || !a.current_step_key) return; await step(cs, id); } };
  const annexe = async (ctx, id, titre) => { const buf = await pdf(titre); await c.annexes.add(ctx, O, id, { titre, communicable: true }, { buffer: buf, originalname: `${slug(titre)}.pdf`, size: buf.length, mimetype: 'application/pdf' }); };

  const stats = { dossiers: 0 };
  for (const [i, cs] of Object.values(cast).entries()) {
    // 1. brouillon complet   2. brouillon incomplet   3. en circuit (chef)   4. chez le directeur (avec modification suivie)   5. modification demandée   6. terminé
    await mk(cs); stats.dossiers++;
    const inc = await mk(cs, { complet: false }); stats.dossiers++; void inc;
    const en = await mk(cs); await annexe(en.ctx, en.a.id, 'Note de présentation'); await c.engine.submit(en.ctx, O, en.a.id); stats.dossiers++;
    const dr = await mk(cs, { financier: i % 2 === 0 }); await annexe(dr.ctx, dr.a.id, 'Projet de convention'); await c.engine.submit(dr.ctx, O, dr.a.id);
    const chefCtx = await ctxOf(NEXT_USER.chef_service(cs, await db.get('SELECT * FROM actes WHERE id = $1', [dr.a.id])));
    const disp = (await c.textes.list(chefCtx, O, dr.a.id)).find((t) => t.kind === 'dispositif');
    const cur = await c.textes.view(chefCtx, O, dr.a.id, disp.id, { mode: 'propre' });
    await c.textes.commit(chefCtx, O, dr.a.id, disp.id, { markdown: cur.markdown.replace('sont inscrits', 'sont inscrits, sur proposition du service,').replace('Article 3', 'Article 3 (précision du chef de service)'), baseVersion: cur.version, reason: 'Relecture du chef de service' });
    await c.comments.add(chefCtx, O, dr.a.id, { body: `Merci de vérifier le montant avec @${common.fin}.` });
    await step(cs, dr.a.id); stats.dossiers++;
    if (i < 3) {
      const rf = await mk(cs); await c.engine.submit(rf.ctx, O, rf.a.id);
      await c.engine.refuse(await ctxOf(NEXT_USER.chef_service(cs, await db.get('SELECT * FROM actes WHERE id = $1', [rf.a.id]))), O, rf.a.id, { target: 'first', resume: 'direct', motif: 'Précisez la base légale et le plan de financement avant de renvoyer le dossier.' }); stats.dossiers++;
      const ok = await mk(cs, { seance: sB });
      await annexe(ok.ctx, ok.a.id, 'Annexe financière'); await c.commissions.addToActe(ok.ctx, O, ok.a.id, coms[i % coms.length].id);
      await c.engine.submit(ok.ctx, O, ok.a.id); await advanceUntil(cs, ok.a.id, null); stats.dossiers++;
      await c.commissions.setAvis(await ctxOf(common.scc), O, ok.a.id, coms[i % coms.length].id, { avis: 'favorable', commentaire: 'Avis favorable à l\'unanimité des présents.', datePassage: inDays(-2).toISOString().slice(0, 10) });
    }
    if (i === 0) { const late = await mk(cs, { seance: sC }); void late; stats.dossiers++; } // brouillon visant la séance dont la date limite est dépassée
  }
  const login = [`${ME} (vous : administrateur, SCC, directeur de sa direction)`, ...Object.values(cast).slice(0, 3).flatMap((cs) => [cs.red, cs.dir]), common.scc, common.dgs, common.fin, common.jur];
  console.log(`\nJeu de démonstration créé : ${stats.dossiers} dossiers, ${dirs.length} directions, ${elus.length} élus, ${coms.length} commissions, 3 séances.`);
  console.log('Comptes utilisables avec DEV_LOGIN_PASSWORD :\n  ' + login.join('\n  '));
  await db.close();
}

main().catch((e) => { console.error('Échec du jeu de démonstration :', e); process.exit(1); });
