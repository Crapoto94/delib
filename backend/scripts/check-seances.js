const path = require('path');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

(async () => {
  const config = loadConfig();
  const db = createDb(config, createLogger('warn'));

  try {
    const dates = ['2026-10-03', '2026-10-08', '2026-11-04'];
    const rows = await db.all(`
      SELECT s.id, s.date_seance, i.nom as instance_nom,
             (SELECT count(*) FROM actes WHERE seance_id = s.id) as actes_count,
             (SELECT count(*) FROM actes WHERE seance_visee_id = s.id) as actes_visee_count
      FROM seances s
      JOIN instances i ON s.instance_id = i.id
      WHERE s.date_seance::date IN ($1, $2, $3)
    `, dates);

    if (rows.length === 0) {
      console.log('Aucune séance trouvée pour ces dates.');
    } else {
      console.table(rows);
    }
  } catch (e) {
    console.error('ERREUR :', e.message);
  } finally {
    await db.close();
  }
})();
