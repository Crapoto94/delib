const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let dupont; let typeDelib; let modele; let annexes;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const textes = async (id) => (await as(dupont).get(`${A(id)}/textes`)).body.items;
const lire = async (id, kind) => { const it = (await textes(id)).find((x) => x.kind === kind); return (await as(dupont).get(`${A(id)}/textes/${it.id}?mode=propre`)).body; };
const annexesDe = async (id) => (await as(dupont).get(`${A(id)}/annexes`)).body.items;
const docx = (m) => Buffer.concat([Buffer.from('PK'), Buffer.from(`fake-docx-${m}`)]);
const MD = { expose: "Exposé du modèle : l'association sollicite une subvention.", visas: 'Vu le code général des collectivités territoriales ;', dispositif: '**Article 1** : une subvention est attribuée.' };

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  typeDelib = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  modele = (await as(dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Subvention 2026 modèle' })).body;
  for (const x of await textes(modele.id)) await as(dupont).put(`${A(modele.id)}/textes/${x.id}`, { markdown: MD[x.kind], baseVersion: x.version });
  for (const n of ['un', 'deux']) {
    const r = await env.http().post(`${A(modele.id)}/annexes`).set(bearer(dupont)).field('titre', `Annexe ${n}`).attach('file', docx(n), `${n}.docx`);
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  }
  annexes = await annexesDe(modele.id);
  expect(annexes).toHaveLength(2);
});
afterAll(async () => { await env.close(); });

describe('créer un dossier à partir d\'un modèle', () => {
  it('reprend exposé, visas et dispositif en brouillon, et AUCUNE annexe si la liste est vide', async () => {
    const r = await as(dupont).post(`${base()}/actes/depuis-modele`, { modeleId: modele.id, annexes: [] });
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe('brouillon');
    for (const k of ['expose', 'visas', 'dispositif']) expect((await lire(r.body.id, k)).markdown).toBe(MD[k]);
    expect(await annexesDe(r.body.id)).toHaveLength(0);
  });

  it('ne reprend que les annexes cochées', async () => {
    const r = await as(dupont).post(`${base()}/actes/depuis-modele`, { modeleId: modele.id, annexes: [annexes[1].id] });
    expect(r.status).toBe(201);
    const got = await annexesDe(r.body.id);
    expect(got.map((x) => x.titre)).toEqual([annexes[1].titre]);
    expect((await lire(r.body.id, 'expose')).markdown).toBe(MD.expose);
  });

  it('sans choix (anciens appels), reprend toutes les annexes ; les annexes du modèle restent intactes', async () => {
    const r = await as(dupont).post(`${base()}/actes/depuis-modele`, { modeleId: modele.id });
    expect(await annexesDe(r.body.id)).toHaveLength(2);
    expect(await annexesDe(modele.id)).toHaveLength(2);
  });

  it('ignore une annexe qui n\'appartient pas au modèle', async () => {
    const autre = (await as(dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Autre dossier' })).body;
    const up = await env.http().post(`${A(autre.id)}/annexes`).set(bearer(dupont)).field('titre', 'Étrangère').attach('file', docx('x'), 'x.docx');
    const r = await as(dupont).post(`${base()}/actes/depuis-modele`, { modeleId: modele.id, annexes: [up.body.id] });
    expect(await annexesDe(r.body.id)).toHaveLength(0);
  });
});

describe('copie d\'un dossier', () => {
  it('reprend les textes mais pas les annexes par défaut, et celles cochées sur demande', async () => {
    const s = await as(dupont).post(`${A(modele.id)}/copie`, {});
    expect(s.status).toBe(201);
    expect((await lire(s.body.acte.id, 'visas')).markdown).toBe(MD.visas);
    expect(await annexesDe(s.body.acte.id)).toHaveLength(0);
    const c = await as(dupont).post(`${A(modele.id)}/copie`, { annexes: [annexes[0].id] });
    expect((await annexesDe(c.body.acte.id)).map((x) => x.titre)).toEqual([annexes[0].titre]);
  });
});
