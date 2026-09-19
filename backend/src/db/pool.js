/**
 * Accès PostgreSQL. Tout passe par des requêtes paramétrées ($1, $2…).
 * Le schéma de l'application est fixé au niveau de la connexion (search_path) et le fuseau est Europe/Paris.
 *
 * Isolation multi-organismes (MOR-02) :
 *  - les dépôts (repositories) exigent un contexte d'organisme (voir requireOrg) ;
 *  - avec RLS_ENABLED, withCtx() ouvre une transaction et renseigne app.organisme_ids / app.rls_bypass pour
 *    que les politiques Row-Level Security de la migration 0007 s'appliquent.
 */
const { Pool } = require('pg');
const { E } = require('../shared/errors');

function createDb(config, log) {
  const s = config.db.schema;
  const pool = new Pool({
    host: config.db.host, port: config.db.port, database: config.db.database,
    user: config.db.user, password: config.db.password,
    max: config.db.poolMax, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    options: `-c search_path=${s},public -c TimeZone=Europe/Paris`,
  });
  pool.on('error', (err) => log.error({ err: err.message }, 'erreur du pool PostgreSQL'));

  const wrap = (runner) => ({
    query: (sql, p = []) => runner.query(sql, p),
    all: (sql, p = []) => runner.query(sql, p).then((r) => r.rows),
    get: (sql, p = []) => runner.query(sql, p).then((r) => r.rows[0] || null),
    run: (sql, p = []) => runner.query(sql, p).then((r) => ({ changes: r.rowCount, rows: r.rows })),
  });

  const db = {
    ...wrap(pool),
    schema: s,
    pool,
    /** Transaction ; fn reçoit un exécuteur { query, all, get, run }. */
    async tx(fn, { orgIds, bypass = false } = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (orgIds) await client.query("SELECT set_config('app.organisme_ids', $1, true)", [orgIds.join(',')]);
        if (bypass) await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    /** Exécute fn dans le contexte d'isolation de ctx (transaction + variables RLS si RLS_ENABLED, sinon connexion simple). */
    async withCtx(ctx, fn) {
      if (!config.rlsEnabled) return fn(wrap(pool));
      const isPlatform = !!ctx.isPlatformAdmin;
      return db.tx(fn, { orgIds: isPlatform ? [] : ctx.orgIds || [], bypass: isPlatform });
    },
    async ping() {
      const t = Date.now();
      await pool.query('SELECT 1');
      return Date.now() - t;
    },
    close: () => pool.end(),
  };
  return db;
}

/** Garde-fou d'isolation : une requête portant sur une donnée d'organisme échoue si aucun organisme n'est précisé. */
function requireOrg(organismeId) {
  const id = Number(organismeId);
  if (!Number.isInteger(id) || id <= 0) throw E.badRequest("Contexte d'organisme manquant");
  return id;
}

module.exports = { createDb, requireOrg };
