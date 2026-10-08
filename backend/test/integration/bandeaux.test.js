const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let dupont; let durand; let ville;
const B = (p = '') => `/api/v1/organismes/${ville.id}/bandeaux${p}`;
const h = (n) => new Date(Date.now() + n * 3600 * 1000).toISOString();
const as = (tok) => ({ get: (u) => env.http().get(u).set(bearer(tok)), post: (u, b) => env.http().post(u).set(bearer(tok)).send(b), put: (u, b) => env.http().put(u).set(bearer(tok)).send(b), del: (u) => env.http().delete(u).set(bearer(tok)) });

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  durand = await loginAs(env, 'durand', 'pw-durand');
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  expect((await as(admin).post(`/api/v1/organismes/${ville.id}/roles`, { username: 'durand', role: 'scc' })).status).toBeLessThan(300);   // durand = SCC
});
afterAll(async () => { await env.close(); });

describe('bandeau d\'information', () => {
  let enCours; let programme; let termine;
  it('le SCC et l\'administrateur créent des messages ; un agent ordinaire ne le peut pas', async () => {
    expect((await as(dupont).post(B(), { message: 'Intrusion', debut: h(-1), fin: h(1) })).status).toBe(403);
    enCours = (await as(admin).post(B(), { message: 'Maintenance de l’application ce soir à 20 h.', debut: h(-1), fin: h(5) })).body;
    expect(enCours).toMatchObject({ etat: 'en_cours', actif: true, creePar: expect.any(String) });
    const scc = await as(durand).post(B(), { message: 'Message du SCC', debut: h(2), fin: h(8) });                  // programmé
    expect(scc.status).toBe(201); programme = scc.body; expect(programme.etat).toBe('programme');
    termine = (await as(admin).post(B(), { message: 'Ancien message', debut: h(-10), fin: h(-5) })).body; expect(termine.etat).toBe('termine');
  });

  it('tous les utilisateurs voient seulement les messages actifs dans leur période', async () => {
    for (const tok of [dupont, durand, admin]) {
      const r = await as(tok).get(B('/actifs'));
      expect(r.status).toBe(200); expect(r.body.items.map((x) => x.message)).toEqual(['Maintenance de l’application ce soir à 20 h.']);
    }
    await as(admin).put(B(`/${enCours.id}`), { actif: false });                                                       // interrupteur
    expect((await as(dupont).get(B('/actifs'))).body.items).toEqual([]);
    await as(admin).put(B(`/${enCours.id}`), { actif: true });
    expect((await as(dupont).get(B('/actifs'))).body.items).toHaveLength(1);
  });

  it('la liste d\'administration montre tous les états ; elle est réservée au SCC et à l\'administrateur', async () => {
    expect((await as(dupont).get(B())).status).toBe(403);
    const l = (await as(durand).get(B())).body.items;
    expect(l.map((x) => x.etat).sort()).toEqual(['en_cours', 'programme', 'termine']);
  });

  it('valide les dates et le texte', async () => {
    expect((await as(admin).post(B(), { message: 'Fin avant début', debut: h(5), fin: h(1) })).status).toBe(400);
    expect((await as(admin).post(B(), { message: 'ab', debut: h(1), fin: h(2) })).status).toBe(400);
    expect((await as(admin).post(B(), { message: 'x'.repeat(501), debut: h(1), fin: h(2) })).status).toBe(400);
    expect((await as(admin).post(B(), { message: 'Dates absentes' })).status).toBe(400);
    expect((await as(admin).put(B(`/${enCours.id}`), { fin: h(-3) })).status).toBe(400);                            // fin antérieure au début conservé
  });

  it('modifie, supprime et journalise', async () => {
    const m = await as(admin).put(B(`/${termine.id}`), { message: 'Prolongé', fin: h(3) });
    expect(m.status).toBe(200); expect(m.body.etat).toBe('en_cours'); expect(m.body.modifiePar).toBeTruthy();
    expect((await as(admin).del(B(`/${termine.id}`))).status).toBe(200);
    expect((await as(admin).del(B(`/${termine.id}`))).status).toBe(404);
    const a = (await as(admin).get(`/api/v1/audit?organismeId=${ville.id}&action=bandeau.creation`)).body.items;
    expect(a.length).toBeGreaterThanOrEqual(3);
  });
});
