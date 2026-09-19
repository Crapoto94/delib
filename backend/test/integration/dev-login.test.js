const { createTestEnv, testConfig } = require('../helpers');

let env;
beforeAll(async () => { env = await createTestEnv({ env: { DEV_LOGIN_PASSWORD: 'mot-de-passe-dev-test' } }); });
afterAll(async () => { await env.close(); });

describe('connexion de développement (sans AD)', () => {
  it('valide n\'importe quel identifiant avec le mot de passe commun, sans interroger l\'AD', async () => {
    const before = env.ad.state.calls;
    const r = await env.http().post('/api/v1/auth/login').send({ username: 'PersonneInconnue', password: 'mot-de-passe-dev-test' });
    expect(r.status).toBe(200);
    expect(r.body.username).toBe('personneinconnue');
    expect(env.ad.state.calls).toBe(before); // aucune authentification AD
    const a = await env.db.get("SELECT actor FROM audit_log WHERE action = 'auth.login_dev' ORDER BY id DESC LIMIT 1");
    expect(a.actor).toBe('personneinconnue');
  });

  it('un autre mot de passe suit le chemin normal (AD) et échoue pour un inconnu', async () => {
    const r = await env.http().post('/api/v1/auth/login').send({ username: 'PersonneInconnue', password: 'autre' });
    expect(r.status).toBe(401);
  });

  it('les comptes réels gardent leur mot de passe AD', async () => {
    expect((await env.http().post('/api/v1/auth/login').send({ username: 'dupont', password: 'pw-dupont' })).status).toBe(200);
  });

  it('est refusée par la configuration en production', () => {
    expect(() => testConfig('ivrydelib_test_x', { NODE_ENV: 'production', DEV_LOGIN_PASSWORD: 'x', CORS_ORIGINS: 'https://x.fr' })).toThrow(/DEV_LOGIN_PASSWORD/);
  });
});
