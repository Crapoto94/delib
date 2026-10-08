/**
 * Régression : l'écran « Contrôle de légalité » plantait (erreur 409 sur /config, donc page inutilisable) dès que S²LOW était injoignable
 * ou que le certificat client était absent — alors que cet écran sert justement à corriger cela. La lecture des paramètres ne doit
 * pas dépendre du fournisseur : l'échec est rendu dans `connexion`.
 */
const { createTestEnv, bearer, adminToken } = require('../helpers');

let env; let admin; let ville;
const base = () => `/api/v1/organismes/${ville.id}`;
const regler = (key, val) => env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key, val });

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
});
afterAll(async () => { await env.close(); });

describe('configuration de la télétransmission avec un fournisseur injoignable', () => {
  it('répond quand même, avec l\'échec de connexion plutôt qu\'une erreur', async () => {
    await regler('tlt.mode', 'test'); await regler('tdt.s2low.url', 'https://s2low.invalide.example');   // vrai fournisseur, aucun certificat importé
    const r = await env.http().get(`${base()}/teletransmission/config`).set(bearer(admin));
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('test');
    expect(r.body.connexion).toMatchObject({ ok: false });
    expect(String(r.body.connexion.message)).toMatch(/certificat|S²LOW/i);
    expect(r.body.classification).toBeTruthy();                                                   // classification de repli, jamais d'erreur
  });

  it('le tableau de bord et la liste des transmissions restent consultables', async () => {
    expect((await env.http().get(`${base()}/teletransmission/tableau`).set(bearer(admin))).status).toBe(200);
    expect((await env.http().get(`${base()}/teletransmission/transactions`).set(bearer(admin))).status).toBe(200);
    expect((await env.http().get(`${base()}/teletransmission/hors-seance`).set(bearer(admin))).status).toBe(200);
  });
});
