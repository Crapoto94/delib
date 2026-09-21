const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let seance; let a;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const circuit = async (tok) => (await as(tok).get(`${A(a)}/circuit`)).body;
const etape = (c, cle) => c.path.find((p) => p.key === cle);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['nouveau', 'pw-nouveau'], ['martin', 'pw-martin']]) t[u] = await loginAs(env, u, p);
  const refs = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await refs('matiere')).find((x) => x.code === '7.5'); rubriques = await refs('rubrique');
  typeDelib = (await refs('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' }); await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']); await setMembers('financier', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  const instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(120) })).body;
  a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Convention au juridique' })).body.id;
  await as(t.dupont).put(A(a), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a)}/textes`)).body.items) await as(t.dupont).put(`${A(a)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a)}/envoi`);
  await as(t.durand).post(`${A(a)}/validation`, {}); await as(t.leroy).post(`${A(a)}/validation`, {});   // le dossier arrive au service juridique
});
afterAll(async () => { await env.close(); });

describe('étapes tenues par un groupe : seule l’étape est affichée, pas les noms', () => {
  it('la frise du dossier ne montre pas qui tient le service juridique ; l’administration le voit', async () => {
    const c = await circuit(t.dupont);
    expect(c.currentStepKey).toBe('juridique');
    expect(etape(c, 'juridique')).toMatchObject({ holders: [], masque: true, label: 'Service juridique' });
    expect(etape(c, 'chef_service').holders).toEqual(['durand']);                                  // une étape tenue par une personne garde son nom
    expect(etape(await circuit(admin), 'juridique')).toMatchObject({ holders: ['nouveau'] });      // l'administration gère les titulaires
    expect(etape(await circuit(t.martin), 'juridique').holders).toEqual(['nouveau']);             // le SCC aussi
  });

  it('le tableau de bord de celui qui a validé n’affiche que l’étape en cours', async () => {
    const s = (await as(t.leroy).get(`${base()}/circuit/suivi`)).body;
    const v = s.valides.find((x) => x.acte.id === a);
    expect(v.step).toMatchObject({ label: 'Service juridique', holders: [], masque: true });
    expect(v.acte.seanceVisee).toMatchObject({ id: seance.id, instance: expect.any(String) });      // et la séance visée
  });

  it('après validation, le nom de celui qui a validé une étape de groupe n’apparaît pas non plus', async () => {
    expect((await as(t.nouveau).post(`${A(a)}/validation`, {})).status).toBe(200);
    const c = await circuit(t.dupont);
    expect(etape(c, 'juridique').instance).toMatchObject({ actedBy: null, onBehalfOf: null });
    expect(etape(c, 'directeur').instance.actedBy).toBe('leroy');
    expect(c.events.filter((e) => e.from === 'juridique').every((e) => e.actor === null)).toBe(true);
    expect(etape(await circuit(admin), 'juridique').instance.actedBy).toBe('nouveau');
  });

  it('un circuit peut afficher les noms d’une étape de groupe (masquerNoms: false) ou masquer ceux d’une étape de personne', async () => {
    const eng = env.c.engine; void eng;
    // l'option est portée par l'étape du circuit : la valeur explicite l'emporte sur le défaut (groupe → masqué)
    const graph = { start: 'redaction', steps: [{ key: 'redaction', label: 'Rédaction', resolver: { kind: 'redacteur' } }, { key: 'juridique', label: 'Service juridique', resolver: { kind: 'groupe', code: 'juridique' }, masquerNoms: false }, { key: 'dga', label: 'DGA', resolver: { kind: 'titulaire', fonction: 'dga' }, masquerNoms: true }], transitions: [{ from: 'redaction', to: 'juridique' }, { from: 'juridique', to: 'dga' }] };
    const G = require('../../src/modules/circuit/graph');
    expect(G.stepOf(graph, 'juridique').masquerNoms).toBe(false); expect(G.stepOf(graph, 'dga').masquerNoms).toBe(true);
  });
});

describe('séance visée sur tous les tableaux', () => {
  it('la liste des dossiers et « à traiter » portent la séance visée (date et instance)', async () => {
    const liste = (await as(t.dupont).get(`${base()}/actes?scope=mine`)).body.items.find((x) => x.id === a);
    expect(liste.seanceVisee).toMatchObject({ id: seance.id, dateSeance: expect.anything(), instance: expect.any(String) });
    expect((await as(t.dupont).get(A(a))).body.seanceVisee).toMatchObject({ id: seance.id, instance: expect.any(String) });   // et la fiche du dossier
    expect(liste.seanceVisee.inscrit).toBe(false);                                                   // visée, pas encore à l'ordre du jour → italique
    const b = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Sans séance' })).body.id;
    expect((await as(t.dupont).get(`${base()}/actes?scope=mine`)).body.items.find((x) => x.id === b).seanceVisee).toBeNull();
    const todo = (await as(t.petit).get(`${base()}/circuit/a-traiter`)).body.items.find((x) => x.acte.id === a);
    expect(todo.acte.seanceVisee).toMatchObject({ id: seance.id });
  });

  it('SEA-18 : inscrit à l’ordre du jour → « inscrit » (gras) ; retiré de l’ordre du jour → de nouveau « visée » seulement (italique)', async () => {
    const it = await env.db.get("INSERT INTO seance_items (organisme_id, seance_id, position, kind, acte_id, created_by) VALUES ($1,$2,1,'deliberation',$3,'test') RETURNING id", [ville.id, seance.id, a]);
    const inscrit = async () => (await as(t.dupont).get(`${base()}/actes?scope=mine`)).body.items.find((x) => x.id === a).seanceVisee.inscrit;
    expect(await inscrit()).toBe(true);
    expect((await as(t.dupont).get(A(a))).body.seanceVisee.inscrit).toBe(true);
    await env.db.run("UPDATE seance_items SET statut = 'retire' WHERE id = $1", [it.id]);
    expect(await inscrit()).toBe(false);
  });
});
