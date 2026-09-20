/**
 * Planificateur (NOT-20) : un seul exécutant actif à la fois (verrou consultatif PostgreSQL, libéré en fin de transaction),
 * reprise naturelle après redémarrage (tout est dans la base : journal, file, exécutions de synthèse).
 * Un tick : relances temporelles de chaque organisme → synthèses (à partir de 7 h 30) → file d'envoi → alerte d'échecs.
 * Les tâches d'autres modules (jalons de séance, mise à disposition…) s'y accrochent avec `register(name, fn)`.
 */
const LOCK_KEY = 7420001; // arbitraire, propre à VibeDélib

function createScheduler({ db, notifications, config, log }) {
  let timer = null; let running = false;
  const extra = [];

  async function tick(now = new Date()) {
    if (running) return { skipped: 'already_running' };
    running = true;
    try {
      return await db.tx(async (q) => {
        const got = (await q.get('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_KEY])).ok;
        if (!got) return { skipped: 'locked_elsewhere' };
        const report = { relances: 0, syntheses: 0, envois: null, taches: {} };
        const orgs = await db.all('SELECT id FROM organismes WHERE actif');
        for (const { id } of orgs) {
          try {
            report.relances += (await notifications.runTemporal(id, { now })).filter((i) => i.status !== 'skipped').length;
            report.syntheses += (await notifications.sendDigests(id, { now })).sent;
            for (const t of extra) report.taches[t.name] = (report.taches[t.name] || 0) + ((await t.fn(id, now)) || 0);
            await notifications.checkFailureRate(id, now);
          } catch (e) { log.error({ err: e.message, organisme: id }, "tâche planifiée en erreur (l'organisme est ignoré pour ce tick)"); }
        }
        report.envois = await notifications.processQueue({ now });
        return report;
      });
    } finally { running = false; }
  }

  return {
    tick,
    register(name, fn) { extra.push({ name, fn }); },
    start(everyMs = 60000) {
      if (timer) return;
      timer = setInterval(() => tick().catch((e) => log.error({ err: e.message }, 'tick du planificateur en erreur')), everyMs);
      timer.unref();
      log.info({ everyMs }, 'planificateur démarré');
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    enabled: config.schedulerEnabled,
  };
}

module.exports = { createScheduler };
