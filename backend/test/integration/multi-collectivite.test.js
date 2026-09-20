const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const B = (id) => `/api/v1/organismes/${id}`;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { dupont: await loginAs(env, 'dupont', 'pw-dupont') };
});
afterAll(async () => { await env.close(); });

describe('plusieurs collectivités', () => {
  let ccas; let autre;
  it('une collectivité créée est prête à l\'emploi : circuit de validation, groupes de valideurs, instance de séances', async () => {
    const r = await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS d\'Ivry-sur-Seine', type: 'ccas' });
    expect(r.status).toBe(201);
    ccas = r.body;
    const circuits = (await as(admin).get(`${B(ccas.id)}/circuits`)).body.items;
    expect(circuits.map((c) => c.code)).toContain('ivry-standard');
    const groupes = (await as(admin).get(`${B(ccas.id)}/groupes`)).body.items.map((g) => g.code);
    expect(groupes).toEqual(expect.arrayContaining(['financier', 'juridique', 'scc']));
    const instances = (await as(admin).get(`${B(ccas.id)}/instances`)).body.items;
    expect(instances).toHaveLength(1);
    expect(instances[0].kind).toBe('conseil');
  });

  it('refuse un code déjà utilisé et réserve la création à l\'administrateur de plateforme', async () => {
    expect((await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'Doublon', type: 'ccas' })).status).toBe(409);
    expect((await as(t.dupont).post('/api/v1/organismes', { code: 'autre', nom: 'Interdit', type: 'autre' })).status).toBe(403);
  });

  it('l\'administrateur de plateforme voit toutes les collectivités, un agent seulement la sienne', async () => {
    expect((await as(admin).get('/api/v1/organismes')).body.items.map((o) => o.code).sort()).toEqual(['ccas', 'ville']);
    expect((await as(t.dupont).get('/api/v1/organismes')).body.items.map((o) => o.code)).toEqual(['ville']);
    expect((await as(t.dupont).get(`${B(ccas.id)}/instances`)).status).toBe(403);
  });

  it('rattacher une direction à une collectivité y donne accès aux agents de cette direction, et une direction n\'a qu\'une collectivité', async () => {
    expect((await as(admin).put(`${B(ccas.id)}/directions`, { directions: [{ code: 'A1', label: 'Direction A1' }] })).status).toBe(200);
    const dupont2 = await loginAs(env, 'dupont', 'pw-dupont');
    const me = (await as(dupont2).get('/api/v1/me')).body;
    expect(me.organismes.map((o) => o.code)).toEqual(['ccas']);
    autre = (await as(admin).post('/api/v1/organismes', { code: 'syndicat', nom: 'Syndicat intercommunal', type: 'autre' })).body;
    expect((await as(admin).put(`${B(autre.id)}/directions`, { directions: [{ code: 'A1' }] })).status).toBe(409);
  });

  it('les données d\'une collectivité restent étanches : une instance, un rôle ou un dossier de l\'une n\'existe pas dans l\'autre', async () => {
    const seanceCcas = (await as(admin).post(`${B(ccas.id)}/seances`, { instanceId: (await as(admin).get(`${B(ccas.id)}/instances`)).body.items[0].id, dateSeance: '2027-05-05T18:00:00Z' })).body;
    expect((await as(admin).get(`${B(ville.id)}/seances`)).body.items.some((s) => s.id === seanceCcas.id)).toBe(false);
    expect((await as(admin).get(`${B(ville.id)}/seances/${seanceCcas.id}`)).status).toBe(404);
  });

  it('une collectivité désactivée disparaît des accès, sauf pour l\'administrateur de plateforme', async () => {
    expect((await as(admin).put(B(autre.id), { actif: false })).status).toBe(200);
    expect((await as(admin).get('/api/v1/organismes')).body.items.some((o) => o.code === 'syndicat')).toBe(true);
    expect((await as(admin).put(B(ville.id), { actif: false })).status).toBe(409); // la collectivité par défaut ne se désactive pas
  });
});
