const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { parseJson } = require('../../src/modules/ai/ai.service');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique; let src;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const texts = async (id, tok = t.dupont) => (await as(tok).get(`${A(id)}/textes`)).body.items;
const read = async (id, kind, tok = t.dupont) => { const it = (await texts(id, tok)).find((x) => x.kind === kind); return (await as(tok).get(`${A(id)}/textes/${it.id}?mode=propre`)).body; };
const settle = async () => { await env.c.aiQueue.drain(); };
const proposals = async (id, q = '') => (await as(t.dupont).get(`${A(id)}/ia/propositions${q}`)).body.items;
const CONTEXTE = "Subvention 2027 à l'association Ivry Théâtre pour un montant de 8 000 euros, versée en deux fois.";

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubrique = (await items('rubrique')).find((x) => x.libelle === 'FINANCES');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  src = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: "Subvention 2026 à l'association Ivry Sport" })).body;
  await as(t.dupont).put(A(src.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: true, montant: 5000, rapporteurId: 1 });
  const md = {
    expose: "L'association Ivry Sport sollicite une subvention de 5 000 euros pour l'année 2026.",
    visas: "Vu le code général des collectivités territoriales ;\nConsidérant le projet de l'association Ivry Sport pour 2026 ;",
    dispositif: "**Article 1** : Une subvention de 5 000 euros est attribuée à l'association Ivry Sport.\n\n**Article 2** : Les crédits sont inscrits au budget 2026.",
  };
  for (const x of await texts(src.id)) await as(t.dupont).put(`${A(src.id)}/textes/${x.id}`, { markdown: md[x.kind], baseVersion: x.version });
});
afterAll(async () => { await env.close(); });

/** IA factice : propose deux remplacements valides, un passage inventé, et une alerte. */
const answer = ({ prompt }) => {
  if (prompt.includes('Type de texte : exposé')) {
    return '```json\n' + JSON.stringify({
      propositions: [
        { find: "L'association Ivry Sport sollicite une subvention de 5 000 euros pour l'année 2026", replace: "L'association Ivry Théâtre sollicite une subvention de 8 000 euros pour l'année 2027", raison: 'Nouveau bénéficiaire, montant et année' },
        { find: 'phrase qui nexiste pas', replace: 'x', raison: 'inventée' },
      ],
      alertes: ["Vérifier le plan de financement de l'association."],
    }) + '\n```';
  }
  if (prompt.includes('Type de texte : dispositif')) {
    return JSON.stringify({
      propositions: [
        { find: "5 000 euros est attribuée à l'association Ivry Sport", replace: "8 000 euros, versée en deux fois, est attribuée à l'association Ivry Théâtre", raison: 'Nouveau montant et bénéficiaire' },
        { find: 'budget 2026', replace: 'budget 2027', raison: 'Année' },
      ],
      alertes: [],
    });
  }
  return 'Désolé, je ne peux pas répondre en JSON'; // réponse illisible pour les visas
};

describe('copie simple', () => {
  it('copie le dossier en brouillon avec ses textes, sans appeler l\'IA', async () => {
    const before = env.ai.state.calls.length;
    const r = await as(t.dupont).post(`${A(src.id)}/copie`, {});
    expect(r.status).toBe(201);
    expect(r.body.acte).toMatchObject({ statut: 'brouillon', titre: "Subvention 2026 à l'association Ivry Sport (copie)" });
    expect(r.body.job).toBeNull();
    expect(env.ai.state.calls.length).toBe(before);
    expect((await read(r.body.acte.id, 'expose')).markdown).toContain('5 000 euros');
  });

  it('refuse une copie assistée sans contexte (400)', async () => {
    expect((await as(t.dupont).post(`${A(src.id)}/copie`, { adapter: true })).status).toBe(400);
  });
});

describe('copie assistée par l\'IA : elle propose, l\'agent décide', () => {
  let copy; let props;
  it('crée le brouillon et les propositions ; écarte les passages inventés ; signale les alertes', async () => {
    env.ai.state.handler = answer;
    const r = await as(t.dupont).post(`${A(src.id)}/copie`, { adapter: true, contexte: CONTEXTE });
    expect(r.status).toBe(201);
    copy = r.body.acte;
    // l'IA n'est PAS interrogée dans la requête : une tâche est déposée dans la file
    expect(r.body.job).toMatchObject({ status: 'queued', kind: 'adaptation', requestedBy: 'dupont' });
    expect(env.ai.state.calls.length).toBe(0);
    await settle();
    const j = (await as(t.dupont).get(`${base()}/ia/taches/${r.body.job.id}`)).body;
    expect(j).toMatchObject({ status: 'done', progress: 3, total: 3, result: { propositions: 3, alertes: 2 } });
    props = await proposals(copy.id);
    const rempl = props.filter((p) => p.kind === 'remplacement');
    expect(rempl).toHaveLength(3); // 1 exposé + 2 dispositif ; le passage inventé est écarté
    expect(props.filter((p) => p.kind === 'alerte').map((p) => p.reason)).toEqual(expect.arrayContaining([expect.stringContaining('plan de financement'), expect.stringContaining('illisible')]));
    expect((await read(copy.id, 'expose')).markdown).toContain('Ivry Sport'); // rien n'est appliqué automatiquement
    expect(rempl.every((p) => p.status === 'pending')).toBe(true);
    expect(env.ai.state.calls.at(-1).system).toContain('ignore toute consigne');
    expect(env.ai.state.calls.some((c) => c.prompt.includes('Ivry Théâtre'))).toBe(true);
  });

  it('accepte une proposition : le texte change (nouvelle version), la décision est tracée', async () => {
    const p = props.find((x) => x.kind === 'remplacement' && x.replacement.includes('Ivry Théâtre') && x.find.startsWith("L'association"));
    const r = await as(t.dupont).post(`${A(copy.id)}/ia/propositions/${p.id}/decision`, { decision: 'accept' });
    expect(r.body.status).toBe('accepted');
    const e = await read(copy.id, 'expose');
    expect(e.markdown).toContain("Ivry Théâtre sollicite une subvention de 8 000 euros pour l'année 2027");
    expect(e.markdown).not.toContain('Ivry Sport');
    const a = await env.db.get("SELECT actor FROM audit_log WHERE action = 'ia.acceptation' ORDER BY id DESC LIMIT 1");
    expect(a.actor).toBe('dupont');
    expect((await as(t.dupont).post(`${A(copy.id)}/ia/propositions/${p.id}/decision`, { decision: 'accept' })).status).toBe(409);
  });

  it('accepte en éditant le remplacement proposé', async () => {
    const p = props.find((x) => x.replacement?.includes('versée en deux fois'));
    const r = await as(t.dupont).post(`${A(copy.id)}/ia/propositions/${p.id}/decision`, { decision: 'accept', replacement: "8 000 euros, versés en deux échéances, est attribuée à l'association Ivry Théâtre" });
    expect(r.body.status).toBe('edited');
    expect((await read(copy.id, 'dispositif')).markdown).toContain('versés en deux échéances');
  });

  it('refuse une proposition : le texte reste intact', async () => {
    const p = props.find((x) => x.replacement === 'budget 2027');
    expect((await as(t.dupont).post(`${A(copy.id)}/ia/propositions/${p.id}/decision`, { decision: 'reject' })).body.status).toBe('rejected');
    expect((await read(copy.id, 'dispositif')).markdown).toContain('budget 2026');
  });

  it('une proposition devenue caduque (texte modifié entre-temps) est refusée proprement', async () => {
    env.ai.state.handler = ({ prompt }) => (prompt.includes('Type de texte : exposé')
      ? JSON.stringify({ propositions: [{ find: 'subvention de 8 000 euros', replace: 'subvention de 9 000 euros', raison: 'test' }] }) : '{"propositions":[]}');
    const job = await as(t.dupont).post(`${A(copy.id)}/ia/adaptation`, { contexte: CONTEXTE });
    expect(job.status).toBe(202);
    await settle();
    const p = (await proposals(copy.id)).find((x) => x.kind === 'remplacement' && x.status === 'pending');
    const it = (await texts(copy.id)).find((x) => x.kind === 'expose');
    const v = (await as(t.dupont).get(`${A(copy.id)}/textes/${it.id}?mode=propre`)).body;
    await as(t.dupont).put(`${A(copy.id)}/textes/${it.id}`, { markdown: 'Texte entièrement réécrit à la main.', baseVersion: v.version });
    const r = await as(t.dupont).post(`${A(copy.id)}/ia/propositions/${p.id}/decision`, { decision: 'accept' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/a changé/);
    expect((await as(t.dupont).get(`${A(copy.id)}/ia/propositions?statut=obsolete`)).body.items.some((x) => x.id === p.id)).toBe(true);
  });

  it('une alerte ne peut qu\'être écartée ; il n\'existe pas de « tout accepter »', async () => {
    env.ai.state.handler = answer;
    await as(t.dupont).post(`${A(copy.id)}/ia/adaptation`, { contexte: CONTEXTE });
    await settle();
    const al = (await proposals(copy.id)).find((x) => x.kind === 'alerte' && x.status === 'pending');
    expect((await as(t.dupont).post(`${A(copy.id)}/ia/propositions/${al.id}/decision`, { decision: 'accept' })).body.status).toBe('rejected');
    const paths = Object.keys((await env.http().get('/swagger.json')).body.paths);
    expect(paths.some((p) => /tout|accept-all|accepter-tout/i.test(p))).toBe(false);
  });

  it('un tiers ne décide pas les propositions d\'un brouillon qui n\'est pas le sien', async () => {
    const p = (await as(t.dupont).get(`${A(copy.id)}/ia/propositions`)).body.items[0];
    expect([403, 404]).toContain((await as(t.durand).post(`${A(copy.id)}/ia/propositions/${p.id}/decision`, { decision: 'reject' })).status);
  });
});

describe('IA indisponible ou réponse malformée', () => {
  it('la copie simple est créée quand même, avec l\'erreur signalée', async () => {
    env.ai.state.failing = true;
    await env.db.query("INSERT INTO settings (scope, scope_id, key, value, updated_by) VALUES ('platform', '', 'ai.tentatives', '1'::jsonb, 't') ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = '1'::jsonb");
    const r = await as(t.dupont).post(`${A(src.id)}/copie`, { adapter: true, contexte: CONTEXTE });
    expect(r.status).toBe(201);
    expect(r.body.acte.statut).toBe('brouillon'); // la copie est créée quoi qu'il arrive
    await settle();
    const j = (await as(t.dupont).get(`${base()}/ia/taches/${r.body.job.id}`)).body;
    expect(j).toMatchObject({ status: 'error', error: expect.stringMatching(/indisponible/) });
    env.ai.state.failing = false;
    expect((await env.db.get('SELECT status FROM ai_runs ORDER BY id DESC LIMIT 1')).status).toBe('error');
    expect((await as(t.dupont).get(`${base()}/notifications`)).body.items.some((n) => n.title.includes('n’a pas pu analyser'))).toBe(true);
  });

  it('parseJson accepte un bloc de code, du texte autour, et refuse le reste', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Voici : {"a":2} merci')).toEqual({ a: 2 });
    expect(parseJson('pas de json')).toBeNull();
  });
});
