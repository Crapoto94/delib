/**
 * Adaptateur GedPort — SIMULATEUR de GED (mode « simulation », D86). Reproduit ce que fait Alfresco pour notre usage : dossiers
 * imbriqués, dépôt d'un fichier, nouvelle VERSION quand on redépose le même nom, liste des enfants, lecture du contenu. L'arborescence
 * est persistée dans `ged_sim_nodes` : elle survit aux redémarrages et permet de vérifier le plan de classement dans l'explorateur.
 *
 * Contrat du port (`cfg` = { organismeId, racine, … }) :
 *   testConnexion(cfg)                      -> { ok, message, details }
 *   ensurePath(cfg, [{ nom, description }]) -> { id, crees: [chemin…] }   (idempotent)
 *   deposer(cfg, dossierId, { nom, buffer, mime, description, proprietes }) -> { nodeId, versionLabel, nouveau, nouvelleVersion }
 *   deplacer(cfg, nodeId, parentId)         -> id du nœud (déplacement, l'identifiant ne change pas)
 *   majNode(cfg, nodeId, { name, titre, description }) -> nœud mis à jour
 *   enfants(cfg, nodeId|null)               -> [{ id, nom, dossier, taille, version, modifieLe, description }]
 *   contenu(cfg, nodeId)                    -> Buffer
 */
const crypto = require('crypto');

function createGedSimulateur({ db }) {
  const racineOf = async (cfg) => {
    const r = await db.get('SELECT id FROM ged_sim_nodes WHERE organisme_id = $1 AND parent_id IS NULL AND nom = $2', [cfg.organismeId, 'Company Home']);
    if (r) return r.id;
    const id = crypto.randomUUID();
    await db.run("INSERT INTO ged_sim_nodes (id, organisme_id, parent_id, nom, dossier, description) VALUES ($1,$2,NULL,'Company Home',true,'Racine du dépôt (simulation)')", [id, cfg.organismeId]);
    return id;
  };
  const enfant = (org, parent, nom) => db.get('SELECT * FROM ged_sim_nodes WHERE organisme_id = $1 AND parent_id = $2 AND nom = $3', [org, parent, nom]);

  return {
    mode: 'simulation',

    async testConnexion(cfg) {
      const t = Date.now(); const root = await racineOf(cfg);
      const n = (await db.get('SELECT count(*)::int AS n FROM ged_sim_nodes WHERE organisme_id = $1', [cfg.organismeId])).n;
      return { ok: true, message: 'Simulateur de GED : connexion simulée', details: { serveur: 'Simulateur Alfresco', version: 'simulation', edition: 'Community (simulée)', racine: { id: root, nom: 'Company Home' }, noeuds: n, ms: Date.now() - t } };
    },

    async ensurePath(cfg, segments) {
      let cur = await racineOf(cfg); const crees = []; const chemin = [];
      for (const seg of segments) {
        chemin.push(seg.nom);
        let n = await enfant(cfg.organismeId, cur, seg.nom);
        if (!n) {
          const id = crypto.randomUUID();
          await db.run('INSERT INTO ged_sim_nodes (id, organisme_id, parent_id, nom, dossier, description) VALUES ($1,$2,$3,$4,true,$5)', [id, cfg.organismeId, cur, seg.nom, seg.description ?? null]);
          crees.push(chemin.join(' / ')); n = { id };
        }
        cur = n.id;
      }
      return { id: cur, crees };
    },

    async deposer(cfg, dossierId, { nom, buffer, description, proprietes }) {
      const sha = crypto.createHash('sha256').update(buffer).digest('hex');
      const ex = await enfant(cfg.organismeId, dossierId, nom);
      if (ex) {
        const r = await db.get('UPDATE ged_sim_nodes SET contenu = $2, sha256 = $3, taille = $4, version = version + 1, description = COALESCE($5, description), proprietes = $6::jsonb, updated_at = now() WHERE id = $1 RETURNING version', [ex.id, buffer, sha, buffer.length, description ?? null, JSON.stringify(proprietes || {})]);
        return { nodeId: ex.id, versionLabel: `${r.version}.0`, nouveau: false, nouvelleVersion: true };
      }
      const id = crypto.randomUUID();
      await db.run('INSERT INTO ged_sim_nodes (id, organisme_id, parent_id, nom, dossier, description, proprietes, contenu, sha256, taille) VALUES ($1,$2,$3,$4,false,$5,$6::jsonb,$7,$8,$9)', [id, cfg.organismeId, dossierId, nom, description ?? null, JSON.stringify(proprietes || {}), buffer, sha, buffer.length]);
      return { nodeId: id, versionLabel: '1.0', nouveau: true, nouvelleVersion: false };
    },

    /** Déplace un nœud sous un autre parent (l'identifiant est conservé). */
    async deplacer(cfg, nodeId, parentId) {
      const r = await db.get('UPDATE ged_sim_nodes SET parent_id = $3, updated_at = now() WHERE id = $1 AND organisme_id = $2 RETURNING id', [nodeId, cfg.organismeId, parentId]);
      if (!r) throw new Error(`Nœud introuvable : ${nodeId}`);
      return r.id;
    },

    /** Met à jour le nom et/ou les propriétés d'un nœud (titre, description). */
    async majNode(cfg, nodeId, { name, titre, description } = {}) {
      const props = {};
      if (titre !== undefined) props['cm:title'] = titre;
      const r = await db.get(
        'UPDATE ged_sim_nodes SET nom = COALESCE($3, nom), description = COALESCE($4, description), proprietes = proprietes || $5::jsonb, updated_at = now() WHERE id = $1 AND organisme_id = $2 RETURNING id, nom, description',
        [nodeId, cfg.organismeId, name ?? null, description ?? null, JSON.stringify(props)]);
      if (!r) throw new Error(`Nœud introuvable : ${nodeId}`);
      return r;
    },

    async enfants(cfg, nodeId) {
      const parent = nodeId || (await racineOf(cfg));
      const rows = await db.all('SELECT id, nom, dossier, taille, version, updated_at, description FROM ged_sim_nodes WHERE organisme_id = $1 AND parent_id = $2 ORDER BY dossier DESC, nom', [cfg.organismeId, parent]);
      return rows.map((r) => ({ id: r.id, nom: r.nom, dossier: r.dossier, taille: r.taille, version: r.dossier ? null : `${r.version}.0`, modifieLe: r.updated_at, description: r.description }));
    },

    async supprimer(cfg, nodeId) { await db.run('DELETE FROM ged_sim_nodes WHERE id = $1 AND organisme_id = $2 AND NOT dossier', [nodeId, cfg.organismeId]); },

    async existe(cfg, nodeId) { return !!(await db.get('SELECT 1 AS x FROM ged_sim_nodes WHERE id = $1 AND organisme_id = $2', [nodeId, cfg.organismeId])); },

    /** État d'un nœud (nom et nom du parent), pour savoir s'il est déjà classé. */
    async nodeInfo(cfg, nodeId) {
      const r = await db.get(
        `SELECT n.id, n.nom, p.nom AS parent_nom FROM ged_sim_nodes n LEFT JOIN ged_sim_nodes p ON p.id = n.parent_id
         WHERE n.id = $1 AND n.organisme_id = $2`, [nodeId, cfg.organismeId]);
      return r ? { id: r.id, nom: r.nom, parentNom: r.parent_nom } : null;
    },

    async contenu(cfg, nodeId) {
      const r = await db.get('SELECT contenu FROM ged_sim_nodes WHERE id = $1 AND organisme_id = $2 AND NOT dossier', [nodeId, cfg.organismeId]);
      return r?.contenu ?? null;
    },
  };
}

module.exports = { createGedSimulateur };
