/**
 * Restauration d'une sauvegarde (SAV-06) : recrée le schéma par les migrations, recharge les données dans un schéma CIBLE, réaligne les compteurs
 * d'identifiants et vérifie les nombres de lignes contre le manifeste. À essayer d'abord dans un schéma vide de test.
 * Nécessite un compte PostgreSQL pouvant désactiver les contraintes le temps du chargement (`session_replication_role`).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { createDb } = require('../../db/pool');
const { migrate } = require('../../db/migrate');

const LOT = 500;
const sha256Fichier = async (f) => { const h = crypto.createHash('sha256'); await pipeline(fs.createReadStream(f), h); return h.digest('hex'); };

/**
 * @param {object} o { config, log, dossier, schema, forcer }  — `schema` : schéma cible (doit être vide, sauf `forcer`)
 * @returns {{ tables: number, lignes: number, ecarts: string[] }}
 */
async function restaurer({ config, log, dossier, schema, forcer = false }) {
  const manifeste = JSON.parse(await fs.promises.readFile(path.join(dossier, 'manifest.json'), 'utf8'));
  if (manifeste.format !== 'vibedelib.sauvegarde/1') throw new Error('Format de sauvegarde inconnu');
  // 1. intégrité des fichiers
  for (const t of manifeste.tables) {
    const f = path.join(dossier, t.fichier);
    if ((await sha256Fichier(f)) !== t.sha256) throw new Error(`Fichier altéré ou incomplet : ${t.fichier}`);
  }
  // 2. schéma cible par les migrations
  const db = createDb({ ...config, db: { ...config.db, schema } }, log);
  try {
    await migrate(db, log);
    const ordre = (await db.all("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'", [schema])).map((r) => r.table_name);
    const cibles = manifeste.tables.filter((t) => ordre.includes(t.nom));
    if (!forcer) {
      for (const t of cibles) {
        if (t.nom === 'schema_migrations') continue;
        const n = (await db.get(`SELECT count(*)::int AS n FROM "${t.nom}"`)).n;
        if (n > 0) throw new Error(`Le schéma cible « ${schema} » n'est pas vide (${t.nom} : ${n} ligne(s)) : choisissez un schéma vide ou forcez`);
      }
    }
    // 3. chargement (contraintes suspendues le temps du chargement)
    const client = await db.pool.connect();
    let total = 0;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'").catch(() => { throw new Error('Le compte PostgreSQL doit pouvoir suspendre les contraintes (session_replication_role) : utilisez un compte administrateur pour la restauration'); });
      await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
      for (const t of cibles) {
        if (t.nom === 'schema_migrations') continue;
        const rl = readline.createInterface({ input: fs.createReadStream(path.join(dossier, t.fichier)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
        let lot = [];
        const vider = async () => { if (!lot.length) return; await client.query(`INSERT INTO "${t.nom}" OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(null::"${t.nom}", $1::jsonb)`, [`[${lot.join(',')}]`]); total += lot.length; lot = []; };
        for await (const ligne of rl) { if (!ligne) continue; lot.push(ligne); if (lot.length >= LOT) await vider(); }
        await vider();
      }
      // 4. compteurs d'identifiants réalignés
      const ident = (await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND is_identity = 'YES'", [schema])).rows;
      for (const c of ident) await client.query(`SELECT setval(pg_get_serial_sequence('"${c.table_name}"', '${c.column_name}'), GREATEST(COALESCE((SELECT max("${c.column_name}") FROM "${c.table_name}"), 0), 1), (SELECT count(*) > 0 FROM "${c.table_name}"))`);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
    // 5. contrôle des nombres de lignes
    const ecarts = [];
    for (const t of cibles) {
      if (t.nom === 'schema_migrations') continue;
      const n = (await db.get(`SELECT count(*)::int AS n FROM "${t.nom}"`)).n;
      if (n !== t.lignes) ecarts.push(`${t.nom} : ${n} ligne(s) restaurée(s) pour ${t.lignes} sauvegardée(s)`);
    }
    return { tables: cibles.length, lignes: total, ecarts, sansCible: manifeste.tables.filter((t) => !ordre.includes(t.nom)).map((t) => t.nom) };
  } finally { await db.close(); }
}

module.exports = { restaurer };
