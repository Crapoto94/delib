/**
 * RGPD (D97) : deux opérations offertes à l'administrateur, avec aperçu avant application.
 *  - **Archivage intermédiaire** : sort de l'usage courant les actes terminés anciens (listes actives, recherche)
 *    sans les supprimer ; l'acte reste conservé pour la preuve, avec sa date et son motif d'archivage.
 *  - **Pseudonymisation des actions et journaux** : remplace les identités et les adresses IP des entrées d'audit
 *    anciennes par des pseudonymes stables. Le journal d'audit restant immuable (SEC-04), la correspondance
 *    est conservée à part (table `rgpd_pseudonymes`) et une vue `audit_log_pseudonymise` restitue les pseudonymes.
 * Chaque opération est journalisée (table `rgpd_operations` + journal d'audit).
 */
const crypto = require('crypto');
const { requireOrg } = require('../../db/pool');

const TERMINAUX = ['adopte', 'rejete', 'retire', 'ajourne', 'abandonne', 'archive', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis', 'ar_recu', 'publie', 'executoire'];

function createRgpd({ db, audit, config, settings }) {
  const secret = config.jwt?.secret || 'vibedelib-rgpd';
  const pseudonyme = (org, type, valeur) => `psn_${crypto.createHmac('sha256', secret).update(`${org}|${type}|${valeur}`).digest('hex').slice(0, 16)}`;

  /** Seuils de conservation par défaut (paramétrables) : actes en années, journaux en mois. */
  async function seuils(org) {
    const s = await settings.resolve(org);
    const annees = Number(s['rgpd.retention_actes_annees']?.value ?? 5);
    const mois = Number(s['rgpd.retention_logs_mois']?.value ?? 12);
    const actes = new Date(); actes.setFullYear(actes.getFullYear() - annees);
    const logs = new Date(); logs.setMonth(logs.getMonth() - mois);
    return { annees, mois, actes: actes.toISOString(), logs: logs.toISOString() };
  }

  const journaliser = (ctx, org, type, seuil, parametres, resultat) => db.run(
    `INSERT INTO rgpd_operations (organisme_id, type, seuil, acteur, parametres, resultat) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [org, type, seuil, ctx.username, JSON.stringify(parametres), JSON.stringify(resultat)]);

  async function etat(ctx, orgId) {
    const org = requireOrg(orgId);
    const s = await seuils(org);
    const [a, ai, auditN, pseudoN] = await Promise.all([
      db.get('SELECT count(*)::int AS n FROM actes WHERE organisme_id = $1', [org]),
      db.get('SELECT count(*)::int AS n FROM actes WHERE organisme_id = $1 AND archive_intermediaire_at IS NOT NULL', [org]),
      db.get('SELECT count(*)::int AS n FROM audit_log WHERE organisme_id = $1', [org]),
      db.get('SELECT count(*)::int AS n FROM rgpd_pseudonymes WHERE organisme_id = $1', [org]),
    ]);
    return { retention: s, actes: a.n, archivesIntermediaires: ai.n, auditEntrees: auditN.n, pseudonymes: pseudoN.n };
  }

  const eligibles = (org, seuil) => db.all(
    `SELECT id, numero_suivi, titre, statut, updated_at FROM actes
      WHERE organisme_id = $1 AND archive_intermediaire_at IS NULL AND updated_at < $2 AND statut = ANY($3::text[])
      ORDER BY updated_at LIMIT 500`, [org, seuil, TERMINAUX]);

  async function archiver(ctx, orgId, { seuil, motif, dryRun = true } = {}) {
    const org = requireOrg(orgId);
    const s = await seuils(org);
    const limite = seuil || s.actes;
    const rows = await eligibles(org, limite);
    if (dryRun) return { apercu: true, seuil: limite, total: rows.length, exemple: rows.slice(0, 20).map((r) => ({ id: r.id, numeroSuivi: r.numero_suivi, titre: r.titre, statut: r.statut, modifie: r.updated_at })) };
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await db.run(`UPDATE actes SET archive_intermediaire_at = now(), archive_intermediaire_par = $3, archive_intermediaire_motif = $4 WHERE organisme_id = $1 AND id = ANY($2::int[])`, [org, ids, ctx.username, motif || null]);
      await db.run('DELETE FROM search_index WHERE acte_id = ANY($1::int[])', [ids]);
    }
    const resultat = { total: ids.length, seuil: limite, motif: motif || null };
    await journaliser(ctx, org, 'archivage_intermediaire', limite, { motif: motif || null }, resultat);
    await audit.log(ctx, { organismeId: org, action: 'rgpd.archivage_intermediaire', entity: 'actes', after: resultat });
    return { apercu: false, ...resultat };
  }

  async function aPseudonymiser(org, seuil) {
    const rows = await db.all('SELECT DISTINCT actor, on_behalf_of, ip FROM audit_log WHERE organisme_id = $1 AND at < $2', [org, seuil]);
    const acteurs = new Set(); const ips = new Set();
    for (const r of rows) { if (r.actor) acteurs.add(r.actor); if (r.on_behalf_of) acteurs.add(r.on_behalf_of); if (r.ip) ips.add(r.ip); }
    const entrees = (await db.get('SELECT count(*)::int AS n FROM audit_log WHERE organisme_id = $1 AND at < $2', [org, seuil])).n;
    return { entrees, acteurs: [...acteurs], ips: [...ips] };
  }

  async function pseudonymiser(ctx, orgId, { seuil, dryRun = true } = {}) {
    const org = requireOrg(orgId);
    const s = await seuils(org);
    const limite = seuil || s.logs;
    const p = await aPseudonymiser(org, limite);
    const exemple = p.acteurs.slice(0, 10).map((a) => ({ original: a, pseudonyme: pseudonyme(org, 'acteur', a) }));
    if (dryRun) return { apercu: true, seuil: limite, entrees: p.entrees, acteurs: p.acteurs.length, ips: p.ips.length, exemple };
    for (const a of p.acteurs) await db.run(`INSERT INTO rgpd_pseudonymes (organisme_id, type, original, pseudonyme) VALUES ($1,'acteur',$2,$3) ON CONFLICT DO NOTHING`, [org, a, pseudonyme(org, 'acteur', a)]);
    for (const i of p.ips) await db.run(`INSERT INTO rgpd_pseudonymes (organisme_id, type, original, pseudonyme) VALUES ($1,'ip',$2,$3) ON CONFLICT DO NOTHING`, [org, i, pseudonyme(org, 'ip', i)]);
    const resultat = { entrees: p.entrees, acteurs: p.acteurs.length, ips: p.ips.length, seuil: limite };
    await journaliser(ctx, org, 'pseudonymisation', limite, {}, resultat);
    await audit.log(ctx, { organismeId: org, action: 'rgpd.pseudonymisation', entity: 'audit_log', after: resultat });
    return { apercu: false, ...resultat };
  }

  async function operations(ctx, orgId) {
    const org = requireOrg(orgId);
    return (await db.all('SELECT * FROM rgpd_operations WHERE organisme_id = $1 ORDER BY created_at DESC LIMIT 50', [org]))
      .map((r) => ({ id: Number(r.id), type: r.type, seuil: r.seuil, acteur: r.acteur, parametres: r.parametres, resultat: r.resultat, createdAt: r.created_at }));
  }

  async function pseudonymes(ctx, orgId) {
    const org = requireOrg(orgId);
    return (await db.all('SELECT type, original, pseudonyme, created_at FROM rgpd_pseudonymes WHERE organisme_id = $1 ORDER BY created_at DESC, original LIMIT 500', [org]))
      .map((r) => ({ type: r.type, original: r.original, pseudonyme: r.pseudonyme, createdAt: r.created_at }));
  }

  /** Journal pseudonymisé (vue) : sert aux exports et à la consultation au-delà de la durée de conservation. */
  async function journalPseudonymise(ctx, orgId, { limit = 100, offset = 0 } = {}) {
    const org = requireOrg(orgId);
    const total = (await db.get('SELECT count(*)::int AS n FROM audit_log_pseudonymise WHERE organisme_id = $1', [org])).n;
    const rows = await db.all('SELECT * FROM audit_log_pseudonymise WHERE organisme_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3', [org, limit, offset]);
    return { total, items: rows };
  }

  return { etat, archiver, pseudonymiser, operations, pseudonymes, journalPseudonymise };
}

module.exports = { createRgpd, TERMINAUX };
