/**
 * Étanchéité entre organismes (MOR-02, critère d'acceptation n°4) : un utilisateur d'un organisme ne lit, n'écrit
 * et ne trouve AUCUNE donnée d'un autre organisme sans rôle explicite.
 */
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { requireOrg } = require('../../src/db/pool');

let env; let admin; let ville; let ccas; let tDupont; let tMartin;
const as = (t) => ({
  get: (u, h = {}) => env.http().get(u).set({ ...bearer(t), ...h }),
  put: (u, b) => env.http().put(u).set(bearer(t)).send(b),
  post: (u, b) => env.http().post(u).set(bearer(t)).send(b),
  del: (u) => env.http().delete(u).set(bearer(t)),
});

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS', type: 'ccas' });
  const items = (await as(admin).get('/api/v1/organismes')).body.items;
  ville = items.find((o) => o.code === 'ville'); ccas = items.find((o) => o.code === 'ccas');
  await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [{ code: 'J', label: 'DIRECTION CCAS' }] });
  // dupont = agent de la Ville, administrateur de la Ville ; martin = agent du CCAS, administrateur du CCAS
  await as(admin).post(`/api/v1/organismes/${ville.id}/roles`, { username: 'dupont', role: 'org_admin' });
  await as(admin).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'martin', role: 'org_admin' });
  await as(admin).put(`/api/v1/organismes/${ville.id}/settings/secret_ville`, { value: 'confidentiel-ville' });
  await as(admin).put(`/api/v1/organismes/${ccas.id}/settings/secret_ccas`, { value: 'confidentiel-ccas' });
  tDupont = await loginAs(env, 'dupont', 'pw-dupont');
  tMartin = await loginAs(env, 'martin', 'pw-martin');
});
afterAll(async () => { await env.close(); });

describe("accès direct à un autre organisme : refusé", () => {
  it.each([
    ['GET', (o) => `/api/v1/organismes/${o}`],
    ['GET', (o) => `/api/v1/organismes/${o}/directions`],
    ['GET', (o) => `/api/v1/organismes/${o}/roles`],
    ['GET', (o) => `/api/v1/organismes/${o}/settings`],
  ])('%s d\'un organisme étranger -> 403', async (method, url) => {
    expect((await as(tDupont).get(url(ccas.id))).status).toBe(403);
    expect((await as(tMartin).get(url(ville.id))).status).toBe(403);
  });

  it("écriture chez l'autre organisme -> 403", async () => {
    expect((await as(tDupont).put(`/api/v1/organismes/${ccas.id}`, { nom: 'Piraté' })).status).toBe(403);
    expect((await as(tDupont).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'dupont', role: 'org_admin' })).status).toBe(403);
    expect((await as(tDupont).put(`/api/v1/organismes/${ccas.id}/settings/secret_ccas`, { value: 'x' })).status).toBe(403);
    expect((await as(tDupont).del(`/api/v1/organismes/${ccas.id}/settings/secret_ccas`)).status).toBe(403);
    expect((await as(tMartin).put(`/api/v1/organismes/${ville.id}/directions`, { directions: [] })).status).toBe(403);
    const check = await as(admin).get(`/api/v1/organismes/${ccas.id}`);
    expect(check.body.nom).toBe('CCAS');
  });

  it("l'en-tête X-Organisme-Id ne permet pas de sortir de son périmètre", async () => {
    expect((await as(tDupont).get('/api/v1/me/context', { 'X-Organisme-Id': String(ville.id) })).status).toBe(200);
    expect((await as(tDupont).get('/api/v1/me/context', { 'X-Organisme-Id': String(ccas.id) })).status).toBe(403);
    expect((await as(tDupont).get('/api/v1/me/context')).status).toBe(400);
    expect((await as(tDupont).get('/api/v1/me/context', { 'X-Organisme-Id': 'abc' })).status).toBe(400);
    expect((await as(tDupont).get('/api/v1/me/context', { 'X-Organisme-Id': '9999' })).status).toBe(403);
  });

  it("les rôles d'administrateur d'organisme ne se transportent pas d'un organisme à l'autre", async () => {
    const r = await as(tDupont).get('/api/v1/me/context', { 'X-Organisme-Id': String(ville.id) });
    expect(r.body.roles).toEqual(['org_admin']);
    expect((await as(tMartin).get('/api/v1/me/context', { 'X-Organisme-Id': String(ccas.id) })).body.roles).toEqual(['org_admin']);
  });
});

describe('listes et recherches : aucune fuite', () => {
  it('la liste des organismes ne contient que ceux auxquels on a accès', async () => {
    expect((await as(tDupont).get('/api/v1/organismes')).body.items.map((o) => o.code)).toEqual(['ville']);
    expect((await as(tMartin).get('/api/v1/organismes')).body.items.map((o) => o.code)).toEqual(['ccas']);
  });

  it('les paramètres résolus ne mélangent jamais deux organismes', async () => {
    const v = (await as(tDupont).get(`/api/v1/organismes/${ville.id}/settings`)).body.settings;
    const c = (await as(tMartin).get(`/api/v1/organismes/${ccas.id}/settings`)).body.settings;
    expect(Object.keys(v)).toEqual(['secret_ville']);
    expect(Object.keys(c)).toEqual(['secret_ccas']);
    expect(JSON.stringify(v)).not.toContain('confidentiel-ccas');
    expect(JSON.stringify(c)).not.toContain('confidentiel-ville');
  });

  it("le journal d'audit est limité à son organisme", async () => {
    const own = await as(tDupont).get(`/api/v1/audit?organismeId=${ville.id}`);
    expect(own.status).toBe(200);
    expect(own.body.items.length).toBeGreaterThan(0);
    expect(own.body.items.every((i) => i.organismeId === ville.id)).toBe(true);
    expect((await as(tDupont).get(`/api/v1/audit?organismeId=${ccas.id}`)).status).toBe(403);
    expect((await as(tDupont).get('/api/v1/audit')).status).toBe(400);
  });

  it("un simple agent ne lit pas le journal d'audit", async () => {
    const t = await loginAs(env, 'nouveau', 'pw-nouveau');
    expect((await as(t).get(`/api/v1/audit?organismeId=${ville.id}`)).status).toBe(403);
  });

  it("l'administrateur de plateforme voit tout, y compris les deux organismes", async () => {
    expect((await as(admin).get('/api/v1/organismes')).body.items.map((o) => o.code).sort()).toEqual(['ccas', 'ville']);
    expect((await as(admin).get('/api/v1/audit')).body.total).toBeGreaterThan(0);
  });
});

describe('paramètres : le préfixe d\'organisme est imposé par le serveur', () => {
  it("un paramètre d'instance est rattaché à l'organisme de la requête, jamais à un autre", async () => {
    const r = await as(tDupont).put(`/api/v1/organismes/${ville.id}/settings/delai`, { value: 3, scope: 'instance', subId: 7 });
    expect(r.status).toBe(200);
    const row = await env.db.get("SELECT scope_id FROM settings WHERE key = 'delai'");
    expect(row.scope_id).toBe(`${ville.id}:7`);
    // même identifiant d'instance côté CCAS : aucune valeur héritée de la Ville
    const c = (await as(tMartin).get(`/api/v1/organismes/${ccas.id}/settings?instanceId=7`)).body.settings;
    expect(c.delai).toBeUndefined();
  });

  it('la base refuse un paramètre dont la portée est incohérente', async () => {
    await expect(env.db.query("INSERT INTO settings (scope, scope_id, key, value) VALUES ('instance', '5', 'k', '1')")).rejects.toThrow();
    await expect(env.db.query("INSERT INTO settings (scope, scope_id, key, value) VALUES ('platform', '5', 'k', '1')")).rejects.toThrow();
  });
});

describe("garde-fou d'isolation de la couche d'accès", () => {
  it("une requête sans contexte d'organisme échoue au lieu de tout renvoyer", async () => {
    for (const bad of [undefined, null, 0, -1, 'abc', NaN]) expect(() => requireOrg(bad), String(bad)).toThrow(/Contexte d'organisme manquant/);
    expect(requireOrg('12')).toBe(12);
    await expect(env.c.organismes.listRoles({}, undefined)).rejects.toThrow(/Contexte d'organisme manquant/);
    await expect(env.c.organismes.directions({}, null)).rejects.toThrow(/Contexte d'organisme manquant/);
    await expect(env.c.settings.resolve(undefined)).rejects.toThrow(/Contexte d'organisme manquant/);
  });
});
