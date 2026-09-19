const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let ids;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const setting = (key, value) => env.db.query("INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('platform', '', $1, $2::jsonb, 't') ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
const CTX = "Nouvelle subvention 2027 pour une autre association, montant 3 000 euros.";
const q = () => env.c.aiQueue;
const job = (id) => env.db.get('SELECT * FROM ai_jobs WHERE id = $1', [id]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy']]) t[u] = await loginAs(env, u, p);
  typeDelib = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  ids = {};
  // un brouillon par utilisateur (les trois sont dans la direction A1 : chacun rédige son acte)
  for (const u of ['dupont', 'durand', 'leroy']) {
    const a = (await as(t[u]).post(`${base()}/actes`, { typeId: typeDelib.id, titre: `Brouillon de ${u}` })).body;
    for (const x of (await as(t[u]).get(`${base()}/actes/${a.id}/textes`)).body.items.filter((x) => x.kind === 'expose')) await as(t[u]).put(`${base()}/actes/${a.id}/textes/${x.id}`, { markdown: 'Subvention de 5 000 euros à une association.', baseVersion: x.version });
    ids[u] = a.id;
  }
  env.ai.state.handler = () => JSON.stringify({ propositions: [{ find: '5 000 euros', replace: '3 000 euros', raison: 'montant' }], alertes: [] });
});
afterAll(async () => { await env.close(); });
const ask = (u, acteId = ids[u]) => as(t[u]).post(`${base()}/actes/${acteId}/ia/adaptation`, { contexte: CTX });

describe('file d\'attente de l\'IA : arrière plan, limites paramétrables', () => {
  it('l\'appel HTTP ne bloque pas : 202 immédiat, l\'IA n\'est pas encore interrogée, la tâche est « en attente »', async () => {
    const r = await ask('dupont');
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'queued', position: 1, progress: 0 });
    expect(env.ai.state.calls.length).toBe(0);
    await q().drain();
    expect((await as(t.dupont).get(`${base()}/ia/taches/${r.body.id}`)).body).toMatchObject({ status: 'done', progress: 3, total: 3 });
    expect(env.ai.state.calls.length).toBe(1);
  });

  it('plafond de requêtes simultanées (ai.max_concurrent) : jamais plus que la limite en cours', async () => {
    await setting('ai.max_concurrent', 2); await setting('ai.intervalle_ms', 0); await setting('ai.file_max_par_utilisateur', 5);
    let inFlight = 0; let peak = 0;
    env.ai.state.handler = async () => { inFlight++; peak = Math.max(peak, inFlight); await wait(700); inFlight--; return '{"propositions":[],"alertes":[]}'; };
    const jobs = [(await ask('dupont')).body, (await ask('durand')).body, (await ask('leroy')).body];
    await q().tick();
    const st = async (name) => (await env.db.all('SELECT id FROM ai_jobs WHERE status = $1', [name])).length;
    expect(await st('running')).toBe(2); // deux en cours…
    expect(await st('queued')).toBe(1); // …le troisième attend
    await q().drain();
    expect(peak).toBe(2);
    for (const j of jobs) expect((await job(j.id)).status).toBe('done');
  });

  it('plafond par utilisateur (ai.max_par_utilisateur) : ses tâches passent l\'une après l\'autre', async () => {
    await setting('ai.max_concurrent', 3); await setting('ai.max_par_utilisateur', 1);
    let inFlight = 0; let peak = 0;
    env.ai.state.handler = async () => { inFlight++; peak = Math.max(peak, inFlight); await wait(500); inFlight--; return '{"propositions":[],"alertes":[]}'; };
    await ask('dupont'); await ask('dupont');
    await q().tick();
    expect((await env.db.all("SELECT id FROM ai_jobs WHERE status = 'running'")).length).toBe(1);
    await q().drain();
    expect(peak).toBe(1);
  });

  it('équité : un utilisateur qui a déjà une tâche en cours passe après les autres', async () => {
    await setting('ai.max_concurrent', 1); await setting('ai.max_par_utilisateur', 1);
    env.ai.state.handler = async () => { await wait(400); return '{"propositions":[],"alertes":[]}'; };
    const a1 = (await ask('dupont')).body;
    await q().tick(); // a1 démarre : dupont a une tâche en cours
    expect((await job(a1.id)).status).toBe('running');
    const a2 = (await ask('dupont')).body; const b1 = (await ask('durand')).body;
    await q().drain();
    const order = (await env.db.all('SELECT id FROM ai_jobs WHERE id = ANY($1::int[]) ORDER BY started_at', [[a1.id, a2.id, b1.id]])).map((r) => r.id);
    expect(order).toEqual([a1.id, b1.id, a2.id]); // durand n'attend pas derrière les deux tâches de dupont
  });

  it('refuse (429) quand le quota de l\'utilisateur est atteint, puis quand la file est pleine', async () => {
    await q().drain();
    await setting('ai.file_max_par_utilisateur', 2); await setting('ai.max_concurrent', 1);
    env.ai.state.handler = async () => { await wait(50); return '{"propositions":[],"alertes":[]}'; };
    expect((await ask('leroy')).status).toBe(202); expect((await ask('leroy')).status).toBe(202);
    const r = await ask('leroy');
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/déjà 2 demandes/);
    await q().drain();
    await setting('ai.file_max', 1); await setting('ai.file_max_par_utilisateur', 5);
    expect((await ask('dupont')).status).toBe(202);
    const full = await ask('durand');
    expect(full.status).toBe(429);
    expect(full.body.error).toMatch(/file d'attente de l'IA est pleine/);
    await setting('ai.file_max', 50); await q().drain();
  });

  it('annule une tâche en attente ; un tiers ne peut pas l\'annuler', async () => {
    await setting('ai.max_concurrent', 1);
    env.ai.state.handler = async () => { await wait(400); return '{"propositions":[],"alertes":[]}'; };
    const a = (await ask('dupont')).body; const b = (await ask('dupont')).body;
    expect((await as(t.durand).del(`${base()}/ia/taches/${b.id}`)).status).toBe(403);
    const c = await as(t.dupont).del(`${base()}/ia/taches/${b.id}`);
    expect(c.body.status).toBe('cancelled');
    await q().drain();
    expect((await job(a.id)).status).toBe('done');
    expect((await job(b.id)).status).toBe('cancelled');
    expect((await as(t.dupont).del(`${base()}/ia/taches/${b.id}`)).status).toBe(409);
  });

  it('nouvelle tentative avec temporisation en cas d\'échec, puis abandon au bout du nombre d\'essais', async () => {
    await setting('ai.tentatives', 2); await setting('ai.max_concurrent', 2);
    env.ai.state.handler = () => { throw new Error('boum'); };
    env.ai.state.failing = true;
    const a = (await ask('durand')).body;
    await q().tick(); await q().drain({ maxMs: 500 });
    const after1 = await job(a.id);
    expect(after1).toMatchObject({ status: 'queued', attempts: 1 });
    expect(new Date(after1.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20000); // temporisé
    await env.db.query('UPDATE ai_jobs SET next_attempt_at = now() WHERE id = $1', [a.id]);
    await q().drain({ maxMs: 500 });
    expect(await job(a.id)).toMatchObject({ status: 'error', attempts: 2, error: expect.stringMatching(/indisponible/) });
    env.ai.state.failing = false;
  });

  it('reprend une tâche « en cours » dont l\'exécutant a disparu', async () => {
    await setting('ai.tentatives', 3);
    env.ai.state.handler = () => '{"propositions":[],"alertes":[]}';
    const a = (await ask('leroy')).body;
    await env.db.query("UPDATE ai_jobs SET status = 'running', heartbeat_at = now() - interval '10 minutes', started_at = now() - interval '10 minutes' WHERE id = $1", [a.id]);
    await q().drain();
    expect((await job(a.id)).status).toBe('done');
  });

  it('liste mes tâches, l\'administrateur voit toutes celles de l\'organisme ; vue d\'ensemble des limites', async () => {
    const mine = (await as(t.dupont).get(`${base()}/ia/taches`)).body.items;
    expect(mine.every((j) => j.requestedBy === 'dupont')).toBe(true);
    const all = (await as(admin).get(`${base()}/ia/taches?scope=all`)).body.items;
    expect(new Set(all.map((j) => j.requestedBy)).size).toBeGreaterThan(1);
    const o = (await as(admin).get(`${base()}/ia/file`)).body;
    expect(o).toMatchObject({ limits: { max_concurrent: 2, tentatives: 3 }, defaults: { max_concurrent: 2, file_max: 50 } });
    expect((await as(t.dupont).get(`${base()}/ia/file`)).status).toBe(403);
  });

  it('les paramètres se règlent par organisme (surcharge de la plateforme)', async () => {
    await env.db.query("INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('organisme', $1, 'ai.max_concurrent', '4'::jsonb, 't')", [String(ville.id)]);
    expect((await q().limits(ville.id)).max_concurrent).toBe(4);
  });
});
