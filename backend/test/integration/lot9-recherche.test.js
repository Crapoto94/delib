const { PDFDocument, StandardFonts } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { analyser } = require('../../src/modules/recherche/recherche.service');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let acteIds; let items; let elu; let eluTok; let annexeFile;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (p = '') => `${base()}/seances/${seance.id}${p}`;
const R = (p = '') => `${base()}/recherche${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const PW = 'Mot-de-passe-solide-2026';
const mails = (re) => env.mail.state.sent.filter((m) => re.test(m.subject));
const chercher = async (tok, q, extra = '') => { const r = await as(tok).get(R(`?q=${encodeURIComponent(q)}${extra}`)); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body; };
const ids = (r) => r.items.map((i) => i.acteId);

async function pdfAvecTexte(texte) {
  const d = await PDFDocument.create(); const font = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([595, 842]).drawText(texte, { x: 50, y: 700, size: 12, font });
  return Buffer.from(await d.save());
}
async function delib(titre, { termine = true, objet } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre, commentaire: objet })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) {
    await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: x.kind === 'dispositif' ? `Article 1 : le conseil approuve ${titre.toLowerCase()}.` : `Texte ${x.kind}.`, baseVersion: x.version });
  }
  if (termine) {
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
    await as(t.martin).post(S('/odj/affectations'), { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  }
  return a.id;
}
async function voter(itemId, choix) {
  await as(t.martin).put(S('/tenue/courant'), { itemId });
  const st = (await as(t.martin).get(S('/tenue'))).body;
  await as(t.martin).put(S(`/tenue/points/${itemId}/votes`), { votes: st.groupes.flatMap((g) => g.elus).map((e) => ({ eluId: e.id, choix })) });
  expect((await as(t.martin).post(S(`/tenue/points/${itemId}/cloture`), { issue: 'vote' })).status).toBe(200);
}
async function connecterElu(email) {
  const r1 = await env.http().post('/api/v1/elus-auth/connexion').send({ email, motDePasse: PW });
  const code = /(\d{6})<\/b>/.exec(mails(/code de connexion/).at(-1).html)[1];
  const r2 = await env.http().post('/api/v1/elus-auth/code').send({ challenge: r1.body.challenge, code });
  expect(r2.status).toBe(200);
  return r2.body.token;
}

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const refs = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await refs('matiere')).find((x) => x.code === '7.5'); rubriques = await refs('rubrique');
  typeDelib = (await refs('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  const gm = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Majorité', ordre: 1 })).body;
  for (const [nom, prenom, email] of [['Durif', 'Paul', 'paul.durif@example.fr'], ['Lambert', 'Jeanne', 'jeanne.lambert@example.fr']]) {
    const e = (await as(admin).post(`${base()}/elus`, { nom, prenom, email, role: 'Conseiller municipal', groupeId: gm.id })).body;
    if (!elu) elu = e;
  }
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(3) })).body;
  acteIds = [
    await delib('Rénovation de l’école Jean Jaurès', { objet: 'Isolation thermique et remplacement des menuiseries' }),
    await delib('Subvention à l’association sportive'),
    await delib('Aménagement du parc urbain', { termine: false }),          // brouillon de dupont : invisible pour les autres
  ];
  const ctx = await env.c.access.loadContext('dupont'); const buf = await pdfAvecTexte('La chaudiere biomasse remplace la chaufferie au fioul');
  const an = await env.c.annexes.add(ctx, ville.id, acteIds[0], { titre: 'Étude thermique', communicable: true }, { buffer: buf, originalname: 'etude.pdf', size: buf.length, mimetype: 'application/pdf' });
  annexeFile = an.fichier.id;
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  await as(t.martin).post(S('/tenue/ouverture'));
  const st = (await as(t.martin).get(S('/tenue'))).body;
  await as(t.martin).put(S('/tenue/presences'), { eluIds: st.groupes.flatMap((g) => g.elus).map((e) => e.id), etat: 'en_salle' });
  items = {}; for (const p of st.points.filter((x) => x.kind === 'deliberation')) items[p.acte.id] = p.id;
  await voter(items[acteIds[0]], 'pour'); await voter(items[acteIds[1]], 'contre');
  await as(t.martin).post(S('/tenue/cloture'));
  await env.c.recherche.idle();
  await env.c.recherche.balayer(ville.id); // rattrape ce que les évènements n'ont pas couvert (résultat du vote…)
  // espace des élus : mise à disposition dès l'arrêt de l'ordre du jour, un compte actif
  await env.c.settings.put(await env.c.access.loadContext('boot'), { scope: 'organisme', organismeId: ville.id, key: 'elus.mad_declencheur', val: 'arret' });
  const inv = await as(t.martin).post(`${base()}/espace-elus/comptes/${elu.id}/invitation`);
  expect(inv.status).toBe(201);
  const tok = /#\/invitation\/([\w-]+)/.exec(mails(/accès à l’espace des élus/).at(-1).html)[1];
  expect((await env.http().post(`/api/v1/elus-auth/invitation/${tok}`).send({ motDePasse: PW })).status).toBe(200);
  eluTok = await connecterElu('paul.durif@example.fr');
});
afterAll(async () => { await env.close(); });

describe('analyse de la requête', () => {
  it('syntaxe naturelle : mots, expression exacte, OR, exclusion, préfixe, numéros', () => {
    expect(analyser('école urba*').tsq).toBe("('école' & 'urba':*)");
    expect(analyser('"plan local" -logement').tsq).toBe("(('plan' <-> 'local') & !'logement')");
    expect(analyser('piscine OR patinoire').tsq).toBe("('piscine') | ('patinoire')");
    expect(analyser('123').numero).toEqual({ suivi: 123, ref: null });
    expect(analyser('2026-4-012').numero).toEqual({ suivi: null, ref: '2026-4-012' });
    expect(analyser('urba plan', { poids: 'AB' }).tsq).toBe("('urba':AB & 'plan':AB)");
    expect(analyser("d'o'; DROP TABLE actes; --").tsq).not.toMatch(/DROP TABLE actes;/); // tout mot est cité, jamais concaténé tel quel
    expect(analyser('école', { synonymes: [['école', 'établissement scolaire']] }).tsq).toBe("(('ecole' | 'etablissement' <-> 'scolaire'))");
  });
});

describe('recherche plein texte', () => {
  it('insensible aux accents, à la casse et aux formes du français ; extraits surlignés et échappés', async () => {
    for (const q of ['ecole', 'ÉCOLE', 'écoles', 'jean jaures']) expect(ids(await chercher(t.dupont, q))).toContain(acteIds[0]);
    const r = await chercher(t.dupont, 'thermique');
    expect(r.items[0].acteId).toBe(acteIds[0]);
    expect(r.items[0].extrait).toMatch(/<mark>/);
    expect(r.items[0].extrait).not.toMatch(/<(?!\/?mark>)/);
    expect(r.total).toBe(1);
  });

  it('trouve le texte des annexes PDF (extrait à l’ajout, lu une seule fois) et le signale dans l’état de l’index', async () => {
    const r = await chercher(t.dupont, 'biomasse');
    expect(ids(r)).toEqual([acteIds[0]]);
    expect(r.items[0].extrait).toMatch(/<mark>biomasse<\/mark>/i);
    expect((await env.db.get('SELECT sans_texte FROM search_annexes WHERE file_id = $1', [annexeFile])).sans_texte).toBe(false);
    expect(await env.c.recherche.texteDuFichier(annexeFile)).toBe(false); // déjà lu : pas de seconde extraction
  });

  it('expression exacte, OR, exclusion, préfixe', async () => {
    expect(ids(await chercher(t.dupont, '"association sportive"'))).toEqual([acteIds[1]]);
    expect(ids(await chercher(t.dupont, '"sportive association"'))).toEqual([]);
    expect(ids(await chercher(t.dupont, 'ecole OR association')).sort()).toEqual([acteIds[0], acteIds[1]].sort());
    expect(ids(await chercher(t.dupont, 'ecole -thermique'))).toEqual([]);
    expect(ids(await chercher(t.dupont, 'spor*'))).toEqual([acteIds[1]]);
  });

  it('pondération : un mot du titre passe avant le même mot trouvé seulement dans une annexe', async () => {
    const r = await chercher(t.dupont, 'thermique OR sportive');
    expect(r.items[0].acteId).toBeDefined();
    const titre = await chercher(t.dupont, 'renovation');
    expect(titre.items[0].acteId).toBe(acteIds[0]);
  });

  it('n° de suivi et n° de délibération reconnus directement', async () => {
    const a = (await as(t.dupont).get(A(acteIds[0]))).body;
    expect(ids(await chercher(t.dupont, String(a.numeroSuivi)))).toEqual([acteIds[0]]);
    const num = (await env.db.get('SELECT numero FROM seance_items WHERE acte_id = $1 AND numero IS NOT NULL', [acteIds[0]])).numero;
    expect(num).toBeTruthy();
    expect(ids(await chercher(t.dupont, num))).toEqual([acteIds[0]]);
  });

  it('tolère une faute légère quand rien n’est trouvé (approchee) ; requête vide refusée', async () => {
    const r = await chercher(t.dupont, 'ecolle');
    expect(r.approchee).toBe(true); expect(ids(r)).toContain(acteIds[0]);
    expect((await chercher(t.dupont, 'ecole')).approchee).toBe(false);
    expect((await as(t.dupont).get(R(''))).status).toBe(400);
    expect((await chercher(t.dupont, 'zzzzzzzzzz')).total).toBe(0);
  });
});

describe('droits (REC-06 / VIS-*)', () => {
  it('un brouillon n’apparaît ni dans les résultats, ni dans les compteurs, ni dans les extraits d’un agent qui n’y a pas droit', async () => {
    const q = 'parc urbain';
    expect(ids(await chercher(t.dupont, q))).toEqual([acteIds[2]]);
    for (const who of ['moreau', 'nouveau']) {
      const r = await chercher(t[who], q);
      expect(r.total).toBe(0); expect(r.items).toEqual([]);
      expect(Object.values(r.facettes).every((f) => f.length === 0)).toBe(true);
    }
    expect(ids(await chercher(t.martin, q))).toEqual([acteIds[2]]); // SCC : voit tout
    expect(ids(await chercher(admin, q))).toEqual([acteIds[2]]);
  });

  it('les critères et facettes ne dévoilent rien non plus (compteurs par statut)', async () => {
    const chez = await chercher(t.dupont, 'parc OR ecole OR association');
    const chezMoreau = await chercher(t.moreau, 'parc OR ecole OR association');
    expect(chez.facettes.statut.find((s) => s.valeur === 'brouillon')?.n).toBe(1);
    expect(chezMoreau.facettes.statut.find((s) => s.valeur === 'brouillon')).toBeUndefined();
  });
});

describe('facettes, critères, export', () => {
  it('facettes avec compteurs, filtres cumulables, tri par date, pagination', async () => {
    const r = await chercher(t.martin, 'ecole OR association OR parc');
    expect(r.total).toBe(3);
    expect(r.facettes.resultat.map((x) => x.valeur).sort()).toEqual(['adopte_unanimite', 'rejete']);
    expect(r.facettes.matiereId[0]).toMatchObject({ n: 3 });
    expect(r.facettes.rapporteurId.length).toBe(1);
    const adopte = await chercher(t.martin, 'ecole OR association OR parc', '&resultat=adopte_unanimite');
    expect(ids(adopte)).toEqual([acteIds[0]]);
    expect(adopte.items[0].resultat.libelle).toMatch(/unanimité/);
    const seanceOnly = await chercher(t.martin, '', `&seanceId=${seance.id}`);
    expect(seanceOnly.total).toBe(2);
    const page = await chercher(t.martin, 'ecole OR association OR parc', '&limit=1&offset=1&tri=date');
    expect(page.items.length).toBe(1); expect(page.total).toBe(3);
    expect((await chercher(t.martin, '', `&matiereId=${matiere.id}&annexes=true`)).total).toBe(1);
    expect((await chercher(t.martin, '', '&statut=brouillon')).total).toBe(1);
    expect((await chercher(t.martin, 'ecole', '&du=2999-01-01')).total).toBe(0);
  });

  it('export CSV : mêmes critères, séparateur point-virgule, en-têtes, aucun champ hors droits', async () => {
    const r = await as(t.dupont).get(R('/export.csv?q=association'));
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text).toMatch(/"N° suivi";"N° délibération";"Titre"/); expect(r.text).toMatch(/association sportive/);
    expect((await as(t.moreau).get(R('/export.csv?q=association'))).text).not.toMatch(/association sportive/); // acte que moreau ne voit pas
    expect((await as(t.dupont).get(R('/export.csv?q=parc'))).text).toMatch(/parc urbain/);
  });
});

describe('actes similaires (REC-08)', () => {
  it('à la création (titre saisi) et sur une fiche, dans les limites des droits', async () => {
    const c = await as(t.dupont).get(R(`/similaires?titre=${encodeURIComponent('Rénovation énergétique de l’école Jean Jaurès')}`));
    expect(c.status).toBe(200); expect(c.body.items.map((x) => x.acteId)).toContain(acteIds[0]);
    const f = await as(t.dupont).get(R(`/similaires?acteId=${acteIds[1]}`));
    expect(f.body.items.map((x) => x.acteId)).not.toContain(acteIds[1]); // pas lui-même
    const cache = await as(t.moreau).get(R(`/similaires?titre=${encodeURIComponent('Rénovation de l’école Jean Jaurès')}`));
    expect(cache.body.items).toEqual([]); // moreau ne voit aucun de ces actes : aucune proposition
  });
});

describe('tenue à jour de l’index', () => {
  it('un texte validé est retrouvé sans ré-indexation manuelle ; un retard est rattrapé par le balayage', async () => {
    const txt = (await as(t.dupont).get(`${A(acteIds[2])}/textes`)).body.items.find((x) => x.kind === 'expose');
    const v = (await as(t.dupont).put(`${A(acteIds[2])}/textes/${txt.id}`, { markdown: 'Le square sera planté de pistachiers.', baseVersion: txt.version })).status;
    expect(v).toBe(200);
    await env.c.recherche.idle();
    expect(ids(await chercher(t.dupont, 'pistachier'))).toEqual([acteIds[2]]);
    await env.db.run("UPDATE actes SET titre = 'Aménagement du parc urbain Anatole France', updated_at = now() + interval '1 second' WHERE id = $1", [acteIds[2]]);
    expect(ids(await chercher(t.dupont, 'anatole'))).toEqual([]);
    expect((await env.c.recherche.balayer(ville.id)).n).toBeGreaterThanOrEqual(1);
    expect(ids(await chercher(t.dupont, 'anatole'))).toEqual([acteIds[2]]);
  });

  it('synonymes paramétrables par l’organisme', async () => {
    expect(ids(await chercher(t.dupont, 'ecole'))).toEqual([acteIds[0]]);
    await env.c.settings.put(await env.c.access.loadContext('boot'), { scope: 'organisme', organismeId: ville.id, key: 'recherche.synonymes', val: 'école, association' });
    expect(ids(await chercher(t.dupont, 'ecole')).sort()).toEqual([acteIds[0], acteIds[1]].sort());
    await env.c.settings.remove(await env.c.access.loadContext('boot'), { scope: 'organisme', organismeId: ville.id, key: 'recherche.synonymes' });
  });
});

describe('recherches enregistrées', () => {
  it('propres à chaque utilisateur, limitées, supprimables', async () => {
    const c = await as(t.dupont).post(R('/enregistrees'), { nom: 'Mes écoles', requete: { q: 'ecole', statut: 'adopte' } });
    expect(c.status).toBe(201);
    expect((await as(t.dupont).get(R('/enregistrees'))).body.items).toHaveLength(1);
    expect((await as(t.moreau).get(R('/enregistrees'))).body.items).toHaveLength(0);
    expect((await as(t.moreau).del(R(`/enregistrees/${c.body.id}`))).status).toBe(404);
    expect((await as(t.dupont).del(R(`/enregistrees/${c.body.id}`))).status).toBe(200);
    expect((await as(t.dupont).post(R('/enregistrees'), { nom: 'x', requete: {} })).status).toBe(400);
  });
});

describe('administration', () => {
  it('état de l’index, journal anonymisé, ré-indexation réservée à l’administrateur', async () => {
    expect((await as(t.dupont).get(R('/etat'))).status).toBe(403);
    expect((await as(t.dupont).post(R('/reindexation'))).status).toBe(403);
    const e = (await as(admin).get(R('/etat'))).body;
    expect(e).toMatchObject({ actes: 3, indexes: 3, annexesLues: 1, annexesSansTexte: 0 });
    expect(e.frequentes.length).toBeGreaterThan(0);
    expect(e.sansResultat.map((x) => x.requete)).toContain('zzzzzzzzzz');
    const cols = (await env.db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'search_log' AND table_schema = current_schema()")).map((c) => c.column_name);
    expect(cols).not.toContain('username'); // anonymisé : aucun nom, aucun identifiant
    const r = await as(admin).post(R('/reindexation'));
    expect(r.status).toBe(202); expect(r.body).toMatchObject({ demarre: true, total: 3 });
    await env.c.recherche.idle();
    const apres = (await as(admin).get(R('/etat'))).body;
    expect(apres.reindexation).toMatchObject({ enCours: false, total: 3, traites: 3 });
    expect(ids(await chercher(t.dupont, 'biomasse'))).toEqual([acteIds[0]]);
  });

  it('un PDF sans texte est signalé « sans texte » et n’empêche pas l’indexation', async () => {
    const ctx = await env.c.access.loadContext('dupont');
    const d = await PDFDocument.create(); d.addPage([595, 842]); const buf = Buffer.from(await d.save());
    const an = await env.c.annexes.add(ctx, ville.id, acteIds[2], { titre: 'Scan', communicable: true }, { buffer: buf, originalname: 'scan.pdf', size: buf.length, mimetype: 'application/pdf' });
    await env.c.recherche.idle();
    expect((await env.db.get('SELECT sans_texte FROM search_annexes WHERE file_id = $1', [an.fichier.id])).sans_texte).toBe(true);
    expect((await as(admin).get(R('/etat'))).body.annexesSansTexte).toBe(1);
    expect(ids(await chercher(t.dupont, 'anatole'))).toEqual([acteIds[2]]);
  });
});

describe('espace des élus (REC-06)', () => {
  const rech = (tok, q) => env.http().get(`/api/v1/elus/recherche?q=${encodeURIComponent(q)}`).set(bearer(tok));

  it('uniquement les délibérations adoptées de mes séances : ni brouillon, ni rejetée, ni texte d’annexe', async () => {
    const ok = await rech(eluTok, 'ecole');
    expect(ok.status).toBe(200);
    expect(ok.body.items.map((i) => i.acteId)).toEqual([acteIds[0]]);
    expect(ok.body.items[0]).toMatchObject({ seanceId: seance.id, resultat: { code: 'adopte_unanimite' } });
    expect((await rech(eluTok, 'association')).body.items).toEqual([]);   // rejetée
    expect((await rech(eluTok, 'parc urbain')).body.items).toEqual([]);   // brouillon
    expect((await rech(eluTok, 'biomasse')).body.items).toEqual([]);      // texte d'annexe : hors périmètre élus
    expect((await rech(eluTok, 'thermique')).body.items.map((i) => i.acteId)).toEqual([acteIds[0]]); // objet : publiable
    expect(JSON.stringify(ok.body)).not.toMatch(/biomasse|Texte expose/);
  });

  it('exige une session d’élu ; requête trop courte refusée ; jamais accessible avec un jeton d’agent', async () => {
    expect((await env.http().get('/api/v1/elus/recherche?q=ecole')).status).toBe(401);
    expect((await rech(eluTok, 'a')).status).toBe(400);
    expect((await rech(t.dupont, 'ecole')).status).toBe(401);
  });
});

describe('alertes de recherche (REC-29)', () => {
  const alerte = (id, actif) => as(t.dupont).put(R(`/enregistrees/${id}/alerte`), { actif });
  let id;
  it('l’activation mémorise l’existant ; seuls les nouveaux actes visibles par la personne déclenchent une notification', async () => {
    id = (await as(t.dupont).post(R('/enregistrees'), { nom: 'Mes subventions', requete: { q: 'subvention' } })).body.id;
    expect((await as(t.moreau).put(R(`/enregistrees/${id}/alerte`), { actif: true })).status).toBe(404);   // pas la sienne
    const vide = (await as(t.dupont).post(R('/enregistrees'), { nom: 'Sans critère', requete: {} })).body.id;
    expect((await alerte(vide, true)).status).toBe(400);
    const r = await alerte(id, true);
    expect(r.body).toMatchObject({ alerte: true, memorises: expect.any(Number) });
    expect((await as(t.dupont).get(R('/alertes'))).body.items.find((x) => x.id === id)).toMatchObject({ alerte: true });
    expect(await env.c.alertes.verifier(ville.id, { forcer: true })).toBe(0);            // rien de nouveau
    // un nouvel acte correspondant, créé par dupont (visible pour lui), puis indexé
    const type = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
    const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: type.id, titre: 'Nouvelle subvention aux clubs de quartier' })).body;
    await env.c.recherche.traiterActe(a.id);
    expect(await env.c.alertes.verifier(ville.id, { forcer: true })).toBe(1);
    const n = (await as(t.dupont).get(`${base()}/notifications?limit=5`)).body.items.find((x) => x.title.includes('Mes subventions'));
    expect(n).toBeTruthy(); expect(n.title).toMatch(/^1 nouvel acte correspond/); expect(n.body).toMatch(/clubs de quartier/);
    expect(await env.c.alertes.verifier(ville.id, { forcer: true })).toBe(0);            // déjà signalé : pas de doublon
    // droits : l'acte d'un autre agent, invisible pour la personne, ne déclenche rien
    await as(t.moreau).post(`${base()}/actes`, { typeId: type.id, titre: 'Subvention confidentielle de moreau' }).then(async (x) => x.body.id && env.c.recherche.traiterActe(x.body.id));
    expect(await env.c.alertes.verifier(ville.id, { forcer: true })).toBe(0);
  });

  it('au plus une vérification par heure ; l’alerte se coupe ; supprimée avec la recherche', async () => {
    expect(await env.c.alertes.verifier(ville.id)).toBe(0);                               // vérifiée il y a moins d'une heure
    expect((await alerte(id, false)).body.alerte).toBe(false);
    expect(await env.db.get('SELECT vus FROM search_saved WHERE id = $1', [id])).toEqual({ vus: [] });
    await alerte(id, true);
    expect((await as(t.dupont).del(R(`/enregistrees/${id}`))).status).toBe(200);
    expect(await env.c.alertes.verifier(ville.id, { forcer: true })).toBe(0);
  });
});
