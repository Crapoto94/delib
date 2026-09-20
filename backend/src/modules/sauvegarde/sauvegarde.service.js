/**
 * Sauvegarde de la base et des fichiers vers un dossier réseau (SAV-01 à SAV-07, D96).
 *
 * Export logique sans outil externe : un instantané cohérent (transaction en lecture seule, « repeatable read »), une table = un fichier
 * NDJSON compressé (une ligne = `to_jsonb(ligne)`, donc tous les types PostgreSQL survivent), un schéma et un manifeste avec les empreintes.
 * La restauration (restaurer.js) recrée le schéma par les migrations puis recharge les données.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { E } = require('../../shared/errors');
const { createSecretBox } = require('../../shared/secretbox');
const { choisirTransport, NOM } = require('./transports');
const pkg = require('../../../package.json');

const FORMAT = 'vibedelib.sauvegarde/1';
// tables volatiles ou reconstructibles : sessions et codes (on se reconnecte), index de recherche (« Ré-indexer »)
const EXCLUES = ['sessions', 'elu_sessions', 'elu_codes', 'search_index'];
const LOT = 2000;
const p2 = (n) => String(n).padStart(2, '0');
const nomDossier = (d = new Date()) => `vibedelib_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
const jourDe = (nom) => { const m = /^vibedelib_(\d{4})-(\d{2})-(\d{2})_/.exec(nom); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };

async function sha256Fichier(f) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(f), h);
  return h.digest('hex');
}
async function tailleDossier(dir) {
  let n = 0; let octets = 0;
  const marcher = async (d) => { for (const e of await fs.promises.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === '.cache-alfresco') continue; if (e.isDirectory()) await marcher(p); else { n++; octets += (await fs.promises.stat(p)).size; } } };
  try { await marcher(dir); } catch { /* dossier absent */ }
  return { n, octets };
}

function createSauvegarde({ db, audit, config, log, transport: injecte }) {
  const box = createSecretBox(config?.jwt?.secret || 'dev', 'sauvegarde');
  let enCours = null; // promesse de la sauvegarde active (une seule à la fois)

  const cfgRow = () => db.get('SELECT * FROM sauvegarde_config WHERE id');
  const vue = (r) => ({ actif: !!r?.actif, cible: r?.cible || '', utilisateur: r?.utilisateur || '', motDePasseDefini: !!r?.mot_de_passe_chiffre, heure: r?.heure || '02:00', retentionJours: r?.retention_jours ?? 30, inclureFichiers: r?.inclure_fichiers ?? true });
  const transportDe = (r) => injecte || choisirTransport({ cible: r?.cible, utilisateur: r?.utilisateur, motDePasse: r?.mot_de_passe_chiffre ? box.dechiffre(r.mot_de_passe_chiffre) : '' });

  /** Écrit la base dans `dir` : schema.json, donnees/<table>.ndjson.gz, manifest.json. */
  async function exporter(dir) {
    await fs.promises.mkdir(path.join(dir, 'donnees'), { recursive: true });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
      const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name")).rows.map((r) => r.table_name);
      const colonnes = (await client.query("SELECT table_name, column_name, data_type, udt_name, is_identity, ordinal_position FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position")).rows;
      const cles = (await client.query(`SELECT c.conrelid::regclass::text AS enfant, c.confrelid::regclass::text AS parent FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = current_schema()`)).rows;
      const sortie = []; let octets = 0; let i = 0;
      for (const t of tables) {
        if (EXCLUES.includes(t)) continue;
        const fichier = path.join(dir, 'donnees', `${t}.ndjson.gz`); const curseur = `c_${i++}`;
        await client.query(`DECLARE ${curseur} NO SCROLL CURSOR FOR SELECT to_jsonb(x)::text AS j FROM "${t}" x`);
        const flux = async function* () {
          for (;;) {
            const r = (await client.query(`FETCH ${LOT} FROM ${curseur}`)).rows;
            if (!r.length) return;
            yield `${r.map((x) => x.j).join('\n')}\n`;
          }
        };
        let n = 0;
        await pipeline(Readable.from((async function* () { for await (const bloc of flux()) { n += bloc.split('\n').length - 1; yield bloc; } })()), zlib.createGzip(), fs.createWriteStream(fichier));
        await client.query(`CLOSE ${curseur}`);
        const o = (await fs.promises.stat(fichier)).size; octets += o;
        sortie.push({ nom: t, lignes: n, fichier: `donnees/${t}.ndjson.gz`, octets: o, sha256: await sha256Fichier(fichier) });
      }
      await client.query('COMMIT');
      const migr = (await db.all('SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version);
      await fs.promises.writeFile(path.join(dir, 'schema.json'), JSON.stringify({ tables: tables.filter((t) => !EXCLUES.includes(t)), colonnes, cles }, null, 1));
      return { tables: sortie, lignes: sortie.reduce((a, t) => a + t.lignes, 0), octets, migrations: migr };
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  }

  const svc = {
    FORMAT, exporter, EXCLUES,

    async config() { return vue(await cfgRow()); },
    async setConfig(ctx, b) {
      const cur = await cfgRow();
      const v = {
        actif: b.actif ?? cur?.actif ?? false, cible: b.cible !== undefined ? b.cible.trim() : cur?.cible ?? null, utilisateur: b.utilisateur !== undefined ? b.utilisateur.trim() : cur?.utilisateur ?? null,
        mdp: b.motDePasse ? box.chiffre(b.motDePasse) : cur?.mot_de_passe_chiffre ?? null, heure: b.heure ?? cur?.heure ?? '02:00', retention: b.retentionJours ?? cur?.retention_jours ?? 30, fichiers: b.inclureFichiers ?? cur?.inclure_fichiers ?? true,
      };
      if (v.actif && !v.cible) throw E.badRequest('Indiquez la destination de la sauvegarde avant de l\'activer');
      await db.run(`INSERT INTO sauvegarde_config (id, actif, cible, utilisateur, mot_de_passe_chiffre, heure, retention_jours, inclure_fichiers, updated_by) VALUES (true,$1,$2,$3,$4,$5,$6,$7,$8)
                    ON CONFLICT (id) DO UPDATE SET actif = EXCLUDED.actif, cible = EXCLUDED.cible, utilisateur = EXCLUDED.utilisateur, mot_de_passe_chiffre = EXCLUDED.mot_de_passe_chiffre,
                      heure = EXCLUDED.heure, retention_jours = EXCLUDED.retention_jours, inclure_fichiers = EXCLUDED.inclure_fichiers, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [v.actif, v.cible || null, v.utilisateur || null, v.mdp, v.heure, v.retention, v.fichiers, ctx.username]);
      await audit.log(ctx, { action: 'sauvegarde.config', entity: 'sauvegarde_config', after: { actif: v.actif, cible: v.cible, utilisateur: v.utilisateur, heure: v.heure, retentionJours: v.retention, inclureFichiers: v.fichiers, motDePasseModifie: !!b.motDePasse } });
      return svc.config();
    },

    /** Bouton de test : connexion, écriture puis effacement d'un fichier sur la destination. Ne lève pas d'erreur. */
    async tester(ctx) {
      try { const r = await transportDe(await cfgRow()).tester(); await audit.log(ctx, { action: 'sauvegarde.test', entity: 'sauvegarde_config', after: { ok: true } }); return r; }
      catch (e) { await audit.log(ctx, { action: 'sauvegarde.test', entity: 'sauvegarde_config', after: { ok: false } }); return { ok: false, message: e.message }; }
    },

    async journal(limit = 20) {
      return (await db.all('SELECT * FROM sauvegardes ORDER BY id DESC LIMIT $1', [limit])).map((r) => ({
        id: r.id, debut: r.debut, fin: r.fin, dureeSec: r.fin ? Math.round((new Date(r.fin) - new Date(r.debut)) / 1000) : null, statut: r.statut, declencheur: r.declencheur, lancePar: r.lance_par, dossier: r.dossier,
        tables: r.tables, lignes: r.lignes === null ? null : Number(r.lignes), octetsBase: r.octets_base === null ? null : Number(r.octets_base), fichiers: r.fichiers, octetsFichiers: r.octets_fichiers === null ? null : Number(r.octets_fichiers), purgees: r.purgees, erreur: r.erreur,
      }));
    },
    enCours: () => !!enCours,
    async idle() { if (enCours) await enCours.catch(() => undefined); },

    /** Lance une sauvegarde en arrière-plan (refusée si une autre est en cours). Renvoie tout de suite l'identifiant du journal. */
    async lancer(ctx, declencheur = 'manuel') {
      if (enCours) throw E.conflict('Une sauvegarde est déjà en cours');
      const cur = await cfgRow();
      if (!cur?.cible) throw E.conflict('Aucune destination de sauvegarde configurée');
      const transport = transportDe(cur); // échoue tout de suite si la cible est inutilisable
      const zombie = await db.get("SELECT id FROM sauvegardes WHERE statut = 'en_cours' AND debut > now() - interval '6 hours' LIMIT 1");
      if (zombie) throw E.conflict('Une sauvegarde est déjà en cours');
      await db.run("UPDATE sauvegardes SET statut = 'erreur', fin = now(), erreur = 'Interrompue (redémarrage du serveur)' WHERE statut = 'en_cours'");
      const dossier = nomDossier();
      const ligne = await db.get('INSERT INTO sauvegardes (declencheur, lance_par, dossier) VALUES ($1,$2,$3) RETURNING id', [declencheur, ctx?.username ?? 'planificateur', dossier]);
      const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibedelib-sauvegarde-'));
      enCours = (async () => {
        try {
          const dir = path.join(tmp, dossier);
          const base = await exporter(dir);
          const stockage = config.storage.dir;
          const fic = cur.inclure_fichiers ? await tailleDossier(stockage) : { n: 0, octets: 0 };
          const manifeste = { format: FORMAT, creeLe: new Date().toISOString(), application: { nom: 'VibeDélib', version: pkg.version }, schema: db.schema, migrations: base.migrations, exclues: EXCLUES, tables: base.tables, fichiers: cur.inclure_fichiers ? { dossier: 'fichiers', nombre: fic.n, octets: fic.octets } : null };
          await fs.promises.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifeste, null, 1));
          await transport.copier({ source: dir, nom: dossier, fichiers: cur.inclure_fichiers && fic.n ? stockage : null });
          // rétention : seulement après une sauvegarde réussie
          let purgees = 0;
          const limite = new Date(Date.now() - cur.retention_jours * 86400000);
          for (const nom of await transport.lister()) { const j = jourDe(nom); if (j && j < limite && nom !== dossier) { await transport.supprimer(nom); purgees++; } }
          await db.run("UPDATE sauvegardes SET statut = 'ok', fin = now(), tables = $2, lignes = $3, octets_base = $4, fichiers = $5, octets_fichiers = $6, purgees = $7 WHERE id = $1", [ligne.id, base.tables.length, base.lignes, base.octets, fic.n, fic.octets, purgees]);
          await audit.log(ctx || { username: 'planificateur' }, { action: 'sauvegarde.ok', entity: 'sauvegardes', entityId: ligne.id, after: { dossier, tables: base.tables.length, lignes: base.lignes, purgees } });
          log?.info?.({ dossier, lignes: base.lignes, purgees }, 'sauvegarde terminée');
        } catch (e) {
          const msg = String(e.message).slice(0, 500);
          await db.run("UPDATE sauvegardes SET statut = 'erreur', fin = now(), erreur = $2 WHERE id = $1", [ligne.id, msg]).catch(() => undefined);
          await audit.log(ctx || { username: 'planificateur' }, { action: 'sauvegarde.echec', entity: 'sauvegardes', entityId: ligne.id, after: { dossier, erreur: msg } }).catch(() => undefined);
          log?.error?.({ err: msg }, 'sauvegarde en échec'); // alerte : le journal d'audit et le tableau de bord de la plateforme
        } finally { await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined); enCours = null; }
      })();
      return { id: ligne.id, dossier };
    },

    /** Tâche planifiée : une seule fois par jour, à partir de l'heure choisie, jamais deux sauvegardes à la fois. */
    async siDue(now = new Date()) {
      const cur = await cfgRow();
      if (!cur?.actif || !cur.cible || enCours) return 0;
      const [h, m] = cur.heure.split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return 0;
      const debutJour = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // une fois par jour ; après un échec, nouvel essai au plus toutes les heures (pas de tempête de tentatives)
      const deja = await db.get("SELECT 1 AS x FROM sauvegardes WHERE declencheur = 'planifie' AND ((debut >= $1 AND statut IN ('ok', 'en_cours')) OR debut > now() - interval '1 hour')", [debutJour]);
      if (deja) return 0;
      await svc.lancer({ username: 'planificateur' }, 'planifie');
      return 1;
    },
  };
  return svc;
}

module.exports = { createSauvegarde, FORMAT, EXCLUES, nomDossier, NOM };
