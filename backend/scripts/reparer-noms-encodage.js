/**
 * Réparation des noms de fichiers déjà enregistrés en mojibake (UTF-8 relu en latin1) — séquelle d'un envoi multipart
 * antérieur au correctif du middleware `noms-fichiers`. À lancer une fois sur une base existante :
 *
 *   node scripts/reparer-noms-encodage.js            # simulation : montre ce qui serait corrigé, ne modifie rien
 *   node scripts/reparer-noms-encodage.js --appliquer # corrige réellement
 *
 * Le test de sûreté est celui du middleware : un nom n'est corrigé que si la relecture ne produit aucun caractère de
 * remplacement. Un nom déjà correct est donc laissé tel quel.
 */
const { loadConfig } = require('../src/config');
const { reparerNom } = require('../src/http/middleware/noms-fichiers');

const COLONNES = ['original_name', 'ged_nom'];

async function main() {
  const appliquer = process.argv.includes('--appliquer');
  const config = loadConfig();
  const { Pool } = require('pg');
  const pool = new Pool({
    host: config.db.host, port: config.db.port, database: config.db.database,
    user: config.db.user, password: config.db.password, max: 2,
    options: `-c search_path=${config.db.schema}`,
  });
  let total = 0;
  try {
    for (const colonne of COLONNES) {
      const { rows } = await pool.query(`SELECT id, ${colonne} AS nom FROM files WHERE ${colonne} IS NOT NULL`);
      for (const r of rows) {
        const corrige = reparerNom(r.nom);
        if (corrige === r.nom) continue;
        total += 1;
        console.log(`${colonne} #${r.id} : « ${r.nom} » → « ${corrige} »`);
        if (appliquer) await pool.query(`UPDATE files SET ${colonne} = $2 WHERE id = $1`, [r.id, corrige]);
      }
    }
    console.log(appliquer ? `${total} nom(s) corrigé(s).` : `${total} nom(s) à corriger (simulation : rien n'a été modifié).`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('ERREUR', e.message); process.exit(1); });
