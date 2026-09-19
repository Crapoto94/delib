/**
 * Exécuteur de migrations : fichiers SQL numérotés (0001_….sql), chacun dans sa transaction.
 *  - le schéma et la table schema_migrations sont créés au besoin ;
 *  - une migration déjà appliquée ne doit jamais changer (somme de contrôle vérifiée) ;
 *  - la numérotation doit être continue (0001, 0002…) : un trou fait échouer le démarrage.
 * Le marqueur __SCHEMA__ est remplacé par le nom du schéma configuré.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.resolve(__dirname, '../../migrations');
const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

function readMigrations(dir = DIR) {
  const files = fs.readdirSync(dir).filter((f) => FILE.test(f)).sort();
  const list = files.map((f) => {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    return { version: f.replace(/\.sql$/, ''), n: Number(FILE.exec(f)[1]), sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
  });
  list.forEach((m, i) => {
    if (m.n !== i + 1) throw new Error(`Numérotation des migrations discontinue : attendu ${String(i + 1).padStart(4, '0')}, trouvé ${m.version}`);
  });
  return list;
}

async function migrate(db, log, dir = DIR) {
  const schema = db.schema;
  const migrations = readMigrations(dir);
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await db.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await db.all(`SELECT version, checksum FROM ${schema}.schema_migrations`)).map((r) => [r.version, r.checksum]));

  for (const m of migrations) {
    if (applied.has(m.version)) {
      if (applied.get(m.version) !== m.checksum) throw new Error(`La migration ${m.version} a été modifiée après application`);
      continue;
    }
    await db.tx(async (q) => {
      await q.query(`SET LOCAL search_path TO ${schema}, public`);
      await q.query(m.sql.replace(/__SCHEMA__/g, schema));
      await q.query(`INSERT INTO ${schema}.schema_migrations (version, checksum) VALUES ($1, $2)`, [m.version, m.checksum]);
    });
    log.info({ migration: m.version }, 'migration appliquée');
  }
  return migrations.length;
}

module.exports = { migrate, readMigrations };
