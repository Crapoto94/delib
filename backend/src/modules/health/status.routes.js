const pkg = require('../../../package.json');

/**
 * GET /api/status : état de l'application et de ses dépendances (guide §6).
 * Aucune donnée sensible : ni configuration, ni identité, ni détail d'infrastructure.
 * 503 seulement si la base est indisponible ; APM et Hub en panne = « degraded » (la connexion de secours reste possible).
 */
module.exports = ({ makeRouter, db, ad, directoryAdapter }) => {
  const r = makeRouter('/api');
  const startedAt = Date.now();

  const probe = async (fn) => {
    try { return { ok: true, ms: await fn() }; } catch (e) { return { ok: false, error: String(e.message).slice(0, 120) }; }
  };

  r.get('/status', {
    summary: "État de l'application et de ses dépendances", tags: ['supervision'], auth: false,
    description: 'Base de données, API centrale APM, Hub DSI, version et migrations appliquées. 503 si la base est indisponible, `degraded` si APM ou Hub le sont.',
  }, async (req, res) => {
    const [database, apm, hub] = await Promise.all([probe(() => db.ping()), probe(() => ad.ping()), probe(() => directoryAdapter.ping())]);
    let migrations = null;
    if (database.ok) migrations = (await db.get('SELECT count(*)::int AS n FROM schema_migrations').catch(() => ({ n: null }))).n;
    const status = !database.ok ? 'down' : (apm.ok && hub.ok ? 'ok' : 'degraded');
    res.status(database.ok ? 200 : 503).json({
      status, version: pkg.version, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), time: new Date().toISOString(),
      dependencies: { database: { ...database, migrations }, apm, hub },
    });
  });

  return [r];
};
