const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let ccas; let tCcas;
const as = (t) => ({
  get: (u) => env.http().get(u).set(bearer(t)),
  post: (u, b) => env.http().post(u).set(bearer(t)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(t)).send(b),
});

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS', type: 'ccas' });
  const items = (await as(admin).get('/api/v1/organismes')).body.items;
  ville = items.find((o) => o.code === 'ville'); ccas = items.find((o) => o.code === 'ccas');
  await as(admin).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'martin', role: 'org_admin' });
  await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [{ code: 'J', label: 'DIRECTION CCAS' }] });
  tCcas = await loginAs(env, 'martin', 'pw-martin');
});
afterAll(async () => { await env.close(); });

const list = (t, org, kind, q = '') => as(t).get(`/api/v1/organismes/${org.id}/referentiels/${kind}${q}`);

describe('jeux communs (seeds)', () => {
  it('fournit 6 natures, 40 rubriques, 4 types d\'acte et les types d\'annexe', async () => {
    const n = (await list(admin, ville, 'nature')).body.items;
    expect(n.map((x) => x.libelle)).toEqual(['Délibérations', 'Actes réglementaires', 'Actes individuels', 'Contrats, conventions et avenants', 'Documents budgétaires et financiers', 'Autres']);
    const r = (await list(admin, ville, 'rubrique')).body.items;
    expect(r).toHaveLength(40);
    expect(r[0].libelle).toBe('ACTION SOCIALE');
    expect(r.find((x) => x.libelle === 'VŒU')).toBeTruthy();
    expect((await list(admin, ville, 'type_acte')).body.items.map((x) => x.libelle)).toEqual(['Délibération', 'Vœu', 'Décision', 'Arrêté']);
    expect((await list(admin, ville, 'annexe_type')).body.items.length).toBeGreaterThan(3);
  });

  it('importe la nomenclature des matières, triée numériquement, avec feuilles', async () => {
    const m = (await list(admin, ville, 'matiere')).body.items;
    expect(m.length).toBeGreaterThan(180);
    const codes = m.map((x) => x.code);
    expect(codes.indexOf('1.2.1.2')).toBeLessThan(codes.indexOf('1.2.1.10'));
    expect(m.find((x) => x.code === '7.5')).toMatchObject({ libelle: 'Subventions', feuille: true });
    expect(m.find((x) => x.code === '7').feuille).toBe(false);
    expect(m.find((x) => x.code === '6').libelle).toContain('pouvoirs de police');
  });

  it('expose l\'arbre des matières avec des feuilles seules sélectionnables', async () => {
    const tree = (await as(admin).get(`/api/v1/organismes/${ville.id}/referentiels/matiere/tree`)).body.items;
    expect(tree).toHaveLength(9);
    expect(tree[0]).toMatchObject({ code: '1', selectionnable: false });
    const sub = tree[6].enfants.find((e) => e.code === '7.5');
    expect(sub.selectionnable).toBe(true);
  });

  it('les seeds sont idempotents', async () => {
    const before = (await env.db.get('SELECT count(*)::int AS n FROM ref_items')).n;
    await env.c.refs.ensureSeeds(env.c.log);
    expect((await env.db.get('SELECT count(*)::int AS n FROM ref_items')).n).toBe(before);
  });
});

describe('héritage et surcharges par organisme (MOR-10)', () => {
  it('le CCAS masque une rubrique commune sans toucher la Ville', async () => {
    const rub = (await list(tCcas, ccas, 'rubrique')).body.items.find((x) => x.libelle === 'URBANISME');
    const r = await as(tCcas).put(`/api/v1/organismes/${ccas.id}/referentiels/rubrique/${rub.id}/override`, { actif: false });
    expect(r.status).toBe(200);
    expect((await list(tCcas, ccas, 'rubrique')).body.items.find((x) => x.id === rub.id)).toBeUndefined();
    expect((await list(tCcas, ccas, 'rubrique', '?includeInactive=true')).body.items.find((x) => x.id === rub.id).actif).toBe(false);
    expect((await list(admin, ville, 'rubrique')).body.items.find((x) => x.id === rub.id)).toBeTruthy();
  });

  it('renomme une valeur commune pour un seul organisme', async () => {
    const nat = (await list(tCcas, ccas, 'nature')).body.items.find((x) => x.code === 'delib');
    await as(tCcas).put(`/api/v1/organismes/${ccas.id}/referentiels/nature/${nat.id}/override`, { libelle: 'Décisions du conseil d\'administration' });
    expect((await list(tCcas, ccas, 'nature')).body.items.find((x) => x.code === 'delib').libelle).toBe("Décisions du conseil d'administration");
    expect((await list(admin, ville, 'nature')).body.items.find((x) => x.code === 'delib').libelle).toBe('Délibérations');
  });

  it('un organisme ajoute ses propres valeurs, invisibles des autres', async () => {
    const c = await as(tCcas).post(`/api/v1/organismes/${ccas.id}/referentiels/rubrique`, { code: 'aide_sociale_legale', libelle: 'AIDE SOCIALE LÉGALE' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ origine: 'organisme', organismeId: ccas.id });
    expect((await list(tCcas, ccas, 'rubrique')).body.items).toHaveLength(40);
    expect((await list(admin, ville, 'rubrique')).body.items).toHaveLength(40);
    expect((await list(admin, ville, 'rubrique')).body.items.some((x) => x.code === 'aide_sociale_legale')).toBe(false);
    expect((await as(tCcas).post(`/api/v1/organismes/${ccas.id}/referentiels/rubrique`, { code: 'aide_sociale_legale', libelle: 'x' })).status).toBe(409);
  });

  it('les valeurs communes ne se modifient pas directement ; les droits sont respectés', async () => {
    const nat = (await list(tCcas, ccas, 'nature')).body.items.find((x) => x.code === 'autres');
    expect((await as(tCcas).put(`/api/v1/organismes/${ccas.id}/referentiels/nature/${nat.id}`, { libelle: 'Piraté' })).status).toBe(404);
    expect((await as(tCcas).post('/api/v1/platform/referentiels/nature', { code: 'x', libelle: 'x' })).status).toBe(403);
    const plat = await as(admin).post('/api/v1/platform/referentiels/annexe_type', { code: 'rapport', libelle: 'Rapport' });
    expect(plat.status).toBe(201);
    expect((await list(tCcas, ccas, 'annexe_type')).body.items.some((x) => x.code === 'rapport')).toBe(true);
    const dupont = await loginAs(env, 'dupont', 'pw-dupont');
    expect((await as(dupont).post(`/api/v1/organismes/${ville.id}/referentiels/rubrique`, { code: 'zz', libelle: 'zz' })).status).toBe(403);
    expect((await as(dupont).get(`/api/v1/organismes/${ccas.id}/referentiels/rubrique`)).status).toBe(403);
  });

  it('un import de matières est idempotent et signale les corrections', async () => {
    const text = '1.Commande Publique\n1.1 Marchés publics\n1.1.1 pourvoirs test\n';
    const a = await as(tCcas).post(`/api/v1/organismes/${ccas.id}/referentiels/matiere/import`, { text });
    expect(a.body).toMatchObject({ total: 3, created: 3, updated: 0 });
    expect(a.body.corrections).toHaveLength(1);
    const b = await as(tCcas).post(`/api/v1/organismes/${ccas.id}/referentiels/matiere/import`, { text });
    expect(b.body).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect((await as(tCcas).post(`/api/v1/organismes/${ccas.id}/referentiels/matiere/import`, { text: 'rien à lire ici' })).status).toBe(400);
  });
});
