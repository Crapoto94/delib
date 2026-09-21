const { createTestEnv, loginAs, bearer } = require('../helpers');

let env;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.close(); });

const login = (u, p) => env.http().post('/api/v1/auth/login').send({ username: u, password: p });

describe('connexion des agents (AD via APM)', () => {
  it("accepte l'identifiant quelle que soit la casse", async () => {
    for (const name of ['dupont', 'DUPONT', 'Dupont', '  dUpOnT ']) {
      const r = await login(name, 'pw-dupont');
      expect(r.status, name).toBe(200);
      expect(r.body.username).toBe('dupont');
      expect(r.body.token).toBeTruthy();
    }
  });

  it("accepte l'adresse e-mail complète en plus de l'identifiant", async () => {
    for (const mail of ['alice.dupont@ivry.test', 'ALICE.DUPONT@IVRY.TEST', '  alice.dupont@ivry.test ']) {
      const r = await login(mail, 'pw-dupont');
      expect(r.status, mail).toBe(200);
      expect(r.body.username).toBe('dupont');
      expect(r.body.token).toBeTruthy();
    }
  });

  it("refuse un mauvais mot de passe sans dire si le compte existe", async () => {
    const a = await login('dupont', 'faux');
    const b = await login('inconnu', 'faux');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
    expect(a.body.code).toBe('UNAUTHORIZED');
  });

  it('valide la forme de la requête', async () => {
    const r = await env.http().post('/api/v1/auth/login').send({ username: '' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BAD_REQUEST');
    expect(r.body.details.length).toBeGreaterThan(0);
  });

  it("distingue une panne de l'AD (502) d'un mot de passe faux, sans compter d'échec", async () => {
    const e2 = await createTestEnv();
    try {
      e2.ad.state.failing = true;
      for (let i = 0; i < 8; i++) expect((await e2.http().post('/api/v1/auth/login').send({ username: 'dupont', password: 'pw-dupont' })).status).toBe(502);
      e2.ad.state.failing = false;
      expect((await e2.http().post('/api/v1/auth/login').send({ username: 'dupont', password: 'pw-dupont' })).status).toBe(200);
    } finally { await e2.close(); }
  });

  it('verrouille le compte après 5 échecs, même avec le bon mot de passe ensuite', async () => {
    const e2 = await createTestEnv();
    try {
      for (let i = 0; i < 5; i++) await e2.http().post('/api/v1/auth/login').send({ username: 'martin', password: 'faux' });
      const r = await e2.http().post('/api/v1/auth/login').send({ username: 'martin', password: 'pw-martin' });
      expect(r.status).toBe(429);
      expect(r.body.code).toBe('LOCKED');
      expect((await e2.http().post('/api/v1/auth/login').send({ username: 'dupont', password: 'pw-dupont' })).status).toBe(200);
    } finally { await e2.close(); }
  });

  it('crée la fiche agent avec direction résolue (libellé -> code) et journalise la connexion', async () => {
    await login('dupont', 'pw-dupont');
    const a = await env.db.get("SELECT * FROM agent_ref WHERE username = 'dupont'");
    expect(a.direction_code).toBe('A1');
    expect(a.first_login_at).not.toBeNull();
    expect(a.poste).toBe('Chargée de budget');
    expect((await env.db.get("SELECT count(*)::int AS n FROM audit_log WHERE action = 'auth.login' AND actor = 'dupont'")).n).toBeGreaterThan(0);
  });

  it('résout la direction malgré la casse et les accents du libellé', async () => {
    await login('martin', 'pw-martin'); // libellé « Direction CCAS » dans la fiche, « DIRECTION CCAS » dans l'organigramme
    expect((await env.db.get("SELECT direction_code FROM agent_ref WHERE username = 'martin'")).direction_code).toBe('J');
  });

  it("se connecte même si l'annuaire RH est indisponible", async () => {
    const e2 = await createTestEnv();
    try {
      e2.directoryAdapter.state.failing = true;
      const r = await e2.http().post('/api/v1/auth/login').send({ username: 'nouveau', password: 'pw-nouveau' });
      expect(r.status).toBe(200);
      expect((await e2.db.get("SELECT direction_code FROM agent_ref WHERE username = 'nouveau'")).direction_code).toBeNull();
    } finally { await e2.close(); }
  });
});

describe('sessions et jetons', () => {
  it('rejette un jeton absent, invalide ou falsifié', async () => {
    expect((await env.http().get('/api/v1/me')).status).toBe(401);
    expect((await env.http().get('/api/v1/me').set(bearer('n.importe.quoi'))).status).toBe(401);
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    const forged = t.slice(0, -3) + 'AAA';
    expect((await env.http().get('/api/v1/me').set(bearer(forged))).status).toBe(401);
  });

  it('la déconnexion révoque le jeton', async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    expect((await env.http().get('/api/v1/me').set(bearer(t))).status).toBe(200);
    expect((await env.http().post('/api/v1/auth/logout').set(bearer(t))).status).toBe(204);
    const r = await env.http().get('/api/v1/me').set(bearer(t));
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/révoquée|expirée/);
  });

  it('une session expirée en base est refusée', async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    await env.db.run("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE username = 'dupont'");
    expect((await env.http().get('/api/v1/me').set(bearer(t))).status).toBe(401);
  });

  it('le renouvellement émet un nouveau jeton et révoque le précédent', async () => {
    const t = await loginAs(env, 'martin', 'pw-martin');
    const r = await env.http().post('/api/v1/auth/refresh').set(bearer(t));
    expect(r.status).toBe(200);
    expect(r.body.token).not.toBe(t);
    expect((await env.http().get('/api/v1/me').set(bearer(t))).status).toBe(401);
    expect((await env.http().get('/api/v1/me').set(bearer(r.body.token))).status).toBe(200);
  });

  it('le renouvellement est plafonné par la durée maximale de session', async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    await env.db.run("UPDATE sessions SET started_at = now() - interval '25 hours' WHERE username = 'dupont'");
    const r = await env.http().post('/api/v1/auth/refresh').set(bearer(t));
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Durée maximale/);
  });

  it("le jeton expire (exp) et ne contient ni rôle ni mot de passe", async () => {
    const t = await loginAs(env, 'dupont', 'pw-dupont');
    const claims = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    expect(claims.exp).toBeGreaterThan(claims.iat);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'jti', 'kind', 'sub']);
  });
});

describe('administrateurs et compte de secours', () => {
  it('les administrateurs amorcés (BOOTSTRAP_ADMINS) deviennent administrateurs de plateforme à la connexion', async () => {
    const t = await loginAs(env, 'boot', 'pw-boot');
    const me = await env.http().get('/api/v1/me').set(bearer(t));
    expect(me.body.isPlatformAdmin).toBe(true);
    expect((await env.http().get('/api/v1/me').set(bearer(await loginAs(env, 'dupont', 'pw-dupont')))).body.isPlatformAdmin).toBe(false);
  });

  it("le compte de secours se connecte quand l'AD est indisponible", async () => {
    const e2 = await createTestEnv();
    try {
      e2.ad.state.failing = true;
      const r = await e2.http().post('/api/v1/auth/login-local').send({ username: 'Secours', password: 'mot-de-passe-de-secours-123' });
      expect(r.status).toBe(200);
      const me = await e2.http().get('/api/v1/me').set(bearer(r.body.token));
      expect(me.body).toMatchObject({ username: 'secours', kind: 'local', isPlatformAdmin: true });
    } finally { await e2.close(); }
  });

  it("le compte de secours accepte l'adresse e-mail complète", async () => {
    const r = await env.http().post('/api/v1/auth/login-local').send({ username: 'secours@ivry94.fr', password: 'mot-de-passe-de-secours-123' });
    expect(r.status).toBe(200);
    expect(r.body.username).toBe('secours');
  });

  it("le mot de passe de secours est haché, jamais stocké en clair, et chaque usage est audité", async () => {
    await env.http().post('/api/v1/auth/login-local').send({ username: 'secours', password: 'mot-de-passe-de-secours-123' });
    const acc = await env.db.get("SELECT * FROM local_accounts WHERE username = 'secours'");
    expect(acc.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(acc.password_hash).not.toContain('mot-de-passe');
    expect((await env.db.get("SELECT count(*)::int AS n FROM audit_log WHERE action = 'auth.local_login'")).n).toBeGreaterThan(0);
  });

  it('refuse un mauvais mot de passe de secours et respecte le verrouillage', async () => {
    const e2 = await createTestEnv();
    try {
      for (let i = 0; i < 5; i++) expect((await e2.http().post('/api/v1/auth/login-local').send({ username: 'secours', password: 'faux' })).status).toBe(401);
      expect((await e2.http().post('/api/v1/auth/login-local').send({ username: 'secours', password: 'mot-de-passe-de-secours-123' })).status).toBe(429);
    } finally { await e2.close(); }
  });

  it('est créé une seule fois et ne relit plus le mot de passe de l\'environnement', async () => {
    expect(await env.c.auth.ensureLocalAdmin()).toBe(false);
  });

  it('est inutilisable quand il est désactivé', async () => {
    const e2 = await createTestEnv({ env: { LOCAL_ADMIN_ENABLED: 'false' } });
    try {
      expect((await e2.http().post('/api/v1/auth/login-local').send({ username: 'secours', password: 'mot-de-passe-de-secours-123' })).status).toBe(401);
    } finally { await e2.close(); }
  });
});

describe('« Se souvenir de moi » : session persistante de 6 mois au plus (D109)', () => {
  const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
  const jours = (t) => Math.round((claims(t).exp - claims(t).iat) / 86400);

  it('sans la case, la durée reste courte ; avec la case, le jeton vaut 6 mois et la session est persistante', async () => {
    const court = await login('dupont', 'pw-dupont');
    expect(court.body.souvenir).toBe(false); expect(jours(court.body.token)).toBe(0);
    const long = await env.http().post('/api/v1/auth/login').send({ username: 'dupont', password: 'pw-dupont', souvenir: true });
    expect(long.status).toBe(200); expect(long.body.souvenir).toBe(true);
    expect(jours(long.body.token)).toBe(182);                                                        // 6 mois au plus (SESSION_SOUVENIR_DAYS)
    expect(new Date(long.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(180 * 86400000);
    expect((await env.http().get('/api/v1/me').set(bearer(long.body.token))).status).toBe(200);
    const s = await env.db.get('SELECT persistante FROM sessions WHERE jti = $1', [long.body.jti]);
    expect(s.persistante).toBe(true);
    const a = await env.db.get("SELECT after FROM audit_log WHERE action = 'auth.login' AND entity_id = $1", [long.body.jti]);
    expect(a.after).toMatchObject({ souvenir: true });
  });

  it('la déconnexion met fin à la session persistante ; le renouvellement la garde persistante, sans dépasser 6 mois', async () => {
    const r = await env.http().post('/api/v1/auth/login').send({ username: 'martin', password: 'pw-martin', souvenir: true });
    const t = r.body.token;
    const ren = await env.http().post('/api/v1/auth/refresh').set(bearer(t));
    expect(ren.status).toBe(200); expect(ren.body.souvenir).toBe(true); expect(jours(ren.body.token)).toBe(182);
    expect((await env.http().get('/api/v1/me').set(bearer(t))).status).toBe(401);                    // l'ancien est révoqué
    expect((await env.http().post('/api/v1/auth/logout').set(bearer(ren.body.token))).status).toBe(204);
    expect((await env.http().get('/api/v1/me').set(bearer(ren.body.token))).status).toBe(401);       // « ou à la déco »
    // au-delà de 6 mois depuis la connexion initiale : il faut se reconnecter
    const r2 = await env.http().post('/api/v1/auth/login').send({ username: 'leroy', password: 'pw-leroy', souvenir: true });
    await env.db.run("UPDATE sessions SET started_at = now() - interval '183 days' WHERE jti = $1", [r2.body.jti]);
    expect((await env.http().post('/api/v1/auth/refresh').set(bearer(r2.body.token))).status).toBe(401);
  });
});
