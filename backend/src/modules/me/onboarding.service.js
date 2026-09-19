const { E } = require('../../shared/errors');
const { TOURS, tourById } = require('./tours');

/**
 * État d'avancement des tutoriels par utilisateur. Un tutoriel est à proposer si :
 *  - il n'a jamais été commencé, ou
 *  - une version plus récente existe (nouveautés), ou
 *  - il est commencé mais pas terminé (reprise).
 * « terminé » et « ignoré » à la version courante ne sont plus proposés (jamais obligatoire, rejouable sur demande).
 */
function createOnboarding(db) {
  const toState = (t, row) => ({
    id: t.id, label: t.label, currentVersion: t.version,
    status: row?.status || 'new', version: row?.tour_version || null, stepsDone: row?.steps_done || [],
    startedAt: row?.started_at || null, completedAt: row?.completed_at || null, skippedAt: row?.skipped_at || null,
    toShow: !row || row.tour_version < t.version || row.status === 'started',
  });

  async function list(username) {
    const rows = await db.all('SELECT * FROM user_onboarding WHERE username = $1', [username]);
    return TOURS.map((t) => toState(t, rows.find((r) => r.tour_id === t.id)));
  }

  return {
    list,
    async toShow(username) { return (await list(username)).filter((t) => t.toShow).map((t) => ({ id: t.id, version: t.currentVersion, status: t.status })); },

    async update(username, tourId, { version, status, stepsDone }) {
      const tour = tourById(tourId);
      if (!tour) throw E.notFound('Tutoriel inconnu');
      if (version > tour.version) throw E.badRequest(`Version inconnue (courante : ${tour.version})`);
      await db.run(
        `INSERT INTO user_onboarding (username, tour_id, tour_version, status, steps_done, completed_at, skipped_at)
         VALUES ($1,$2,$3,$4,$5::jsonb, CASE WHEN $4 = 'completed' THEN now() END, CASE WHEN $4 = 'skipped' THEN now() END)
         ON CONFLICT (username, tour_id) DO UPDATE SET
           tour_version = EXCLUDED.tour_version, status = EXCLUDED.status,
           steps_done   = CASE WHEN $6 THEN EXCLUDED.steps_done ELSE user_onboarding.steps_done END,
           completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN now() ELSE NULL END,
           skipped_at   = CASE WHEN EXCLUDED.status = 'skipped' THEN now() ELSE NULL END,
           started_at   = CASE WHEN user_onboarding.tour_version <> EXCLUDED.tour_version THEN now() ELSE user_onboarding.started_at END`,
        [username, tourId, version, status, JSON.stringify(stepsDone || []), stepsDone !== undefined]);
      return (await list(username)).find((t) => t.id === tourId);
    },
  };
}

module.exports = { createOnboarding };
