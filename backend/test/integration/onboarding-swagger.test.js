const { createTestEnv, loginAs, bearer } = require('../helpers');
const { TOURS } = require('../../src/modules/me/tours');

let env;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.close(); });
const api = (t) => ({
  get: (u) => env.http().get(u).set(bearer(t)),
  put: (u, b) => env.http().put(u).set(bearer(t)).send(b),
});

describe('tutoriel de première connexion (UX-20 à 26)', () => {
  it("est proposé à la première connexion, puis n'est plus proposé une fois terminé", async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    const me = (await api(t).get('/api/v1/me')).body;
    expect(me.onboarding.toShow).toEqual([{ id: 'first-login', version: 1, status: 'new' }]);

    const r = await api(t).put('/api/v1/me/onboarding/first-login', { version: 1, status: 'completed', stepsDone: ['bienvenue', 'creer-un-acte'] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'completed', version: 1, toShow: false });
    expect(r.body.stepsDone).toEqual(['bienvenue', 'creer-un-acte']);
    expect(r.body.completedAt).toBeTruthy();
    expect((await api(t).get('/api/v1/me')).body.onboarding.toShow).toEqual([]);
  });

  it("« ignoré » n'est plus proposé non plus ; le tutoriel reste rejouable", async () => {
    const t = await loginAs(env, 'martin', 'pw-martin');
    await api(t).put('/api/v1/me/onboarding/first-login', { version: 1, status: 'skipped' });
    expect((await api(t).get('/api/v1/me')).body.onboarding.toShow).toEqual([]);
    const replay = await api(t).put('/api/v1/me/onboarding/first-login', { version: 1, status: 'started' });
    expect(replay.body).toMatchObject({ status: 'started', toShow: true, skippedAt: null });
    expect((await api(t).get('/api/v1/me')).body.onboarding.toShow).toHaveLength(1);
  });

  it("l'avancement est propre à chaque utilisateur", async () => {
    const t = await loginAs(env, 'nouveau', 'pw-nouveau');
    expect((await api(t).get('/api/v1/me')).body.onboarding.toShow).toHaveLength(1);
    const list = (await api(t).get('/api/v1/me/onboarding')).body.tours;
    expect(list[0]).toMatchObject({ id: 'first-login', status: 'new', toShow: true });
  });

  it('une nouvelle version du tutoriel est reproposée à ceux qui l\'avaient terminé (Nouveautés)', async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    expect((await api(t).get('/api/v1/me')).body.onboarding.toShow).toEqual([]);
    TOURS[0].version = 2;
    try {
      const me = (await api(t).get('/api/v1/me')).body;
      expect(me.onboarding.toShow).toEqual([{ id: 'first-login', version: 2, status: 'completed' }]);
      await api(t).put('/api/v1/me/onboarding/first-login', { version: 2, status: 'completed' });
      expect((await api(t).get('/api/v1/me')).body.onboarding.toShow).toEqual([]);
    } finally { TOURS[0].version = 1; }
  });

  it('refuse un tutoriel inconnu, une version future et une saisie invalide', async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    expect((await api(t).put('/api/v1/me/onboarding/inconnu', { version: 1, status: 'completed' })).status).toBe(404);
    expect((await api(t).put('/api/v1/me/onboarding/first-login', { version: 99, status: 'completed' })).status).toBe(400);
    expect((await api(t).put('/api/v1/me/onboarding/first-login', { version: 1, status: 'gagné' })).status).toBe(400);
    expect((await api(t).put('/api/v1/me/onboarding/first-login', { version: 0, status: 'completed' })).status).toBe(400);
    expect((await env.http().put('/api/v1/me/onboarding/first-login').send({ version: 1, status: 'completed' })).status).toBe(401);
  });
});

describe('documentation Swagger (critère d\'acceptation n°7)', () => {
  const toOa = (p) => p.replace(/:(\w+)/g, '{$1}');

  it('documente TOUTES les routes enregistrées, et rien de plus', async () => {
    const spec = (await env.http().get('/swagger.json')).body;
    const documented = new Set(Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)));
    const registered = env.app.locals.registry.map((r) => `${r.method.toUpperCase()} ${toOa(r.path)}`);
    expect(registered.length).toBeGreaterThan(30);
    expect(registered.filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((d) => !registered.includes(d))).toEqual([]);
  });

  it('chaque opération a un résumé, un tag, ses paramètres de chemin et sa politique de sécurité', async () => {
    const spec = (await env.http().get('/swagger.json')).body;
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(ops)) {
        const id = `${m.toUpperCase()} ${path}`;
        expect(op.summary, id).toBeTruthy();
        expect(op.tags?.length, id).toBeGreaterThan(0);
        for (const p of [...path.matchAll(/\{(\w+)\}/g)].map((x) => x[1])) expect(op.parameters.some((q) => q.name === p && q.in === 'path'), `${id} :${p}`).toBe(true);
        expect(Array.isArray(op.security), id).toBe(true);
      }
    }
  });

  it("les routes publiques sont explicitement déclarées sans sécurité, toutes les autres exigent le jeton", async () => {
    const spec = (await env.http().get('/swagger.json')).body;
    const open = Object.entries(spec.paths).flatMap(([p, ops]) => Object.entries(ops).filter(([, o]) => o.security.length === 0).map(([m]) => `${m.toUpperCase()} ${p}`)).sort();
    expect(open).toEqual(['GET /api/status', 'GET /api/v1/public/branding', 'GET /api/v1/public/organismes/{orgId}/logo', 'GET /api/v1/public/convocations/{token}', 'GET /api/v1/public/convocations/{token}/convocation.pdf', 'GET /api/v1/public/convocations/{token}/ordre-du-jour.pdf', 'GET /api/v1/public/convocations/{token}/pieces/{fichierId}', 'POST /api/v1/auth/login', 'POST /api/v1/auth/login-local', 'POST /api/v1/public/convocations/{token}/accuse', 'POST /api/v1/public/convocations/{token}/reponse'].sort());
  });

  it("chaque route protégée refuse l'accès sans jeton (401)", async () => {
    const spec = (await env.http().get('/swagger.json')).body;
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(ops)) {
        if (op.security.length === 0) continue;
        const url = path.replace(/\{\w+\}/g, '1');
        const r = await env.http()[m](url).send({});
        expect(r.status, `${m.toUpperCase()} ${path}`).toBe(401);
      }
    }
  });

  it('les schémas de corps viennent de la validation (documentation et validation ne divergent pas)', async () => {
    const spec = (await env.http().get('/swagger.json')).body;
    const schema = spec.paths['/api/v1/organismes'].post.requestBody.content['application/json'].schema;
    expect(schema.required).toEqual(expect.arrayContaining(['code', 'nom']));
    expect(schema.properties.type.enum).toEqual(['commune', 'ccas', 'autre']);
    expect(spec.paths['/api/v1/organismes/{orgId}/roles'].post.requestBody.content['application/json'].schema.properties.role.enum).toEqual(['org_admin', 'scc', 'teletransmission', 'lecteur']);
  });

  it('sert Swagger UI', async () => {
    const r = await env.http().get('/api-docs/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('swagger-ui');
  });
});
