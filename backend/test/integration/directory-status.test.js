const { createTestEnv, loginAs, bearer, adminToken, DIRECTIONS } = require('../helpers');

let env; let admin; let agent;
beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  agent = await loginAs(env, 'dupont', 'pw-dupont');
});
afterAll(async () => { await env.close(); });
const get = (t, u) => env.http().get(u).set(bearer(t));

describe('annuaire commun (DirectoryPort)', () => {
  it("liste les directions et services de l'organigramme", async () => {
    const r = await get(agent, '/api/v1/directory/directions');
    expect(r.status).toBe(200);
    expect(r.body.items.map((d) => d.code)).toEqual(['A1', 'J']);
    expect(r.body.items[1].services[0]).toEqual({ code: 'Ja', label: 'AIDE SOCIALE' });
  });

  it('recherche des agents (2 caractères minimum)', async () => {
    const r = await get(agent, '/api/v1/directory/agents/search?q=martin');
    expect(r.body.items.map((a) => a.username)).toEqual(['martin']);
    expect((await get(agent, '/api/v1/directory/agents/search?q=m')).status).toBe(400);
    expect((await env.http().get('/api/v1/directory/agents/search?q=martin')).status).toBe(401);
  });

  it('renvoie la fiche d\'un agent connu, 404 sinon', async () => {
    const r = await get(agent, '/api/v1/directory/agents/DUPONT');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ username: 'dupont', direction: { code: 'A1', label: 'DIRECTION DES FINANCES' }, poste: 'Chargée de budget' });
    expect((await get(agent, '/api/v1/directory/agents/jamais-connu')).status).toBe(404);
  });

  it("l'organigramme avec responsables est réservé aux administrateurs de plateforme", async () => {
    expect((await get(agent, '/api/v1/directory/organisation')).status).toBe(403);
    expect((await get(admin, '/api/v1/directory/organisation')).status).toBe(200);
  });

  it('sert le dernier organigramme connu quand le Hub tombe en panne, sans erreur', async () => {
    await get(agent, '/api/v1/directory/directions'); // remplit le cache
    env.c.dir.directions({ force: true }).catch(() => {});
    env.directoryAdapter.state.failing = true;
    const r = await get(agent, '/api/v1/directory/directions');
    env.directoryAdapter.state.failing = false;
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(DIRECTIONS.length);
  });

  it("répond 502 (et non 500) quand l'annuaire est en panne et sans cache", async () => {
    const e2 = await createTestEnv();
    try {
      const t = await loginAs(e2, 'dupont', 'pw-dupont');
      e2.directoryAdapter.state.failing = true;
      const r = await e2.http().get('/api/v1/directory/agents/search?q=martin').set(bearer(t));
      expect(r.status).toBe(502);
      expect(r.body.code).toBe('UPSTREAM_ERROR');
    } finally { await e2.close(); }
  });
});

describe('GET /api/status', () => {
  it('est public et sans donnée sensible', async () => {
    const r = await env.http().get('/api/status');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.dependencies.database).toMatchObject({ ok: true, migrations: require('../../src/db/migrate').readMigrations().length });
    expect(r.body.dependencies.apm.ok).toBe(true);
    expect(r.body.dependencies.hub.ok).toBe(true);
    const txt = JSON.stringify(r.body);
    for (const secret of ['secret-de-test', 'pw-boot', env.config.db.password, env.config.apm.key, env.config.hub.key]) expect(txt).not.toContain(secret);
  });

  it('est « degraded » (200) quand APM ou Hub sont en panne : la connexion de secours reste possible', async () => {
    env.directoryAdapter.state.failing = true;
    const r = await env.http().get('/api/status');
    env.directoryAdapter.state.failing = false;
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('degraded');
    expect(r.body.dependencies.hub.ok).toBe(false);
  });
});

describe('robustesse HTTP', () => {
  it('renvoie des erreurs normalisées { error, code }', async () => {
    const nf = await env.http().get('/api/v1/inexistant');
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: 'Route introuvable', code: 'NOT_FOUND' });
    const bad = await env.http().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{pas du json');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_REQUEST');
  });

  it('pose des en-têtes de sécurité et un identifiant de requête, et ne dit pas « Express »', async () => {
    const r = await env.http().get('/api/status');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-request-id']).toBeTruthy();
  });

  it('CORS : origine connue acceptée, origine inconnue non', async () => {
    const ok = await env.http().get('/api/status').set('Origin', 'http://localhost:5160');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5160');
    const ko = await env.http().get('/api/status').set('Origin', 'https://evil.example');
    expect(ko.headers['access-control-allow-origin']).toBeUndefined();
  });
});
