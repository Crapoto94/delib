const { createTestEnv, loginAs, bearer, adminToken, AGENTS, USERS } = require('../helpers');

let env; let admin; let ville; let t;
const H = (tok, actAs) => ({ ...bearer(tok), ...(actAs ? { 'X-Act-As': actAs } : {}) });
const get = (tok, u, actAs) => env.http().get(u).set(H(tok, actAs));
const post = (tok, u, b, actAs) => env.http().post(u).set(H(tok, actAs)).send(b);
const base = () => `/api/v1/organismes/${ville.id}`;

beforeAll(async () => {
  env = await createTestEnv({ agents: [...AGENTS, { username: '336', displayName: 'NOUVEL AGENT RH', email: 'nouvel.rh@ivry94.fr', service: 'BUDGET', direction: 'DIRECTION DES FINANCES', poste: 'Chargé de mission', matricule: '77' }] });
  admin = await adminToken(env);
  ville = (await get(admin, '/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const u of ['dupont', 'durand', 'leroy', 'martin', 'petit']) t[u] = await loginAs(env, u, USERS[u].password);
  await post(admin, `${base()}/roles`, { username: 'martin', role: 'scc' });
  await post(admin, `${base()}/roles`, { username: 'leroy', role: 'org_admin' });
});
afterAll(async () => { await env.close(); });

describe('« Afficher en tant que » (D47)', () => {
  it('l\'administrateur de plateforme a exactement les droits de l\'utilisateur choisi', async () => {
    const me = (await get(admin, '/api/v1/me', 'dupont')).body;
    expect(me).toMatchObject({ username: 'dupont', impersonation: { by: 'boot' }, isPlatformAdmin: false, canImpersonate: true });
    // droits de dupont : il ne peut pas administrer l'organisme…
    expect((await get(admin, `${base()}/roles`, 'dupont')).status).toBe(403);
    expect((await get(admin, `${base()}/roles`)).status).toBe(200); // …alors que l'administrateur, si.
    // …mais il peut rédiger un acte pour sa direction
    const types = (await get(admin, `${base()}/referentiels/type_acte`)).body.items;
    const r = await post(admin, `${base()}/actes`, { typeId: types[0].id, titre: 'Créé en tant que dupont' }, 'dupont');
    expect(r.status).toBe(201);
    expect(r.body.redacteur).toBe('dupont');
  });

  it('l\'audit conserve le VRAI acteur et l\'utilisateur au nom duquel il a agi', async () => {
    const a = await env.db.get("SELECT actor, on_behalf_of FROM audit_log WHERE action = 'acte.create' ORDER BY id DESC LIMIT 1");
    expect(a).toMatchObject({ actor: 'boot', on_behalf_of: 'dupont' });
  });

  it('démarrage et fin journalisés', async () => {
    const r = await post(admin, '/api/v1/auth/act-as', { username: 'durand' });
    expect(r.status).toBe(200);
    expect(r.body.displayName).toBe('Durand Claire');
    await env.http().delete('/api/v1/auth/act-as?username=durand').set(bearer(admin));
    const rows = await env.db.all("SELECT action FROM audit_log WHERE action IN ('auth.act_as', 'auth.act_as_end') ORDER BY id");
    expect(rows.map((x) => x.action)).toEqual(['auth.act_as', 'auth.act_as_end']);
  });

  it('un agent ordinaire ne peut pas s\'en servir', async () => {
    expect((await get(t.dupont, '/api/v1/me', 'durand')).status).toBe(403);
    expect((await post(t.dupont, '/api/v1/auth/act-as', { username: 'durand' })).status).toBe(403);
  });

  it('le SCC agit en tant qu\'agent ordinaire, jamais en tant qu\'administrateur ou que SCC', async () => {
    expect((await get(t.martin, '/api/v1/me', 'dupont')).body.username).toBe('dupont');
    expect((await get(t.martin, '/api/v1/me', 'leroy')).status).toBe(403); // org_admin
    expect((await get(t.martin, '/api/v1/me', 'boot')).status).toBe(403); // plateforme
  });

  it('l\'administrateur d\'organisme agit en tant que SCC ou agent, jamais en tant qu\'administrateur de plateforme', async () => {
    expect((await get(t.leroy, '/api/v1/me', 'martin')).body.username).toBe('martin');
    expect((await get(t.leroy, `${base()}/circuits`, 'martin')).status).toBe(200);
    expect((await get(t.leroy, '/api/v1/me', 'boot')).status).toBe(403);
  });

  it('refuse un utilisateur inconnu (404) ; l\'en-tête est ignoré sur les routes d\'authentification', async () => {
    expect((await get(admin, '/api/v1/me', 'personne.n.existe')).status).toBe(404);
    const r = await env.http().post('/api/v1/auth/refresh').set(H(admin, 'dupont'));
    expect(r.status).toBe(200);
    expect(r.body.username ?? 'boot').toBe('boot');
  });
});

describe('autocomplétion « @nom » des agents', () => {
  const ac = (tok, q) => get(tok, `/api/v1/directory/agents/autocompletion?q=${encodeURIComponent(q)}`);
  it('trouve par nom, prénom, identifiant ou e-mail, avec ou sans @', async () => {
    expect((await ac(t.dupont, 'alice')).body.items.map((a) => a.username)).toContain('dupont');
    expect((await ac(t.dupont, '@durand')).body.items[0]).toMatchObject({ username: 'durand', displayName: 'Durand Claire', knownLocally: true });
    expect((await ac(t.dupont, 'denis.leroy')).body.items.map((a) => a.username)).toContain('leroy');
  });

  it('propose aussi les agents de l\'annuaire RH jamais connectés, avec leur VRAI identifiant de connexion', async () => {
    const r = (await ac(t.dupont, 'nouvel.rh')).body.items;
    expect(r).toEqual([expect.objectContaining({ username: 'nouvel.rh', knownLocally: false, direction: 'DIRECTION DES FINANCES', poste: 'Chargé de mission' })]);
    expect(r.some((a) => a.username === '336')).toBe(false); // l'identifiant interne du Hub n'est pas un login
  });

  it('exige deux lettres et une authentification', async () => {
    expect((await ac(t.dupont, 'a')).status).toBe(400);
    expect((await env.http().get('/api/v1/directory/agents/autocompletion?q=alice')).status).toBe(401);
  });

  it('la recherche d\'utilisateurs (administration) utilise les mêmes identifiants', async () => {
    const rr = await get(await adminToken(env), `${base()}/utilisateurs?q=nouvel.rh`); expect(rr.status, JSON.stringify(rr.body)).toBe(200); const r = rr.body.items;
    expect(r.map((a) => a.username)).toContain('nouvel.rh');
  });
});

describe('liste des utilisateurs (administration)', () => {
  it('sans recherche : les agents connus, avec leurs rôles ; filtre « avec un rôle »', async () => {
    const tk = await adminToken(env);
    const all = (await get(tk, `${base()}/utilisateurs`)).body.items;
    expect(all.map((a) => a.username)).toEqual(expect.arrayContaining(['dupont', 'durand', 'leroy', 'martin']));
    expect(all.find((a) => a.username === 'martin').roles.map((r) => r.role)).toContain('scc');
    const withRole = (await get(tk, `${base()}/utilisateurs?avecRole=true`)).body.items;
    expect(withRole.map((a) => a.username)).toEqual(expect.arrayContaining(['martin', 'leroy']));
    expect(withRole.some((a) => a.username === 'dupont')).toBe(false);
  });
});
