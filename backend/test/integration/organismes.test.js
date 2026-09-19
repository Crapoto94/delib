const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin;
beforeAll(async () => { env = await createTestEnv(); admin = await adminToken(env); });
afterAll(async () => { await env.close(); });

const as = (t) => ({
  get: (u) => env.http().get(u).set(bearer(t)),
  post: (u, b) => env.http().post(u).set(bearer(t)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(t)).send(b),
  del: (u) => env.http().delete(u).set(bearer(t)),
});

describe('organismes', () => {
  it("l'organisme par défaut (Ville) existe dès le démarrage", async () => {
    const r = await as(admin).get('/api/v1/organismes');
    expect(r.status).toBe(200);
    const ville = r.body.items.find((o) => o.code === 'ville');
    expect(ville).toMatchObject({ isDefault: true, actif: true, nom: 'Ville' });
  });

  it('un administrateur de plateforme crée le CCAS ; le code doit être unique', async () => {
    const r = await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS d\'Ivry', type: 'ccas', siren: '267 000 000'.replace(/ /g, ''), vocabulaire: { instance: "Conseil d'administration" } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: 'ccas', type: 'ccas', isDefault: false, vocabulaire: { instance: "Conseil d'administration" } });
    expect((await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'Autre' })).status).toBe(409);
  });

  it('valide les données (code, SIREN, type)', async () => {
    expect((await as(admin).post('/api/v1/organismes', { code: 'X', nom: 'x' })).status).toBe(400);
    expect((await as(admin).post('/api/v1/organismes', { code: 'ok-code', nom: 'Test', siren: '123' })).status).toBe(400);
    expect((await as(admin).post('/api/v1/organismes', { code: 'ok-code', nom: 'Test', type: 'inconnu' })).status).toBe(400);
  });

  it('seul un administrateur de plateforme crée un organisme', async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    expect((await as(t).post('/api/v1/organismes', { code: 'pirate', nom: 'Pirate' })).status).toBe(403);
  });

  it("l'audit garde l'état avant / après d'une modification", async () => {
    const ccas = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ccas');
    const r = await as(admin).put(`/api/v1/organismes/${ccas.id}`, { nom: 'CCAS Ivry-sur-Seine' });
    expect(r.status).toBe(200);
    const audit = await as(admin).get(`/api/v1/audit?organismeId=${ccas.id}&action=organisme.update`);
    expect(audit.body.items[0]).toMatchObject({ actor: 'boot', entity: 'organismes' });
    expect(audit.body.items[0].before.nom).toBe("CCAS d'Ivry");
    expect(audit.body.items[0].after.nom).toBe('CCAS Ivry-sur-Seine');
  });

  it("l'organisme par défaut ne peut pas être désactivé", async () => {
    const ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
    expect((await as(admin).put(`/api/v1/organismes/${ville.id}`, { actif: false })).status).toBe(409);
  });
});

describe('rattachement des agents à un organisme par leur direction (D22)', () => {
  let ville; let ccas;
  beforeAll(async () => {
    const items = (await as(admin).get('/api/v1/organismes')).body.items;
    ville = items.find((o) => o.code === 'ville'); ccas = items.find((o) => o.code === 'ccas');
  });

  it('avant tout rattachement, tout agent relève de la Ville (organisme par défaut)', async () => {
    const me = await as(await loginAs(env, 'martin', 'pw-martin')).get('/api/v1/me');
    expect(me.body.organismes.map((o) => o.code)).toEqual(['ville']);
    expect(me.body.organismes[0].via).toEqual(['default']);
  });

  it('la direction « DIRECTION CCAS » rattachée au CCAS place ses agents dans le CCAS, et eux seuls', async () => {
    const r = await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [{ code: 'J', label: 'DIRECTION CCAS' }] });
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([{ code: 'J', label: 'DIRECTION CCAS' }]);
    const martin = (await as(await loginAs(env, 'martin', 'pw-martin')).get('/api/v1/me')).body;
    expect(martin.organismes.map((o) => o.code)).toEqual(['ccas']);
    expect(martin.organismes[0].via).toEqual(['direction']);
    const dupont = (await as(await loginAs(env, 'dupont', 'pw-dupont')).get('/api/v1/me')).body;
    expect(dupont.organismes.map((o) => o.code)).toEqual(['ville']);
  });

  it('une direction ne peut appartenir qu\'à un seul organisme (409 avec le détail)', async () => {
    const r = await as(admin).put(`/api/v1/organismes/${ville.id}/directions`, { directions: [{ code: 'J' }] });
    expect(r.status).toBe(409);
    expect(r.body.details).toEqual([{ code: 'J', organisme: 'ccas' }]);
  });

  it('remplacer la liste retire les directions absentes', async () => {
    await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [{ code: 'J' }, { code: 'K', label: 'AUTRE' }] });
    const r = await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [{ code: 'K', label: 'AUTRE' }] });
    expect(r.body.items.map((d) => d.code)).toEqual(['K']);
    await as(admin).put(`/api/v1/organismes/${ccas.id}/directions`, { directions: [{ code: 'J', label: 'DIRECTION CCAS' }] });
  });

  it('un agent qui a un rôle dans un autre organisme y a accès sans changer de rattachement', async () => {
    const r = await as(admin).post(`/api/v1/organismes/${ville.id}/roles`, { username: 'MARTIN', role: 'lecteur' });
    expect(r.status).toBe(201);
    const me = (await as(await loginAs(env, 'martin', 'pw-martin')).get('/api/v1/me')).body;
    expect(me.organismes.map((o) => o.code).sort()).toEqual(['ccas', 'ville']);
    expect(me.organismes.find((o) => o.code === 'ville')).toMatchObject({ roles: ['lecteur'], via: ['role'] });
    await as(admin).del(`/api/v1/organismes/${ville.id}/roles/${r.body.id}`);
  });
});

describe('rôles', () => {
  let ccas;
  beforeAll(async () => { ccas = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ccas'); });

  it('attribue, refuse les doublons, retire, et audite', async () => {
    const a = await as(admin).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'Martin', role: 'org_admin' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ username: 'martin', role: 'org_admin', createdBy: 'boot' });
    expect((await as(admin).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'martin', role: 'org_admin' })).status).toBe(409);
    expect((await as(admin).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'martin', role: 'platform_admin' })).status).toBe(400);
    expect((await as(admin).get(`/api/v1/organismes/${ccas.id}/roles`)).body.items).toHaveLength(1);
    expect((await as(admin).del(`/api/v1/organismes/${ccas.id}/roles/${a.body.id}`)).status).toBe(204);
    expect((await as(admin).del(`/api/v1/organismes/${ccas.id}/roles/${a.body.id}`)).status).toBe(404);
    const audit = await as(admin).get(`/api/v1/audit?organismeId=${ccas.id}`);
    expect(audit.body.items.map((i) => i.action)).toEqual(expect.arrayContaining(['role.add', 'role.remove']));
  });

  it("un administrateur d'organisme gère les rôles de SON organisme", async () => {
    await as(admin).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'martin', role: 'org_admin' });
    const t = await loginAs(env, 'martin', 'pw-martin');
    expect((await as(t).post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'nouveau', role: 'scc' })).status).toBe(201);
    expect((await as(t).put(`/api/v1/organismes/${ccas.id}`, { adresse: '1 rue du Test' })).status).toBe(200);
  });

  it("un simple agent ne gère pas les rôles", async () => {
    const t = await loginAs(env, 'nouveau', 'pw-nouveau');
    expect((await as(t).get(`/api/v1/organismes/${(await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville').id}/roles`)).status).toBe(403);
  });
});

describe('administrateurs de plateforme', () => {
  it('ajoute un administrateur (insensible à la casse) et refuse les doublons', async () => {
    const added = await as(admin).post('/api/v1/platform/admins', { username: 'Dupont' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ username: 'dupont', organismeId: null, role: 'platform_admin' });
    expect((await as(admin).post('/api/v1/platform/admins', { username: 'dupont' })).status).toBe(409);
    expect((await as(admin).get('/api/v1/platform/admins')).body.items.map((i) => i.username)).toContain('dupont');
  });

  it('refuse de retirer le dernier administrateur de plateforme', async () => {
    const e2 = await createTestEnv({ env: { LOCAL_ADMIN_ENABLED: 'false' } });
    try {
      const t = await loginAs(e2, 'boot', 'pw-boot');
      const list = await e2.http().get('/api/v1/platform/admins').set(bearer(t));
      expect(list.body.items).toHaveLength(1);
      const r = await e2.http().delete(`/api/v1/platform/admins/${list.body.items[0].id}`).set(bearer(t));
      expect(r.status).toBe(409);
    } finally { await e2.close(); }
  });
});
