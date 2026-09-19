const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ccas; let ville; let tCcasAdmin;
const as = (t) => ({
  get: (u) => env.http().get(u).set(bearer(t)),
  put: (u, b) => env.http().put(u).set(bearer(t)).send(b),
  del: (u) => env.http().delete(u).set(bearer(t)),
});

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  const post = (u, b) => env.http().post(u).set(bearer(admin)).send(b);
  ccas = (await post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS', type: 'ccas' })).body;
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  await post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'martin', role: 'org_admin' });
  await post(`/api/v1/organismes/${ccas.id}/roles`, { username: 'dupont', role: 'lecteur' });
  tCcasAdmin = await loginAs(env, 'martin', 'pw-martin');
});
afterAll(async () => { await env.close(); });

describe('résolution hiérarchique : plateforme -> organisme -> instance -> type d\'acte', () => {
  it('la valeur la plus spécifique l\'emporte et son origine est indiquée', async () => {
    await as(admin).put('/api/v1/platform/settings/delai_convocation', { value: 5 });
    await as(admin).put('/api/v1/platform/settings/quorum', { value: 'majorite' });
    await as(admin).put('/api/v1/platform/settings/couleur', { value: 'bleu' });

    let s = (await as(admin).get(`/api/v1/organismes/${ccas.id}/settings`)).body.settings;
    expect(s.delai_convocation).toEqual({ value: 5, origin: 'platform' });

    await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/delai_convocation`, { value: 3 });
    await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/delai_convocation`, { value: 2, scope: 'instance', subId: 4 });
    await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/delai_convocation`, { value: 1, scope: 'type_acte', subId: 9 });

    s = (await as(admin).get(`/api/v1/organismes/${ccas.id}/settings`)).body.settings;
    expect(s.delai_convocation).toEqual({ value: 3, origin: 'organisme' });
    s = (await as(admin).get(`/api/v1/organismes/${ccas.id}/settings?instanceId=4`)).body.settings;
    expect(s.delai_convocation).toEqual({ value: 2, origin: 'instance' });
    s = (await as(admin).get(`/api/v1/organismes/${ccas.id}/settings?instanceId=4&typeActeId=9`)).body.settings;
    expect(s.delai_convocation).toEqual({ value: 1, origin: 'type_acte' });
    expect(s.quorum).toEqual({ value: 'majorite', origin: 'platform' });
    expect(s.couleur.origin).toBe('platform');
  });

  it('la surcharge du CCAS ne change rien pour la Ville', async () => {
    const s = (await as(admin).get(`/api/v1/organismes/${ville.id}/settings?instanceId=4&typeActeId=9`)).body.settings;
    expect(s.delai_convocation).toEqual({ value: 5, origin: 'platform' });
  });

  it('supprimer un niveau rend la valeur héritée', async () => {
    expect((await as(tCcasAdmin).del(`/api/v1/organismes/${ccas.id}/settings/delai_convocation?scope=type_acte&subId=9`)).status).toBe(204);
    const s = (await as(admin).get(`/api/v1/organismes/${ccas.id}/settings?instanceId=4&typeActeId=9`)).body.settings;
    expect(s.delai_convocation).toEqual({ value: 2, origin: 'instance' });
    expect((await as(tCcasAdmin).del(`/api/v1/organismes/${ccas.id}/settings/delai_convocation?scope=organisme`)).status).toBe(204);
    expect((await as(admin).get(`/api/v1/organismes/${ccas.id}/settings`)).body.settings.delai_convocation.origin).toBe('platform');
    expect((await as(tCcasAdmin).del(`/api/v1/organismes/${ccas.id}/settings/delai_convocation?scope=type_acte&subId=9`)).status).toBe(404);
  });

  it('accepte tous les types JSON et les restitue à l\'identique', async () => {
    const values = { objet: { a: [1, 2, { b: null }], c: 'é' }, liste: [1, 'deux', true], zero: 0, faux: false, texte: '' };
    for (const [k, v] of Object.entries(values)) expect((await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/${k}`, { value: v })).status, k).toBe(200);
    const s = (await as(admin).get(`/api/v1/organismes/${ccas.id}/settings`)).body.settings;
    for (const [k, v] of Object.entries(values)) expect(s[k].value, k).toEqual(v);
  });
});

describe('validation et droits', () => {
  it('valide la clé, la valeur et la portée', async () => {
    expect((await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/Cle-Invalide`, { value: 1 })).status).toBe(400);
    expect((await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/ok`, {})).status).toBe(400);
    expect((await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/ok`, { value: 1, scope: 'platform' })).status).toBe(400);
    expect((await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/ok`, { value: 1, scope: 'instance' })).status).toBe(400);
  });

  it("seul un administrateur d'organisme modifie ; un lecteur lit", async () => {
    const lecteur = await loginAs(env, 'dupont', 'pw-dupont');
    expect((await as(lecteur).get(`/api/v1/organismes/${ccas.id}/settings`)).status).toBe(200);
    expect((await as(lecteur).put(`/api/v1/organismes/${ccas.id}/settings/x`, { value: 1 })).status).toBe(403);
    expect((await as(tCcasAdmin).get('/api/v1/platform/settings')).status).toBe(403);
    expect((await as(tCcasAdmin).put('/api/v1/platform/settings/x', { value: 1 })).status).toBe(403);
  });

  it('chaque modification est auditée avec l\'ancienne et la nouvelle valeur', async () => {
    await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/audit_test`, { value: 'v1' });
    await as(tCcasAdmin).put(`/api/v1/organismes/${ccas.id}/settings/audit_test`, { value: 'v2' });
    const a = (await as(admin).get(`/api/v1/audit?organismeId=${ccas.id}&action=setting.set`)).body.items.find((i) => i.entityId.endsWith(':audit_test'));
    expect(a.before).toEqual({ value: 'v1' });
    expect(a.after).toEqual({ value: 'v2' });
    expect(a.actor).toBe('martin');
  });
});
