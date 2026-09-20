const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let acte;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const general = (v) => as(admin).put(`${base()}/visibilite-actes`, { visibilite: v });
const perso = (u, v) => as(admin).put(`${base()}/utilisateurs/${u}/visibilite-actes`, { visibilite: v });
const voit = async (user) => (await as(t[user]).get(A(acte.id))).status === 200;
const liste = async (user) => (await as(t[user]).get(`${base()}/actes?limit=100`)).body.items.some((x) => x.id === acte.id);

// dupont et durand : direction des finances, service Budget (A1a) ; leroy et moreau : même direction, service Comptabilité (A1b) ; martin et petit : CCAS
beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['moreau', 'pw-moreau'], ['petit', 'pw-petit']]) t[u] = await loginAs(env, u, p);
  typeDelib = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  acte = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Dossier du service Budget' })).body;
});
afterAll(async () => { await env.close(); });

describe('visibilité des actes : réglage général de l\'organisme', () => {
  it('par défaut : le rédacteur et son service voient l\'acte, pas les autres services ni les autres directions', async () => {
    const g = (await as(admin).get(`${base()}/visibilite-actes`)).body;
    expect(g).toMatchObject({ valeur: 'service', source: 'defaut' });
    expect(await voit('dupont')).toBe(true);
    expect(await voit('durand')).toBe(true); // même service
    expect(await voit('moreau')).toBe(false); // autre service, même direction
    expect(await voit('petit')).toBe(false); // autre direction
    expect(await liste('durand')).toBe(true); expect(await liste('moreau')).toBe(false);
  });

  it('« rédacteur uniquement » : seul le rédacteur voit son acte, quel que soit son état', async () => {
    expect((await general('redacteur')).body.valeur).toBe('redacteur');
    expect(await voit('dupont')).toBe(true);
    expect(await voit('durand')).toBe(false);
    expect(await liste('durand')).toBe(false);
    await env.db.run("UPDATE actes SET statut = 'en_circuit' WHERE id = $1", [acte.id]);
    expect(await voit('durand')).toBe(false);
  });

  it('« service » ne dépend pas de l\'état de l\'acte (brouillon, en circuit…)', async () => {
    await general('service');
    expect(await voit('durand')).toBe(true); // l'acte est en circuit
    expect(await voit('moreau')).toBe(false);
  });

  it('« direction » : tous les agents de la direction voient l\'acte, pas ceux des autres directions', async () => {
    await general('direction');
    expect(await voit('moreau')).toBe(true);
    expect(await liste('moreau')).toBe(true);
    expect(await voit('petit')).toBe(false);
  });

  it('refuse une valeur inconnue et réserve le réglage à l\'administrateur', async () => {
    expect((await as(admin).put(`${base()}/visibilite-actes`, { visibilite: 'tout' })).status).toBe(400);
    expect((await as(t.dupont).put(`${base()}/visibilite-actes`, { visibilite: 'direction' })).status).toBe(403);
    expect((await as(t.dupont).get(`${base()}/visibilite-actes`)).status).toBe(403);
  });
});

describe('visibilité des actes : réglage par utilisateur', () => {
  it('le réglage personnel prime sur le réglage général, et se retire', async () => {
    await general('redacteur');
    expect(await voit('moreau')).toBe(false);
    const r = await perso('moreau', 'direction');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ effective: 'direction', override: 'direction', general: 'redacteur', source: 'utilisateur' });
    expect(await voit('moreau')).toBe(true);
    expect(await voit('durand')).toBe(false); // sans réglage personnel : suit le général
    const back = await perso('moreau', null);
    expect(back.body).toMatchObject({ effective: 'redacteur', override: null });
    expect(await voit('moreau')).toBe(false);
  });

  it('un réglage personnel plus restrictif que le général s\'applique aussi', async () => {
    await general('direction');
    expect(await voit('moreau')).toBe(true);
    await perso('moreau', 'redacteur');
    expect(await voit('moreau')).toBe(false);
    await perso('moreau', null);
  });

  it('la fiche de l\'utilisateur expose sa visibilité ; agent inconnu et valeur invalide refusés ; réservé à l\'administrateur', async () => {
    await perso('durand', 'service');
    const f = (await as(admin).get(`${base()}/utilisateurs/durand`)).body;
    expect(f.visibiliteActes).toMatchObject({ override: 'service', effective: 'service' });
    expect((await perso('personne', 'service')).status).toBe(404);
    expect((await perso('durand', 'partout')).status).toBe(400);
    expect((await as(t.dupont).put(`${base()}/utilisateurs/durand/visibilite-actes`, { visibilite: 'direction' })).status).toBe(403);
  });

  it('les droits propres à l\'acte ne sont jamais retirés : le rédacteur voit son acte même en « rédacteur uniquement » et un participant reste participant', async () => {
    await general('redacteur');
    await perso('dupont', 'redacteur');
    expect(await voit('dupont')).toBe(true);
    await env.db.run("UPDATE actes SET participants = participants || to_jsonb($2::text) WHERE id = $1", [acte.id, 'moreau']);
    expect(await voit('moreau')).toBe(true);
  });
});
