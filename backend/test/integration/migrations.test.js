const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTestEnv } = require('../helpers');
const { migrate, readMigrations } = require('../../src/db/migrate');

let env;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.close(); });

describe('migrations', () => {
  it('appliquent toutes les migrations numérotées dans le schéma dédié', async () => {
    const rows = await env.db.all('SELECT version FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual(readMigrations().map((m) => m.version));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const tables = (await env.db.all("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [env.schema])).map((r) => r.table_name);
    for (const t of ['organismes', 'organisme_directions', 'agent_ref', 'user_org_roles', 'sessions', 'local_accounts', 'settings', 'audit_log', 'user_onboarding', 'ref_items', 'actes', 'annexes', 'titulaires', 'redaction_grants']) {
      expect(tables).toContain(t);
    }
  });

  it('sont rejouables sans effet', async () => {
    const total = readMigrations().length;
    await expect(migrate(env.db, { info() {} })).resolves.toBe(total);
    expect((await env.db.get('SELECT count(*)::int AS n FROM schema_migrations')).n).toBe(total);
  });

  it('refusent une migration modifiée après application', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE t_mig (id int);');
    const other = await createTestEnv();
    try {
      await migrate(other.db, { info() {} }, dir);
      fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE t_mig (id int, extra int);');
      await expect(migrate(other.db, { info() {} }, dir)).rejects.toThrow(/modifiée après application/);
    } finally { await other.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('refusent une numérotation discontinue', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '0001_a.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(dir, '0003_c.sql'), 'SELECT 1;');
    try { expect(() => readMigrations(dir)).toThrow(/discontinue/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("annulent toute la migration en cas d'erreur (transaction)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE t_ok (id int); SELECT * FROM table_inexistante;');
    const other = await createTestEnv();
    try {
      await expect(migrate(other.db, { info() {} }, dir)).rejects.toThrow();
      const t = await other.db.get("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = $1 AND table_name = 't_ok'", [other.schema]);
      expect(t).toBeNull();
    } finally { await other.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("journal d'audit immuable", () => {
  beforeAll(async () => {
    await env.c.audit.log({ username: 'x' }, { action: 'test.action', entity: 'test', entityId: '1' });
  });

  it('refuse UPDATE, DELETE et TRUNCATE', async () => {
    await expect(env.db.query("UPDATE audit_log SET actor = 'pirate'")).rejects.toThrow(/immuable/);
    await expect(env.db.query('DELETE FROM audit_log')).rejects.toThrow(/immuable/);
    await expect(env.db.query('TRUNCATE audit_log')).rejects.toThrow(/immuable/);
  });

  it('conserve les lignes écrites', async () => {
    expect((await env.db.get("SELECT count(*)::int AS n FROM audit_log WHERE action = 'test.action'")).n).toBe(1);
  });
});
