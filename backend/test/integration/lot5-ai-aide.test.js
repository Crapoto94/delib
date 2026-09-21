const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let dupont;
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
});
afterAll(async () => { await env.close(); });

describe("aide IA fondée sur le manifeste", () => {
  it("répond à partir des extraits fournis (consigne bornée au manifeste) et expose l'usage « aide »", async () => {
    let vu = null;
    env.ai.state.handler = (req) => { vu = req; return 'Cliquez sur « Envoyer pour validation ». (Manifeste › Le circuit)'; };
    const r = await as(dupont).post(`${base()}/ia/manifeste`, { question: 'Comment envoyer un dossier au circuit ?', extraits: [{ titre: 'Manifeste › Le circuit', texte: 'Le dossier part au circuit via le bouton Envoyer pour validation.' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.reponse).toMatch(/Envoyer pour validation/);
    expect(vu.system).toMatch(/manifeste/i);
    expect(vu.system).toMatch(/UNIQUEMENT/);
    expect(vu.prompt).toContain('Comment envoyer un dossier au circuit ?');
    expect(vu.prompt).toContain('Le dossier part au circuit via le bouton Envoyer pour validation.');
    expect((await as(dupont).get(`${base()}/ia/statut`)).body.aide).toBe(true);
  });

  it('valide les entrées (question trop courte, aucun extrait)', async () => {
    expect((await as(dupont).post(`${base()}/ia/manifeste`, { question: 'x', extraits: [{ titre: 'T', texte: 'a' }] })).status).toBe(400);
    expect((await as(dupont).post(`${base()}/ia/manifeste`, { question: 'Une question valable ?', extraits: [] })).status).toBe(400);
  });

  it("est refusée lorsque l'usage est désactivé par l'administration ; une consigne propre est possible", async () => {
    const maj = await as(admin).put(`${base()}/ia/prompts/aide`, { actif: false, texte: 'Tu réponds uniquement à partir des extraits du manifeste fournis, sans rien inventer, et tu cites les sections utilisées.' });
    expect(maj.status, JSON.stringify(maj.body)).toBe(200);
    expect((await as(dupont).get(`${base()}/ia/statut`)).body.aide).toBe(false);
    const r = await as(dupont).post(`${base()}/ia/manifeste`, { question: 'Comment envoyer ?', extraits: [{ titre: 'T', texte: 'extrait' }] });
    expect(r.status).toBe(403);
    expect((await as(admin).put(`${base()}/ia/prompts/aide`, { actif: true })).body.items.find((x) => x.code === 'aide').actif).toBe(true);
  });
});
