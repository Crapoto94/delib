const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let martin; let instance;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  martin = await loginAs(env, 'martin', 'pw-martin');
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items.find((i) => i.kind === 'conseil') || (await as(admin).get(`${base()}/instances`)).body.items[0];
});
afterAll(async () => { await env.close(); });

describe('président de séance : le maire par défaut au conseil', () => {
  it('à l’ouverture, le maire préside ; un adjoint au maire ne le devient pas ; modifiable ensuite', async () => {
    const adjoint = (await as(admin).post(`${base()}/elus`, { nom: 'Adjoint', prenom: 'Alain', role: 'Adjoint au Maire' })).body;
    const maire = (await as(admin).post(`${base()}/elus`, { nom: 'Bouyssou', prenom: 'Philippe', role: 'Maire' })).body;
    await as(admin).post(`${base()}/elus`, { nom: 'Durif', prenom: 'Paul', role: 'Conseiller municipal' });
    const seance = (await as(martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(20) })).body;
    const T = (p = '') => `${base()}/seances/${seance.id}/tenue${p}`;
    expect((await as(martin).get(T())).body.tenue.statut).toBe('non_ouverte');
    const o = await as(martin).post(T('/ouverture'));
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    expect(o.body.tenue.presidentId).toBe(maire.id); expect(o.body.tenue.presidentId).not.toBe(adjoint.id);
    // le choix du secrétariat n’est jamais écrasé
    const cur = await as(martin).put(T('/bureau'), { presidentId: adjoint.id });
    expect(cur.status, JSON.stringify(cur.body)).toBe(200);
    expect((await as(martin).get(T())).body.tenue.presidentId).toBe(adjoint.id);
  });

  it('sans maire parmi les élus, personne n’est désigné d’office', async () => {
    await env.db.run("UPDATE elus SET role = 'Conseiller municipal' WHERE role = 'Maire'");
    const seance = (await as(martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(40) })).body;
    const r = await as(martin).post(`${base()}/seances/${seance.id}/tenue/ouverture`);
    expect(r.body.tenue.presidentId).toBeNull();
  });
});
