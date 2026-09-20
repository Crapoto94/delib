/**
 * Row-Level Security (défense supplémentaire de MOR-02). Les politiques ne s'appliquent qu'à un rôle qui n'est ni
 * propriétaire ni super-utilisateur : on crée donc un rôle jetable et on s'y place (SET LOCAL ROLE).
 */
const crypto = require('crypto');
const { createTestEnv } = require('../helpers');

let env; let role; let a; let b;
beforeAll(async () => {
  env = await createTestEnv();
  role = 'vibedelib_rls_' + crypto.randomBytes(3).toString('hex');
  await env.db.query(`CREATE ROLE ${role} NOLOGIN`);
  await env.db.query(`GRANT USAGE ON SCHEMA ${env.schema} TO ${role}`);
  await env.db.query(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ${env.schema} TO ${role}`);
  a = (await env.c.organismes.create({ username: 'x' }, { code: 'org-a', nom: 'A', type: 'commune' })).id;
  b = (await env.c.organismes.create({ username: 'x' }, { code: 'org-b', nom: 'B', type: 'ccas' })).id;
  await env.db.query("INSERT INTO user_org_roles (username, organisme_id, role) VALUES ('ua', $1, 'scc'), ('ub', $2, 'scc'), ('pa', NULL, 'platform_admin')", [a, b]);
  await env.db.query("INSERT INTO organisme_directions (organisme_id, direction_code) VALUES ($1, 'DA'), ($2, 'DB')", [a, b]);
});
afterAll(async () => {
  await env.db.query(`DROP OWNED BY ${role}`);
  await env.db.query(`DROP ROLE ${role}`);
  await env.close();
});

/** Exécute sql sous le rôle restreint avec les variables d'isolation données. */
async function asRole(settings, sql) {
  return env.db.tx(async (q) => {
    await q.query(`SET LOCAL ROLE ${role}`);
    if (settings.orgIds !== undefined) await q.query("SELECT set_config('app.organisme_ids', $1, true)", [settings.orgIds]);
    if (settings.bypass) await q.query("SELECT set_config('app.rls_bypass', 'on', true)");
    return q.all(sql);
  });
}

describe('politiques RLS (rôle non propriétaire)', () => {
  it("sans contexte, le rôle applicatif ne voit AUCUNE ligne d'organisme", async () => {
    expect(await asRole({}, 'SELECT * FROM user_org_roles')).toHaveLength(0);
    expect(await asRole({}, 'SELECT * FROM organisme_directions')).toHaveLength(0);
    expect(await asRole({}, 'SELECT * FROM audit_log')).toHaveLength(0);
  });

  it("avec app.organisme_ids = A, seules les lignes de A sont visibles", async () => {
    const roles = await asRole({ orgIds: String(a) }, 'SELECT username FROM user_org_roles ORDER BY 1');
    expect(roles.map((r) => r.username)).toEqual(['ua']);
    const dirs = await asRole({ orgIds: String(a) }, 'SELECT direction_code FROM organisme_directions');
    expect(dirs.map((r) => r.direction_code)).toEqual(['DA']);
  });

  it('une liste de deux organismes donne accès aux deux, pas à un troisième', async () => {
    const r = await asRole({ orgIds: `${a},${b}` }, 'SELECT username FROM user_org_roles ORDER BY 1');
    expect(r.map((x) => x.username)).toEqual(['ua', 'ub']);
    expect(await asRole({ orgIds: '99999' }, 'SELECT * FROM user_org_roles')).toHaveLength(0);
  });

  it("le contournement (administrateur de plateforme) voit tout, y compris les rôles sans organisme", async () => {
    const r = await asRole({ bypass: true }, 'SELECT username FROM user_org_roles ORDER BY 1');
    // le compte de secours (administrateur de plateforme, sans organisme) est amorcé par l'application
    expect(r.map((x) => x.username)).toEqual(['pa', 'secours', 'ua', 'ub']);
  });

  it("l'écriture dans un autre organisme est refusée par la politique", async () => {
    await expect(env.db.tx(async (q) => {
      await q.query(`SET LOCAL ROLE ${role}`);
      await q.query("SELECT set_config('app.organisme_ids', $1, true)", [String(a)]);
      await q.query("INSERT INTO user_org_roles (username, organisme_id, role) VALUES ('intrus', $1, 'scc')", [b]);
    })).rejects.toThrow(/row-level security/i);
  });
});

describe('RLS_ENABLED : withCtx renseigne les variables d\'isolation', () => {
  it("expose l'identifiant des organismes autorisés dans la transaction", async () => {
    const e2 = await createTestEnv({ env: { RLS_ENABLED: 'true' } });
    try {
      const v = await e2.db.withCtx({ orgIds: [1, 2] }, (q) => q.get("SELECT current_setting('app.organisme_ids') AS v, current_setting('app.rls_bypass', true) AS bypass"));
      expect(v.v).toBe('1,2');
      expect(v.bypass === null || v.bypass === '').toBe(true);
      const p = await e2.db.withCtx({ isPlatformAdmin: true }, (q) => q.get("SELECT current_setting('app.rls_bypass') AS bypass"));
      expect(p.bypass).toBe('on');
    } finally { await e2.close(); }
  });

  it("l'application fonctionne de bout en bout avec RLS_ENABLED=true", async () => {
    const e2 = await createTestEnv({ env: { RLS_ENABLED: 'true' } });
    try {
      const { loginAs, bearer } = require('../helpers');
      const t = await loginAs(e2, 'boot', 'pw-boot');
      expect((await e2.http().get('/api/v1/organismes').set(bearer(t))).status).toBe(200);
      const c = await e2.http().post('/api/v1/organismes').set(bearer(t)).send({ code: 'ccas', nom: 'CCAS', type: 'ccas' });
      expect(c.status).toBe(201);
      expect((await e2.http().get(`/api/v1/audit?organismeId=${c.body.id}`).set(bearer(t))).body.items.length).toBeGreaterThan(0);
    } finally { await e2.close(); }
  });
});
