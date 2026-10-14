const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let dupont; let durand; let typeDelib;
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
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  durand = await loginAs(env, 'durand', 'pw-durand');
  typeDelib = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
});
afterAll(async () => { await env.close(); });

describe('habitudes de saisie du rédacteur', () => {
  it('un rédacteur sans acte n\'a aucune habitude', async () => {
    const r = await as(durand).get(`${base()}/actes/habitudes`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ matieres: [], rubriques: [], natures: [], rapporteur: null });
  });

  it('renvoie les valeurs de MES actes, les plus fréquentes d\'abord, avec l\'élu rapporteur et sa commission les plus fréquents', async () => {
    const rubriques = (await as(admin).get(`${base()}/referentiels/rubrique`)).body.items;
    const natures = (await as(admin).get(`${base()}/referentiels/nature`)).body.items;
    expect(rubriques.length).toBeGreaterThan(1);
    const elus = [];
    for (const e of [{ nom: 'Durif', prenom: 'Paul', email: 'paul.durif@example.fr' }, { nom: 'Lambert', prenom: 'Jeanne', email: 'jeanne.lambert@example.fr' }]) elus.push((await as(admin).post(`${base()}/elus`, e)).body);
    const com = (await as(admin).post(`${base()}/commissions`, { nom: 'Commission Finances' })).body;
    const com2 = (await as(admin).post(`${base()}/commissions`, { nom: 'Commission Travaux' })).body;

    const mk = async (titre, rubriqueId, eluId, commissionId) => {
      const a = (await as(dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre, rubriqueId, natureId: natures[0].id, rapporteurId: eluId })).body;
      if (commissionId) await as(dupont).post(`${base()}/actes/${a.id}/commissions`, { commissionId });
      return a;
    };
    await mk('Acte un', rubriques[0].id, elus[0].id, com.id);
    await mk('Acte deux', rubriques[1].id, elus[0].id, com.id);
    await mk('Acte trois', rubriques[1].id, elus[1].id, com2.id);
    await mk('Acte quatre', rubriques[1].id, elus[0].id, com.id);
    // acte d'un autre rédacteur : ne doit pas compter
    await as(durand).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Acte de Durand', rubriqueId: rubriques[0].id, rapporteurId: elus[1].id });

    const h = (await as(dupont).get(`${base()}/actes/habitudes`)).body;
    expect(h.rubriques.map((x) => x.id)).toEqual([rubriques[1].id, rubriques[0].id]);
    expect(h.rubriques[0].n).toBe(3);
    expect(h.natures).toEqual([{ id: natures[0].id, n: 4 }]);
    expect(h.rapporteur).toMatchObject({ eluId: elus[0].id, n: 3, commissionId: com.id });

    const hd = (await as(durand).get(`${base()}/actes/habitudes`)).body;
    expect(hd.rubriques).toEqual([{ id: rubriques[0].id, n: 1 }]);
    expect(hd.rapporteur).toMatchObject({ eluId: elus[1].id, commissionId: null });
  });
});
