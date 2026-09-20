const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { dupont: await loginAs(env, 'dupont', 'pw-dupont'), durand: await loginAs(env, 'durand', 'pw-durand') };
});
afterAll(async () => { await env.close(); });

describe('dossier d’entraînement (UX-22)', () => {
  let id;
  it('crée un brouillon d’exemple pré-rempli, une seule fois par personne', async () => {
    const r = await as(t.dupont).post(`${base()}/entrainement`);
    expect(r.status).toBe(201); expect(r.body.cree).toBe(true); id = r.body.acteId;
    const a = (await as(t.dupont).get(`${base()}/actes/${id}`)).body;
    expect(a).toMatchObject({ statut: 'brouillon', custom: { entrainement: true } });
    expect(a.titre).toMatch(/^Entraînement/);
    const textes = (await as(t.dupont).get(`${base()}/actes/${id}/textes`)).body.items;
    expect(textes.map((x) => x.kind).sort()).toEqual(['dispositif', 'expose', 'visas']);
    const dispo = (await as(t.dupont).get(`${base()}/actes/${id}/textes/${textes.find((x) => x.kind === 'dispositif').id}`)).body;
    expect(dispo.markdown).toMatch(/Article 1/);
    const encore = await as(t.dupont).post(`${base()}/entrainement`);
    expect(encore.status).toBe(200); expect(encore.body).toEqual({ acteId: id, cree: false });
    expect((await as(t.durand).post(`${base()}/entrainement`)).body.acteId).not.toBe(id); // chacun a le sien
  });

  it('on peut s’exercer (modifier la fiche) mais jamais envoyer au circuit ; le marqueur ne se retire pas', async () => {
    expect((await as(t.dupont).put(`${base()}/actes/${id}`, { titre: 'Entraînement — mon essai' })).status).toBe(200);
    const envoi = await as(t.dupont).post(`${base()}/actes/${id}/envoi`);
    expect(envoi.status).toBe(409); expect(envoi.body.error).toMatch(/entraînement/);
    const sans = await as(t.dupont).put(`${base()}/actes/${id}`, { custom: {} });
    expect(sans.body.custom.entrainement).toBe(true);
    const vrai = (await as(t.dupont).post(`${base()}/actes`, { typeId: (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items[0].id, titre: 'Un vrai dossier' })).body;
    expect((await as(t.dupont).put(`${base()}/actes/${vrai.id}`, { custom: { entrainement: true } })).body.custom.entrainement).toBeUndefined(); // on ne s'en fabrique pas un
  });

  it('n’entre jamais dans la recherche ; se purge après 14 jours', async () => {
    await env.c.recherche.traiterActe(id);
    expect(await env.db.get('SELECT count(*)::int AS n FROM search_index WHERE acte_id = $1', [id])).toEqual({ n: 0 });
    const r = await as(t.dupont).get(`${base()}/recherche?q=Petits`);
    expect(r.body.items).toEqual([]);
    expect((await env.c.recherche.balayer(ville.id)).n).toBeGreaterThanOrEqual(0);
    expect(await env.db.get('SELECT count(*)::int AS n FROM search_index WHERE acte_id = $1', [id])).toEqual({ n: 0 });
    expect(await env.c.entrainement.purger(ville.id)).toBe(0);
    await env.db.run("UPDATE actes SET created_at = now() - interval '15 days' WHERE id = $1", [id]);
    expect(await env.c.entrainement.purger(ville.id)).toBe(1);
    expect((await as(t.dupont).get(`${base()}/actes?scope=mine`)).body.items.map((a) => a.id)).not.toContain(id);
    expect((await as(t.dupont).post(`${base()}/entrainement`)).body.cree).toBe(true); // un nouveau s'ouvre si besoin
  });
});
