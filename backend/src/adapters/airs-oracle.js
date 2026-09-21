/**
 * Adaptateur source « Oracle AIRS Delib » (reprise d'historique, section 25 bis / D111, IMP-03).
 *
 * Connexion DIRECTE, en LECTURE SEULE, à la base d'origine AIRS (Digitech) pour alimenter le sas `airs_*`.
 * Seules des requêtes SELECT sur les tables/vues métier documentées dans `airs_mcd.md` sont exécutées :
 * aucune donnée n'est modifiée et le SQL est figé ici (pas de concaténation d'entrée utilisateur).
 *
 * Configuration : variables `AIRS_ORACLE_*` (voir `.env.airs`, fichier ignoré par git).
 * Le pilote `oracledb` est chargé paresseusement : l'absence du pilote ou de la configuration désactive
 * proprement la fonctionnalité sans empêcher le démarrage.
 */
const { E } = require('../shared/errors');

// Séances : séances courantes (SEANCE + DOC_DEL_SEANCE) et séances archivées (DOC_DEL_ARCHIVE).
const SEANCES_SQL = `
SELECT * FROM (
  SELECT 'sea:' || s.SEA_ID AS "id", d.SEA_INTITULE AS "titre", t.TAS_LABEL AS "instance",
         d.SEA_TYPE AS "type_seance", TO_CHAR(d.SEA_DT_DEBUT, 'YYYY-MM-DD"T"HH24:MI:SS') AS "date",
         d.SEA_HEURE_DEBUT AS "heure", d.SEA_LIEU AS "lieu", d.SEA_NUMERO AS "numero",
         e.ELD_PRENOM || ' ' || e.ELD_NOM AS "president",
         s.SEA_ID AS "source_id", 'courante' AS "origine"
  FROM DELIBUSER.SEANCE s
  JOIN AIRSUSER.DOC_DEL_SEANCE d ON d.DOC_ID = s.SEA_ID
  LEFT JOIN DELIBUSER.TYPE_ASSEMBLE t ON t.TAS_ID = s.TAS_ID
  LEFT JOIN DELIBUSER.ELU_DESTINATAIRE e ON e.ELD_ID = s.ELD_ID
  WHERE (:annee IS NULL OR EXTRACT(YEAR FROM d.SEA_DT_DEBUT) = :annee)
  UNION ALL
  SELECT 'sea:' || a.DOC_ID, a.SEA_INTITULE, a.SEA_ASSEMBLEE,
         a.SEA_TYPE, TO_CHAR(a.SEA_DT_DEBUT, 'YYYY-MM-DD"T"HH24:MI:SS'),
         NULL, a.SEA_LIEU, a.SEA_NUMERO, NULL, a.DOC_ID, 'archive'
  FROM AIRSUSER.DOC_DEL_ARCHIVE a
  WHERE a.ARC_TYPE = 'Seance'
    AND (:annee IS NULL OR EXTRACT(YEAR FROM a.SEA_DT_DEBUT) = :annee)
) ORDER BY "date"`;

// Actes : délibérations courantes (rapport lié) et délibérations archivées.
// Les DOC_DEL_DELIB sans PROJET_DELIB (≈258) sont des doublons « courants » d'actes archivés, sans date ni
// référence de séance : l'archive porte le rattachement, on ne les reprend donc pas (sinon faux « actes isolés »).
const ACTES_SQL = `
SELECT * FROM (
  SELECT 'act:' || dl.DEL_ID AS "id",
         CASE WHEN p.SEA_ID IS NOT NULL THEN 'sea:' || p.SEA_ID END AS "seance",
         d.DDE_TITRE AS "titre", d.DDE_RESULTAT AS "resultat",
         TO_CHAR(d.DDE_DT_VOTE, 'YYYY-MM-DD"T"HH24:MI:SS') AS "date",
         r.RAP_DIRECTION AS "direction", r.RAP_SERVICE AS "service", r.RAP_RUB AS "rubrique",
         u.USR_LOGIN AS "redacteur", r.RAP_INSTRUCTEUR AS "redacteur_nom",
         COALESCE(e.ELD_PRENOM || ' ' || e.ELD_NOM, r.RAP_RAPPORTEUR) AS "rapporteur",
         c.COM_LABEL AS "commission", s.SEA_ASSEMBLEE AS "instance",
         f.CODENATURE AS "nature", f.CODEMATIERE AS "matiere",
         r.RAP_NUM_SUIVI AS "num_suivi", r.RAP_NUM_CHRONO AS "num_chrono",
         d.DDE_NUMERO AS "numero", d.DDE_SOUS_NUMERO AS "sous_numero", r.RAP_INCIDENCE AS "incidence_financiere", r.RAP_MONTANT AS "montant",
         'deliberation' AS "type", 'courant' AS "origine", p.RAP_ID AS "rap_id"
  FROM DELIBUSER.PROJET_DELIB dl
  JOIN DELIBUSER.PROJET_RAPPORT p ON p.RAP_ID = dl.RAP_ID
  LEFT JOIN AIRSUSER.DOC_DEL_DELIB d ON d.DOC_ID = dl.DEL_ID
  LEFT JOIN AIRSUSER.DOC_DEL_RAPPORT r ON r.DOC_ID = p.RAP_ID
  LEFT JOIN AIRSUSER.DOC_DEL_SEANCE s ON s.DOC_ID = p.SEA_ID
  LEFT JOIN DELIBUSER.ELU_DESTINATAIRE e ON e.ELD_ID = p.ELD_ID
  LEFT JOIN AIRSUSER.USERS u ON u.USR_ID = p.USR_ID
  LEFT JOIN DELIBUSER.COMMISSION c ON c.COM_ID = p.COM_ID
  LEFT JOIN DELIBUSER.FAST_RAPPORT_CLASSIF f ON f.RAP_ID = p.RAP_ID
  WHERE (:annee IS NULL OR EXTRACT(YEAR FROM d.DDE_DT_VOTE) = :annee)
  UNION ALL
  SELECT 'act:' || a.DOC_ID,
         CASE WHEN a.ARC_SEANCE_REF IS NOT NULL THEN 'sea:' || REGEXP_SUBSTR(a.ARC_SEANCE_REF, '[0-9]+') END,
         COALESCE(a.DDE_TITRE, a.RAP_TITRE), a.DDE_RESULTAT,
         TO_CHAR(a.DDE_DT_VOTE, 'YYYY-MM-DD"T"HH24:MI:SS'),
         a.RAP_DIRECTION, a.RAP_SERVICE, a.RAP_RUB,
         a.RAP_UTILISATEUR, a.RAP_INSTRUCTEUR, a.RAP_RAPPORTEUR,
         NULL, a.SEA_ASSEMBLEE, NULL, NULL,
         a.RAP_NUM_SUIVI, a.RAP_NUM_CHRONO, a.DDE_NUMERO, a.DDE_SOUS_NUMERO, NULL, a.RAP_MONTANT, 'deliberation', 'archive', NULL
  FROM AIRSUSER.DOC_DEL_ARCHIVE a
  WHERE a.ARC_TYPE IN ('Delib', 'Rapport')
    AND (:annee IS NULL OR EXTRACT(YEAR FROM a.DDE_DT_VOTE) = :annee)
) ORDER BY "date"`;

const CHAMPS_SEANCE = ['id', 'titre', 'instance', 'type_seance', 'date', 'heure', 'lieu', 'numero', 'president', 'origine'];
const CHAMPS_ACTE = ['id', 'seance', 'titre', 'numero', 'sous_numero', 'num_suivi', 'num_chrono', 'rap_id', 'type', 'nature', 'matiere', 'rubrique', 'direction', 'service',
  'redacteur', 'redacteur_nom', 'rapporteur', 'resultat', 'date', 'commission', 'instance', 'incidence_financiere', 'montant', 'origine'];

/** Oracle renvoie les alias en MAJUSCULES : on normalise en minuscules pour les champs canoniques. */
const lower = (row) => {
  const o = {};
  for (const [k, v] of Object.entries(row || {})) o[k.toLowerCase()] = v;
  return o;
};

/** Nettoie un libellé AIRS (entités HTML, retours ligne) et le ramène sur une ligne. */
const texte = (v) => (v === null || v === undefined ? null : String(v).replace(/&#13;/g, ' ').replace(/\s+/g, ' ').trim() || null);

function normaliser(row, champs) {
  const bas = lower(row);
  const o = {};
  for (const c of champs) o[c] = typeof bas[c] === 'string' ? texte(bas[c]) : (bas[c] ?? null);
  return o;
}

function createAirsOracle({ config, log } = {}) {
  const cfg = (config && config.airs) || {};
  let pilote = null;

  const driver = () => {
    if (pilote) return pilote;
    try { pilote = require('oracledb'); } catch { throw E.upstream("Pilote Oracle (« oracledb ») non installé : impossible d'interroger AIRS DELIB"); }
    return pilote;
  };

  const configuree = () => !!(cfg.enabled && cfg.connectString && cfg.user && cfg.password);

  /** Description non sensible de la cible (pour l'écran d'import et les journaux). */
  const cible = () => (cfg.connectString ? { service: cfg.service, hote: cfg.host, port: cfg.port, utilisateur: cfg.user } : null);

  async function avecConnexion(fn) {
    if (!configuree()) throw E.incomplete('Connexion Oracle AIRS non configurée (AIRS_ORACLE_HOST/PORT/SERVICE/USER/PASSWORD dans .env.airs)');
    const db = driver();
    let conn;
    try {
      conn = await db.getConnection({ user: cfg.user, password: cfg.password, connectString: cfg.connectString });
      conn.callTimeout = 180000;
      return await fn(conn, db);
    } catch (e) {
      if (e && e.name === 'AppError') throw e;
      log?.warn?.({ err: e.message, service: cfg.service }, 'connexion Oracle AIRS en échec');
      throw E.upstream(`Connexion Oracle AIRS (${cfg.service}) : ${e.message}`);
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  async function ping() {
    return avecConnexion(async (conn) => {
      const t = Date.now();
      await conn.execute('SELECT 1 FROM DUAL');
      return Date.now() - t;
    });
  }

  /**
   * Extrait séances et actes d'AIRS au format canonique du sas.
   * @param {{ annee?: number|null, mode?: 'passes'|'preparation' }} options
   * @returns {Promise<{ seances: object[], actes: object[] }>}
   */
  async function extraire({ annee = null } = {}) {
    const binds = { annee: annee ? Number(annee) : null };
    return avecConnexion(async (conn, db) => {
      const opts = { outFormat: db.OUT_FORMAT_OBJECT, fetchArraySize: 500 };
      // Une seule opération à la fois sur une connexion node-oracledb : exécution séquentielle.
      const r1 = await conn.execute(SEANCES_SQL, binds, opts);
      const r2 = await conn.execute(ACTES_SQL, binds, opts);
      const seances = (r1.rows || []).map((r) => normaliser(r, CHAMPS_SEANCE));
      const actes = (r2.rows || []).map((r) => normaliser(r, CHAMPS_ACTE));
      return { seances, actes };
    });
  }

  /**
   * Aperçu (lecture seule) de quelques lignes d'une table source, pour validation humaine avant import.
   * @param {'seances'|'actes'} table
   * @param {number} limite
   */
  async function apercu(table, limite = 10) {
    const sql = table === 'seances' ? SEANCES_SQL : table === 'actes' ? ACTES_SQL : null;
    if (!sql) throw E.badRequest(`Table source inconnue pour un aperçu : ${table}`);
    const champs = table === 'seances' ? CHAMPS_SEANCE : CHAMPS_ACTE;
    const n = Math.min(Math.max(Number(limite) || 10, 1), 50);
    return avecConnexion(async (conn, db) => {
      // `n` est un entier borné (jamais une entrée brute) : interpolation sûre.
      const r = await conn.execute(`${sql} FETCH FIRST ${n} ROWS ONLY`, { annee: null }, { outFormat: db.OUT_FORMAT_OBJECT, fetchArraySize: n });
      return (r.rows || []).map((row) => normaliser(row, champs));
    });
  }

  /**
   * Nombre de lignes que produirait l'extraction pour une table source (comptage à la volée, lecture seule).
   * @param {'seances'|'actes'} table
   */
  async function compter(table) {
    const sql = table === 'seances' ? SEANCES_SQL : table === 'actes' ? ACTES_SQL : null;
    if (!sql) throw E.badRequest(`Table source inconnue pour un comptage : ${table}`);
    return avecConnexion(async (conn, db) => {
      const r = await conn.execute(`SELECT COUNT(*) AS "n" FROM (${sql})`, { annee: null }, { outFormat: db.OUT_FORMAT_OBJECT });
      const row = (r.rows || [])[0] || {};
      return Number(row.n ?? row.N ?? 0);
    });
  }

  /** Fichiers d'origine d'un acte (courant : liés par FIC_LINK ; archivé : chemin DEL_ARCHIVE par DOC_ID). */
  async function fichiers({ docId, archive }) {
    if (!configuree()) return [];
    return avecConnexion(async (conn, db) => {
      const sql = archive
        ? 'SELECT FIC_NOM, FIC_CHEMIN_SERV, FIC_LIBELLE, TFP_ID, CTY_ID FROM AIRSUSER.FIC_PRIMAIRE WHERE CTY_ID = 7 AND FIC_CHEMIN_SERV LIKE :pat'
        : 'SELECT FIC_NOM, FIC_CHEMIN_SERV, FIC_LIBELLE, TFP_ID, CTY_ID FROM AIRSUSER.FIC_PRIMAIRE WHERE FIC_LINK = :id';
      const binds = archive ? { pat: `%/${docId}.%` } : { id: Number(docId) };
      const r = await conn.execute(sql, binds, { outFormat: db.OUT_FORMAT_OBJECT });
      return (r.rows || []).map((x) => ({ nom: x.FIC_NOM, cheminServ: x.FIC_CHEMIN_SERV, libelle: x.FIC_LIBELLE, tfp: x.TFP_ID, cty: x.CTY_ID }));
    });
  }

  /** Documents d'un acte COURANT : corps Word de la délibération (DEL_DELIB/<DEL_ID>.…) et du rapport/exposé (DEL_RAPPORT/<RAP_ID>.…). */
  async function documentsCourants({ delId, rapId }) {
    if (!configuree()) return [];
    return avecConnexion(async (conn, db) => {
      const lire = async (id, source) => {
        if (!id) return [];
        const r = await conn.execute(
          'SELECT FIC_NOM, FIC_CHEMIN_SERV, FIC_LIBELLE, TFP_ID, CTY_ID FROM AIRSUSER.FIC_PRIMAIRE WHERE FIC_CHEMIN_SERV LIKE :pat',
          { pat: `%/${id}.%` }, { outFormat: db.OUT_FORMAT_OBJECT });
        return (r.rows || []).map((x) => ({ nom: x.FIC_NOM, cheminServ: x.FIC_CHEMIN_SERV, libelle: x.FIC_LIBELLE, tfp: x.TFP_ID, cty: x.CTY_ID, source }));
      };
      return [...await lire(delId, 'delib'), ...await lire(rapId, 'rapport')];
    });
  }

  /** Annexes d'un rapport (acte courant) : DELIBUSER.ANNEXE (RAP_ID) ⋈ DOC_DEL_ANNEXE ⋈ FIC_PRIMAIRE (DEL_ANNEXE/<ANN_ID>.…). */
  async function annexesDeRapport(rapId) {
    if (!configuree() || !rapId) return [];
    return avecConnexion(async (conn, db) => {
      const r = await conn.execute(
        `SELECT a.ANN_ID AS "annId", n.ANN_LIBELLE AS "libelle", n.ANN_TYPE AS "type", n.ANN_ORDRE AS "ordre", f.FIC_NOM AS "nom", f.FIC_CHEMIN_SERV AS "cheminServ"
         FROM DELIBUSER.ANNEXE a
         JOIN AIRSUSER.DOC_DEL_ANNEXE n ON n.DOC_ID = a.ANN_ID
         LEFT JOIN AIRSUSER.FIC_PRIMAIRE f ON f.CTY_ID = 3 AND f.FIC_CHEMIN_SERV LIKE '%/' || a.ANN_ID || '.%'
         WHERE a.RAP_ID = :rapId ORDER BY n.ANN_ORDRE`, { rapId: Number(rapId) }, { outFormat: db.OUT_FORMAT_OBJECT });
      return (r.rows || []).filter((x) => x.cheminServ).map((x) => ({ annId: x.annId, nom: x.nom, cheminServ: x.cheminServ, libelle: x.libelle, type: x.type, ordre: x.ordre }));
    });
  }

  return { configuree, cible, ping, extraire, apercu, compter, fichiers, documentsCourants, annexesDeRapport, tablesSupportees: ['seances', 'actes'] };
}

module.exports = { createAirsOracle };
