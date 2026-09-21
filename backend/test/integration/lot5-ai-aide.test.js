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
    expect(r.body.id).toBeGreaterThan(0); // la question est journalisée (notation possible)
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

describe('Del-IA : question, recherche dans les délibérations, notation et journal', () => {
  it("s'appuie sur les délibérations trouvées (recherche en base) et journalise la question/réponse", async () => {
    const types = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items;
    const acte = (await as(dupont).post(`${base()}/actes`, { typeId: types[0].id, titre: 'Aide à la construction d’un skatepark et pratique du skateboard' })).body;
    await env.c.recherche.traiterActe(acte.id);
    let vu = null;
    env.ai.state.handler = (req) => { vu = req; return `Oui : la délibération n° ${acte.numeroSuivi} traite du skateboard.`; };
    const r = await as(dupont).post(`${base()}/ia/delia`, { question: 'Existe-t-il une délibération qui parle de skateboard ?', extraits: [{ titre: 'Manuel', texte: 'Les délibérations sont listées dans Actes & Dossiers.' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.id).toBeGreaterThan(0);
    expect(r.body.reponse).toMatch(/skateboard/);
    expect(vu.prompt).toMatch(/skateboard/i); // les résultats de recherche sont fournis à l'IA
    expect(vu.prompt).toMatch(new RegExp(`n° ${acte.numeroSuivi}`));
    expect(vu.prompt).toMatch(/Direction|Service|Poste/i); // le contexte de l'agent est fourni
  });

  it('note la réponse (1 à 4 étoiles), alimente la moyenne du journal (admin), et respecte les droits', async () => {
    env.ai.state.handler = () => 'Réponse à noter.';
    const r1 = (await as(dupont).post(`${base()}/ia/delia`, { question: 'Question notée ?', extraits: [{ texte: 'extrait' }] })).body;
    expect((await as(dupont).post(`${base()}/ia/delia/${r1.id}/note`, { note: 4, commentaire: 'Très clair' })).status).toBe(200);
    expect((await as(dupont).post(`${base()}/ia/delia/${r1.id}/note`, { note: 5 })).status).toBe(400);
    const durand = await loginAs(env, 'durand', 'pw-durand');
    expect((await as(durand).post(`${base()}/ia/delia/${r1.id}/note`, { note: 2 })).status).toBe(404); // la réponse d'un autre
    const j = (await as(admin).get(`${base()}/ia/delia/journal`)).body;
    expect(j.stats.notes).toBeGreaterThanOrEqual(1);
    expect(j.stats.moyenne).toBeGreaterThanOrEqual(1);
    expect(j.items.some((x) => x.id === r1.id && x.note === 4 && x.commentaire === 'Très clair')).toBe(true);
    expect((await as(dupont).get(`${base()}/ia/delia/journal`)).status).toBe(403); // réservé à l'administration
  });
});
