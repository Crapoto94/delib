const { createTestEnv, bearer, adminToken } = require('../helpers');
const { createEluAuth } = require('../../src/modules/espace-elus/elu-auth.service');

const DEV = 'mot-de-passe-de-dev-commun-2026';
let env; let admin; let ville; let elu;
const post = (b) => env.http().post('/api/v1/elus-auth/connexion').send(b);

beforeAll(async () => {
  env = await createTestEnv({ env: { DEV_LOGIN_PASSWORD: DEV } });
  admin = await adminToken(env);
  ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  elu = (await env.http().post(`/api/v1/organismes/${ville.id}/elus`).set(bearer(admin)).send({ nom: 'Nader', prenom: 'Kévin', role: 'Conseiller municipal', email: 'knader@ivry94.fr' })).body;
});
afterAll(async () => { await env.close(); });

describe('connexion de développement de l’espace des élus (mot de passe commun DEV_LOGIN_PASSWORD)', () => {
  it('le mot de passe de développement identifie l’élu par son adresse, sans invitation ni code par mail', async () => {
    expect(elu.id).toBeTruthy();
    const r = await post({ email: 'KNader@ivry94.fr', motDePasse: DEV });                        // casse de l'adresse indifférente
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.session.token).toBeTruthy(); expect(r.body.session.elu).toMatchObject({ id: elu.id, organismeId: ville.id });
    // la session fonctionne dans l'espace des élus
    expect((await env.http().get('/api/v1/elus/accueil').set(bearer(r.body.session.token))).status).toBe(200);
    const s = await env.db.get('SELECT via FROM elu_sessions ORDER BY expire_le DESC LIMIT 1');
    expect(s.via).toBe('dev');
    const a = await env.db.get("SELECT actor FROM audit_log WHERE action = 'elu.connexion_dev'");
    expect(a.actor).toBe(`elu:${elu.id}`);
  });

  it('un autre mot de passe reste refusé ; une adresse inconnue aussi, même avec le mot de passe de développement', async () => {
    expect((await post({ email: 'knader@ivry94.fr', motDePasse: 'autre-mot-de-passe' })).status).toBe(401);
    expect((await post({ email: 'inconnu@ivry94.fr', motDePasse: DEV })).status).toBe(401);
  });

  it('jamais en production', async () => {
    const prod = createEluAuth({ db: env.db, config: { ...env.config, env: 'production' }, mail: env.c.mail, settings: env.c.settings, audit: env.c.audit, log: { warn() {}, info() {}, error() {} }, sms: env.c.sms });
    await expect(prod.connexion({ email: 'knader@ivry94.fr', motDePasse: DEV, ip: '127.0.0.1' })).rejects.toMatchObject({ status: 401 });
  });

  it('un élu désactivé ne peut pas se connecter, même avec le mot de passe de développement', async () => {
    await env.db.run('UPDATE elus SET actif = false WHERE id = $1', [elu.id]);
    expect((await post({ email: 'knader@ivry94.fr', motDePasse: DEV })).status).toBe(401);
  });
});
