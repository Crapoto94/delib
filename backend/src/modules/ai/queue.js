/**
 * File d'attente des interrogations de l'IA (D52). Aucun appel n'est fait dans la requête HTTP : on dépose une tâche,
 * un exécutant en arrière plan la traite, l'interface interroge son avancement. Pour ne pas surcharger l'IA :
 *  - `ai.max_concurrent`      requêtes simultanées au maximum sur tout le serveur (défaut 2) ;
 *  - `ai.max_par_utilisateur` tâches actives par utilisateur (défaut 1) — les files sont servies « à tour de rôle » ;
 *  - `ai.file_max`            longueur maximale de la file (défaut 50) → 429 quand elle est pleine ;
 *  - `ai.file_max_par_utilisateur` tâches en attente + en cours par utilisateur (défaut 3) ;
 *  - `ai.intervalle_ms`       délai minimal entre deux appels à l'IA (défaut 300) ;
 *  - `ai.timeout_s`          délai maximal d'un appel (défaut 120) ; `ai.tentatives` essais par tâche (défaut 2).
 * Les paramètres se règlent par plateforme puis par organisme (héritage habituel). La file est en base : elle survit à un
 * redémarrage, et une tâche « en cours » dont l'exécutant a disparu est reprise après 5 minutes sans signe de vie.
 */
const { E } = require('../../shared/errors');

const DEFAULTS = { max_concurrent: 2, max_par_utilisateur: 1, file_max: 50, file_max_par_utilisateur: 3, intervalle_ms: 300, timeout_s: 120, tentatives: 2 };
const STALE_MIN = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toJob = (r, extra = {}) => ({
  id: r.id, organismeId: r.organisme_id, acteId: r.acte_id, kind: r.kind, requestedBy: r.requested_by, status: r.status, progress: r.progress, total: r.total,
  stepLabel: r.step_label, attempts: r.attempts, error: r.error, result: r.result, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, ...extra,
});

function createAiQueue({ db, settings, access, bus, log }) {
  const handlers = new Map(); const running = new Map(); let timer = null; let lastCall = 0; let wake = false;

  const limits = async (orgId) => {
    const cfg = await settings.resolve(orgId);
    const out = {};
    for (const [k, d] of Object.entries(DEFAULTS)) { const v = Number(cfg[`ai.${k}`]?.value); out[k] = Number.isFinite(v) && v >= 0 ? v : d; }
    out.max_concurrent = Math.max(1, out.max_concurrent); out.max_par_utilisateur = Math.max(1, out.max_par_utilisateur);
    return out;
  };

  const svc = {
    DEFAULTS, limits,
    register(kind, fn) { handlers.set(kind, fn); },

    /** Dépose une tâche ; refuse (429) si la file ou le quota de l'utilisateur est plein. */
    async enqueue(ctx, { organismeId, acteId = null, kind, payload = {}, priority = 0 }) {
      if (!handlers.has(kind)) throw E.badRequest(`Type de tâche IA inconnu : ${kind}`);
      const lim = await limits(organismeId);
      const queued = (await db.get("SELECT count(*)::int AS n FROM ai_jobs WHERE status = 'queued'")).n;
      if (queued >= lim.file_max) throw E.tooMany("La file d'attente de l'IA est pleine : réessayez dans quelques minutes");
      const mine = (await db.get("SELECT count(*)::int AS n FROM ai_jobs WHERE requested_by = $1 AND status IN ('queued', 'running')", [ctx.username])).n;
      if (mine >= lim.file_max_par_utilisateur) throw E.tooMany(`Vous avez déjà ${mine} demandes IA en cours ou en attente (maximum ${lim.file_max_par_utilisateur}) : attendez qu'elles se terminent`);
      const r = await db.get('INSERT INTO ai_jobs (organisme_id, acte_id, kind, requested_by, payload, priority) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *', [organismeId, acteId, kind, ctx.username, JSON.stringify(payload), priority]);
      wake = true;
      return svc.status(r.id);
    },

    async status(id) {
      const r = await db.get('SELECT * FROM ai_jobs WHERE id = $1', [id]);
      if (!r) return null;
      let position = null;
      if (r.status === 'queued') position = (await db.get("SELECT count(*)::int + 1 AS n FROM ai_jobs WHERE status = 'queued' AND id < $1", [id])).n;
      return toJob(r, { position });
    },

    async get(ctx, organismeId, id) {
      const j = await svc.status(id);
      if (!j || j.organismeId !== Number(organismeId)) throw E.notFound('Tâche introuvable');
      if (j.requestedBy !== ctx.username && !ctx.isPlatformAdmin && !access.rolesIn(ctx, organismeId).includes('org_admin')) throw E.forbidden();
      return j;
    },

    /** Mes tâches (récentes, actives d'abord) ; tout l'organisme pour l'administrateur. */
    async list(ctx, organismeId, { scope = 'mine', acteId } = {}) {
      const admin = ctx.isPlatformAdmin || access.rolesIn(ctx, organismeId).includes('org_admin');
      const p = [organismeId]; const w = ['organisme_id = $1'];
      if (scope !== 'all' || !admin) { p.push(ctx.username); w.push(`requested_by = $${p.length}`); }
      if (acteId) { p.push(acteId); w.push(`acte_id = $${p.length}`); }
      w.push("(status IN ('queued', 'running') OR finished_at > now() - interval '1 day')");
      const rows = await db.all(`SELECT * FROM ai_jobs WHERE ${w.join(' AND ')} ORDER BY (status IN ('queued','running')) DESC, id DESC LIMIT 100`, p);
      const out = [];
      for (const r of rows) out.push(toJob(r, { position: r.status === 'queued' ? (await db.get("SELECT count(*)::int + 1 AS n FROM ai_jobs WHERE status = 'queued' AND id < $1", [r.id])).n : null }));
      return out;
    },

    /** Vue d'ensemble pour l'administration : limites en vigueur, file, tâches en cours. */
    async overview(organismeId) {
      const lim = await limits(organismeId);
      const c = await db.get("SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'running')::int AS running, count(*) FILTER (WHERE status = 'error' AND finished_at > now() - interval '1 day')::int AS errors, count(*) FILTER (WHERE status = 'done' AND finished_at > now() - interval '1 day')::int AS done FROM ai_jobs");
      return { limits: lim, defaults: DEFAULTS, ...c };
    },

    async cancel(ctx, organismeId, id) {
      const j = await svc.get(ctx, organismeId, id);
      if (['done', 'error', 'cancelled'].includes(j.status)) throw E.conflict(`Tâche déjà ${j.status === 'done' ? 'terminée' : j.status === 'error' ? 'en erreur' : 'annulée'}`);
      if (j.status === 'queued') await db.run("UPDATE ai_jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'queued'", [id]);
      else await db.run('UPDATE ai_jobs SET cancel_requested = true WHERE id = $1', [id]);
      return svc.status(id);
    },

    /** Prochaine tâche exécutable : respecte le plafond global, le plafond par utilisateur et l'équité entre utilisateurs. */
    async claim() {
      return db.tx(async (q) => {
        const candidates = await q.all(
          `SELECT j.* FROM ai_jobs j WHERE j.status = 'queued' AND j.next_attempt_at <= now()
           ORDER BY (SELECT count(*) FROM ai_jobs r WHERE r.requested_by = j.requested_by AND r.status = 'running'),
                    (SELECT max(r.started_at) FROM ai_jobs r WHERE r.requested_by = j.requested_by) NULLS FIRST, j.priority DESC, j.id
           FOR UPDATE OF j SKIP LOCKED LIMIT 10`);
        if (!candidates.length) return null;
        const active = (await q.get(`SELECT count(*)::int AS n FROM ai_jobs WHERE status = 'running' AND heartbeat_at > now() - interval '${STALE_MIN} minutes'`)).n;
        for (const j of candidates) {
          const lim = await limits(j.organisme_id);
          if (active >= lim.max_concurrent) return null;
          const mine = (await q.get("SELECT count(*)::int AS n FROM ai_jobs WHERE requested_by = $1 AND status = 'running'", [j.requested_by])).n;
          if (mine >= lim.max_par_utilisateur) continue;
          return q.get("UPDATE ai_jobs SET status = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, now()), heartbeat_at = now(), step_label = 'Démarrage' WHERE id = $1 RETURNING *", [j.id]);
        }
        return null;
      });
    },

    async run(job) {
      const lim = await limits(job.organisme_id);
      const handler = handlers.get(job.kind);
      const helpers = {
        /** Appel à l'IA : espacé (intervalle minimal entre deux appels) et borné dans le temps. */
        query: async (fn) => {
          const wait = lastCall + lim.intervalle_ms - Date.now(); lastCall = Math.max(Date.now(), lastCall + lim.intervalle_ms);
          if (wait > 0) await sleep(wait);
          let t; const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(E.upstream(`L'IA n'a pas répondu en ${lim.timeout_s} s`)), lim.timeout_s * 1000); });
          try { return await Promise.race([fn(), timeout]); } finally { clearTimeout(t); }
        },
        progress: async (n, total, label) => { await db.run('UPDATE ai_jobs SET progress = $2, total = $3, step_label = $4, heartbeat_at = now() WHERE id = $1', [job.id, n, total, label || null]); },
        cancelled: async () => !!(await db.get('SELECT cancel_requested AS c FROM ai_jobs WHERE id = $1', [job.id]))?.c,
      };
      try {
        const ctx = await access.loadContext(job.requested_by);
        const result = await handler(job, ctx, helpers);
        if (await helpers.cancelled()) { await db.run("UPDATE ai_jobs SET status = 'cancelled', finished_at = now(), result = $2::jsonb WHERE id = $1", [job.id, JSON.stringify(result ?? {})]); return; }
        await db.run("UPDATE ai_jobs SET status = 'done', progress = total, step_label = 'Terminé', finished_at = now(), result = $2::jsonb, error = NULL WHERE id = $1", [job.id, JSON.stringify(result ?? {})]);
        await bus.emit('ai.done', { organismeId: job.organisme_id, acteId: job.acte_id, jobId: job.id, requestedBy: job.requested_by, kind: job.kind });
      } catch (e) {
        const retry = job.attempts < lim.tentatives && e.status !== 400 && e.status !== 403 && e.status !== 404;
        if (retry) {
          const wait = Math.min(30 * 2 ** (job.attempts - 1), 300);
          await db.run("UPDATE ai_jobs SET status = 'queued', step_label = 'Nouvelle tentative', error = $2, next_attempt_at = now() + ($3 || ' seconds')::interval WHERE id = $1", [job.id, e.message, String(wait)]);
          log.warn({ job: job.id, err: e.message }, 'tâche IA en échec : nouvelle tentative programmée');
        } else {
          await db.run("UPDATE ai_jobs SET status = 'error', error = $2, finished_at = now() WHERE id = $1", [job.id, e.message]);
          await bus.emit('ai.failed', { organismeId: job.organisme_id, acteId: job.acte_id, jobId: job.id, requestedBy: job.requested_by, kind: job.kind, error: e.message });
        }
      }
    },

    /** Un tour : reprend les tâches orphelines, puis lance tout ce que les plafonds autorisent (sans attendre la fin). */
    async tick() {
      await db.run(`UPDATE ai_jobs SET status = 'queued', step_label = 'Reprise après interruption', next_attempt_at = now() WHERE status = 'running' AND heartbeat_at < now() - interval '${STALE_MIN} minutes'`);
      for (let i = 0; i < 20; i++) {
        const job = await svc.claim();
        if (!job) break;
        const p = svc.run(job).catch((e) => log.error({ err: e.message, job: job.id }, 'exécutant IA en erreur')).finally(() => { running.delete(job.id); wake = true; });
        running.set(job.id, p);
      }
    },

    /** Tests et arrêt propre : traite tout jusqu'à file vide et fin des tâches en cours. */
    async drain({ maxMs = 20000 } = {}) {
      const end = Date.now() + maxMs;
      for (;;) {
        await svc.tick();
        await Promise.allSettled([...running.values()]);
        const left = (await db.get("SELECT count(*)::int AS n FROM ai_jobs WHERE status IN ('queued','running') AND next_attempt_at <= now() + interval '1 second'")).n;
        if (!left || Date.now() > end) return;
        await sleep(20);
      }
    },

    start(everyMs = 1000) {
      if (timer) return;
      timer = setInterval(() => { svc.tick().catch((e) => log.error({ err: e.message }, 'file IA en erreur')); }, everyMs);
      timer.unref(); log.info({ everyMs }, 'exécutant de la file IA démarré');
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    get pending() { return wake; },
  };
  return svc;
}

module.exports = { createAiQueue, DEFAULTS };
