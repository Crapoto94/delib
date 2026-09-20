const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let elus; let acteId;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const O = () => `${base()}/seances/${seance.id}/odj`;
const T = (p = '') => `${base()}/seances/${seance.id}/tenue${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const etat = async (u = 'martin') => (await as(t[u]).get(T())).body;
const eluOf = (s, id) => s.groupes.flatMap((g) => g.elus).find((e) => e.id === id);
const presence = (eluIds, e) => as(t.martin).put(T('/presences'), { eluIds, etat: e });
const ids = (...n) => n.map((i) => elus[i].id);
const pointDelib = async () => (await etat()).points.find((p) => p.kind === 'deliberation');
const pointLibre = async () => (await etat()).points.find((p) => p.kind === 'libre');
const vote = (itemId, votes) => as(t.martin).put(T(`/points/${itemId}/votes`), { votes });
const clore = (itemId, body = { issue: 'vote' }) => as(t.martin).post(T(`/points/${itemId}/cloture`), body);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubriques = await items('rubrique');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  const gm = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Majorité', couleur: '#2563EB', ordre: 1 })).body;
  const go = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Opposition', couleur: '#DC2626', ordre: 2 })).body;
  elus = [];
  for (const [nom, prenom, g] of [['Durif', 'Paul', gm], ['Lambert', 'Jeanne', gm], ['Morel', 'Yann', gm], ['Petit', 'Sara', gm], ['Rey', 'Omar', go], ['Blanc', 'Lise', go]]) {
    elus.push((await as(admin).post(`${base()}/elus`, { nom, prenom, role: 'Conseiller municipal', groupeId: g.id })).body);
  }
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(20) })).body;
  // une délibération à l'ordre du jour, et un point libre
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Subvention à l’association Ivry Sport' })).body; acteId = a.id;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  await as(t.martin).post(`${O()}/affectations`, { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  await as(t.martin).post(`${O()}/points`, { kind: 'libre', titre: 'Communication des décisions du Maire', numerote: true });
  await as(t.martin).post(`${O()}/arret`, { forcer: true });
});
afterAll(async () => { await env.close(); });

describe('ouverture et droits', () => {
  it('la séance n’est pas ouverte tant que le secrétariat ne l’a pas ouverte ; les autres membres suivent en lecture seule', async () => {
    expect((await etat()).tenue).toMatchObject({ statut: 'non_ouverte', version: 0 });
    expect((await as(t.martin).put(T('/presences'), { eluIds: ids(0), etat: 'en_salle' })).status).toBe(409);
    expect((await as(t.dupont).post(T('/ouverture'))).status).toBe(403);
    const o = await as(t.martin).post(T('/ouverture'));
    expect(o.status).toBe(200);
    expect(o.body.tenue).toMatchObject({ statut: 'ouverte', version: 1 });
    expect((await as(t.martin).get(`${base()}/seances/${seance.id}`)).body.statut).toBe('tenue');
    const v = await etat('dupont');
    expect(v.peutSaisir).toBe(false);
    expect(v).not.toHaveProperty('notes'); expect(v).not.toHaveProperty('journal');
    expect((await as(t.dupont).put(T('/presences'), { eluIds: ids(0), etat: 'en_salle' })).status).toBe(403);
    expect((await env.http().get(T())).status).toBe(401);
    expect((await as(t.martin).post(T('/ouverture'))).body.tenue.version).toBe(1); // idempotent
  });

  it('les élus sont classés par groupe (Majorité, Opposition) et tous absents au départ', async () => {
    const s = await etat();
    expect(s.groupes.map((g) => [g.nom, g.elus.length])).toEqual([['Majorité', 4], ['Opposition', 2], ['Sans groupe', 1]]);
    expect(s.groupes.flatMap((g) => g.elus).every((e) => e.presence === 'absent' && e.droit === 'aucun')).toBe(true);
    expect(s.quorum).toMatchObject({ membres: 7, requis: 4, enSalle: 0, atteint: false });
  });
});

describe('présences, sorties, retours et pouvoirs', () => {
  it('saisit les présences par groupe, horodate les sorties et les retours, calcule le quorum', async () => {
    let s = (await presence(ids(0, 1, 2, 3), 'en_salle')).body;
    expect(s.quorum).toMatchObject({ enSalle: 4, atteint: true });
    s = (await presence(ids(3), 'sorti')).body;
    expect(eluOf(s, elus[3].id)).toMatchObject({ presence: 'sorti', droit: 'aucun' });
    expect(s.quorum.enSalle).toBe(3); expect(s.quorum.atteint).toBe(false); // alerte : le quorum n’est plus atteint
    s = (await presence(ids(3), 'en_salle')).body;
    expect(s.quorum.atteint).toBe(true);
    const types = s.journal.filter((j) => j.eluId === elus[3].id).map((j) => j.type).reverse();
    expect(types).toEqual(['arrivee', 'sortie', 'retour']);
    s = (await presence(ids(5), 'sorti')).body; // un élu jamais arrivé ne peut pas être « sorti »
    expect(eluOf(s, elus[5].id).presence).toBe('absent');
  });

  it('un seul pouvoir par mandataire, pas de chaîne, pas d’auto-pouvoir', async () => {
    const p = (mandant, mandataire) => as(t.martin).put(T('/procurations'), { mandantId: elus[mandant].id, mandataireId: elus[mandataire].id });
    expect((await p(5, 4)).status).toBe(200); // Blanc donne pouvoir à Rey
    expect((await p(1, 1)).status).toBe(400);
    const dbl = await p(0, 4); expect(dbl.status).toBe(409); expect(dbl.body.error).toMatch(/un seul pouvoir par mandataire/);
    expect((await p(4, 0)).status).toBe(409); // Rey est mandataire : il ne peut pas donner pouvoir
    expect((await p(0, 5)).status).toBe(409); // Blanc est mandant : il ne peut pas être mandataire
    const s = await etat();
    expect(eluOf(s, elus[5].id)).toMatchObject({ pouvoirA: elus[4].id, droit: 'aucun' }); // Rey est absent : le pouvoir n’est pas effectif
    expect(eluOf(s, elus[4].id).pouvoirDe).toBe(elus[5].id);
  });
});

describe('point en cours partagé, notes', () => {
  it('le point choisi (ou suivant) s’affiche pour tous ; les notes ne sont visibles que du secrétariat', async () => {
    const d = await pointDelib();
    let s = (await as(t.martin).put(T('/courant'), { sens: 'suivant' })).body;
    expect(s.courant).toMatchObject({ id: d.id, etat: 'en_cours' });
    expect((await etat('dupont')).courant.id).toBe(d.id); // un suiveur voit le même point
    await as(t.martin).put(T('/notes'), { notes: 'Séance ouverte à 18 h 05.' });
    await as(t.martin).put(T(`/points/${d.id}/notes`), { notes: 'Intervention de M. Rey.' });
    s = await etat();
    expect(s.notes).toBe('Séance ouverte à 18 h 05.');
    expect(s.courant.notes).toBe('Intervention de M. Rey.');
    expect((await etat('dupont')).courant).not.toHaveProperty('notes');
    expect((await as(t.martin).put(T('/courant'), { itemId: 999999 })).status).toBe(404);
    expect((await as(t.martin).put(T('/courant'), {})).status).toBe(400);
  });

  it('la synchronisation en direct : une page en attente est réveillée dès qu’un autre passe au point suivant', async () => {
    const v0 = (await etat()).tenue.version;
    const t0 = Date.now();
    const attente = as(t.dupont).get(`${T()}?since=${v0}&wait=10`); // une page de suivi ouverte, en attente
    await new Promise((r) => setTimeout(r, 300));
    const libre = await pointLibre();
    await as(t.martin).put(T('/courant'), { itemId: libre.id });
    const r = await attente;
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.body.tenue.version).toBeGreaterThan(v0);
    expect(r.body.courant.id).toBe(libre.id);
    const rien = await as(t.dupont).get(`${T()}?since=${r.body.tenue.version}&wait=1`); // rien de nouveau
    expect(rien.body).toMatchObject({ unchanged: true });
    await as(t.martin).put(T('/courant'), { itemId: (await pointDelib()).id }); // retour à la délibération
  });
});

describe('votes : par élu ou par groupe, absents exclus, pouvoirs', () => {
  it('les absents et les sortis ne prennent pas part au vote, ni pour eux ni pour leur mandant', async () => {
    const d = await pointDelib();
    // Rey (mandataire de Blanc) est absent : ni lui ni Blanc ne peuvent voter
    const r = await vote(d.id, [{ eluId: elus[4].id, choix: 'pour' }, { eluId: elus[5].id, choix: 'pour' }]);
    expect(r.status).toBe(200);
    expect(eluOf(r.body, elus[4].id).vote).toBeNull(); expect(eluOf(r.body, elus[5].id).vote).toBeNull();
    expect(r.body.courant.decompteLive).toMatchObject({ pour: 0, absents: 3, manquants: 4 });
  });

  it('vote de tout un groupe d’un coup, puis exception (« ne prend pas part au vote »), pouvoir exercé par le mandataire', async () => {
    const d = await pointDelib();
    await presence(ids(4), 'en_salle'); // Rey arrive : Blanc vote par lui
    let s = await etat();
    expect(eluOf(s, elus[5].id).droit).toBe('pouvoir');
    const majorite = s.groupes.find((g) => g.nom === 'Majorité').elus.map((e) => ({ eluId: e.id, choix: 'pour' }));
    s = (await vote(d.id, majorite)).body;
    expect(s.groupes.find((g) => g.nom === 'Majorité').elus.every((e) => e.vote === 'pour')).toBe(true);
    s = (await vote(d.id, [{ eluId: elus[3].id, choix: 'nppv' }, { eluId: elus[4].id, choix: 'contre' }, { eluId: elus[5].id, choix: 'contre' }])).body;
    expect(s.courant.decompteLive).toMatchObject({ pour: 3, contre: 2, nppv: 1, absents: 1, manquants: 0 });
  });

  it('refuse de clore tant qu’un élu qui doit voter n’a pas de choix', async () => {
    const d = await pointDelib();
    await vote(d.id, [{ eluId: elus[2].id, choix: null }]);
    const r = await clore(d.id);
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/1 élu\(s\) doivent encore voter : Yann Morel/);
    await vote(d.id, [{ eluId: elus[2].id, choix: 'pour' }]);
  });

  it('partage des voix : refusé sans président, la voix prépondérante tranche ; résultat -> statut de l’acte ; voix non exercées « absent »', async () => {
    const d = await pointDelib();
    await presence(ids(1), 'sorti'); // Lambert quitte la salle : sa voix n’est pas exercée
    // pour : Durif, Morel ; contre : Rey et Blanc (par pouvoir) ; NPPV : Petit ; sortie : Lambert -> égalité 2 / 2
    const r = await clore(d.id);
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/Partage des voix/);
    expect((await as(t.martin).put(T('/bureau'), { presidentId: elus[4].id })).status).toBe(200); // le président (Rey) a voté contre : sa voix tranche
    const ok = await clore(d.id);
    expect(ok.status).toBe(200);
    const p = ok.body.points.find((x) => x.id === d.id);
    expect(p).toMatchObject({ etat: 'traite', resultat: 'rejete_preponderante' });
    expect(p.decompte).toMatchObject({ pour: 2, contre: 2, nppv: 1, absents: 2, votants: 4 });
    expect((await as(t.dupont).get(A(acteId))).body.statut).toBe('rejete');
    expect(eluOf(ok.body, elus[1].id).vote).toBe('absent'); // enregistré : voix non exercée
    expect((await clore(d.id)).status).toBe(409); // déjà clos
    expect((await vote(d.id, [{ eluId: elus[0].id, choix: 'contre' }])).status).toBe(409); // votes figés
  });

  it('un point rouvert (motif obligatoire) redonne à l’acte son statut d’ordre du jour ; unanimité avec tout le monde en salle', async () => {
    const d = await pointDelib();
    expect((await as(t.martin).post(T(`/points/${d.id}/reouverture`), {})).status).toBe(400);
    const r = await as(t.martin).post(T(`/points/${d.id}/reouverture`), { motif: 'Erreur de saisie du vote de M. Rey' });
    expect(r.status).toBe(200);
    expect(r.body.points.find((x) => x.id === d.id)).toMatchObject({ etat: 'en_cours', resultat: null });
    expect((await as(t.dupont).get(A(acteId))).body.statut).toBe('inscrit_odj');
    await presence(ids(0, 1, 2, 3, 4), 'en_salle');
    await as(t.martin).del(T(`/procurations/${elus[5].id}`));
    await presence(ids(5), 'en_salle');
    await presence([(await etat()).groupes.find((g) => g.nom === 'Sans groupe').elus[0].id], 'en_salle');
    const tous = (await etat()).groupes.flatMap((g) => g.elus).map((e) => ({ eluId: e.id, choix: 'pour' }));
    expect((await vote(d.id, tous)).body.courant.decompteLive).toMatchObject({ pour: 7, contre: 0, absents: 0, manquants: 0 });
    const ok = await clore(d.id);
    expect(ok.body.points.find((x) => x.id === d.id)).toMatchObject({ resultat: 'adopte_unanimite' });
    expect((await as(t.dupont).get(A(acteId))).body.statut).toBe('adopte');
  });
});

describe('autres issues, clôture de la séance', () => {
  it('un point libre peut être clos sans vote ; plus rien à traiter ensuite', async () => {
    const l = await pointLibre();
    await as(t.martin).put(T('/courant'), { itemId: l.id });
    const r = await clore(l.id, { issue: 'sans_vote' });
    expect(r.status).toBe(200);
    expect(r.body.points.find((x) => x.id === l.id).etat).toBe('sans_vote');
    expect((await as(t.martin).put(T('/courant'), { sens: 'suivant' })).status).toBe(409);
  });

  it('refuse de clore la séance tant qu’un point est en cours, puis verrouille ; un administrateur peut déverrouiller', async () => {
    const d = await pointDelib();
    await as(t.martin).post(T(`/points/${d.id}/reouverture`), { motif: 'Nouvelle vérification du texte' });
    const bloque = await as(t.martin).post(T('/cloture'));
    expect(bloque.status).toBe(409); expect(bloque.body.error).toMatch(/encore en cours/);
    expect((await clore(d.id, { issue: 'ajourne' })).status).toBe(200);
    expect((await as(t.dupont).get(A(acteId))).body.statut).toBe('ajourne');
    const c = await as(t.martin).post(T('/cloture'));
    expect(c.status).toBe(200); expect(c.body.tenue.statut).toBe('close');
    expect((await as(t.martin).get(`${base()}/seances/${seance.id}`)).body.statut).toBe('close');
    expect((await presence(ids(1), 'absent')).status).toBe(409); // verrouillé
    expect((await as(t.martin).post(T('/deverrouillage'), { motif: 'Correction' })).status).toBe(403); // réservé à l’administrateur
    const u = await as(admin).post(T('/deverrouillage'), { motif: 'Correction d’une présence' });
    expect(u.status).toBe(200); expect(u.body.tenue.statut).toBe('ouverte');
  });
});
