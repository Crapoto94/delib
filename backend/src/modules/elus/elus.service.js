/**
 * Élus et groupes politiques (CMN-02, ELU-34). Deux sources : le Hub DSI (identité en lecture seule, resynchronisable)
 * ou la saisie manuelle (CCAS, membres non élus — D22). Le groupe politique et les dates de mandat sont une surcouche
 * locale, jamais écrasée par une synchronisation.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const toElu = (r) => r && ({
  id: r.id, organismeId: r.organisme_id, source: r.source, nom: r.nom, prenom: r.prenom, nomComplet: `${r.prenom} ${r.nom}`.trim(), email: r.email, telephone: r.telephone,
  role: r.role, delegation: r.delegation, estElu: r.est_elu, groupeId: r.groupe_id, groupe: r.groupe_nom ?? undefined, mandatDebut: r.mandat_debut, mandatFin: r.mandat_fin, actif: r.actif,
});
const toGroupe = (r) => ({ id: r.id, nom: r.nom, couleur: r.couleur, ordre: r.ordre, actif: r.actif });

function createElus({ db, audit, directoryAdapter, log }) {
  const svc = {
    toElu,

    async assertExists(organismeId, id) {
      const r = await db.get('SELECT id FROM elus WHERE id = $1 AND organisme_id = $2 AND actif', [id, requireOrg(organismeId)]);
      if (!r) throw E.badRequest('Élu inconnu dans cet organisme');
      return r;
    },

    async list(organismeId, { q, actif = true, groupeId, estElu } = {}) {
      const org = requireOrg(organismeId);
      const p = [org]; const w = ['e.organisme_id = $1'];
      const add = (v) => { p.push(v); return `$${p.length}`; };
      if (actif !== null) w.push(`e.actif = ${add(actif)}`);
      if (groupeId) w.push(`e.groupe_id = ${add(groupeId)}`);
      if (estElu !== undefined) w.push(`e.est_elu = ${add(estElu)}`);
      if (q) w.push(`(e.nom ILIKE ${add(`%${q}%`)} OR e.prenom ILIKE $${p.length} OR e.email ILIKE $${p.length})`);
      const rows = await db.all(`SELECT e.*, g.nom AS groupe_nom FROM elus e LEFT JOIN groupes_politiques g ON g.id = e.groupe_id WHERE ${w.join(' AND ')} ORDER BY e.nom, e.prenom`, p);
      return rows.map(toElu);
    },

    async get(organismeId, id) {
      const r = await db.get('SELECT e.*, g.nom AS groupe_nom FROM elus e LEFT JOIN groupes_politiques g ON g.id = e.groupe_id WHERE e.id = $1 AND e.organisme_id = $2', [id, requireOrg(organismeId)]);
      if (!r) throw E.notFound('Élu introuvable');
      return toElu(r);
    },

    async checkGroupe(org, groupeId) {
      if (groupeId && !(await db.get('SELECT 1 AS x FROM groupes_politiques WHERE id = $1 AND organisme_id = $2', [groupeId, org]))) throw E.badRequest('Groupe politique inconnu dans cet organisme');
    },

    async create(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      await svc.checkGroupe(org, b.groupeId);
      const r = await db.get(
        `INSERT INTO elus (organisme_id, source, nom, prenom, email, telephone, role, delegation, est_elu, groupe_id, mandat_debut, mandat_fin)
         VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [org, b.nom, b.prenom || '', b.email?.toLowerCase() ?? null, b.telephone ?? null, b.role ?? null, b.delegation ?? null, b.estElu ?? true, b.groupeId ?? null, b.mandatDebut ?? null, b.mandatFin ?? null]);
      await audit.log(ctx, { organismeId: org, action: 'elu.create', entity: 'elus', entityId: r.id, after: toElu(r) });
      return toElu(r);
    },

    /** Élu issu du Hub : seuls le groupe, le mandat et l'état actif se modifient ici (identité en lecture seule). */
    async update(ctx, organismeId, id, patch) {
      const org = requireOrg(organismeId);
      const before = await svc.get(org, id);
      await svc.checkGroupe(org, patch.groupeId);
      const cols = { groupeId: 'groupe_id', mandatDebut: 'mandat_debut', mandatFin: 'mandat_fin', actif: 'actif' };
      if (before.source === 'manual') Object.assign(cols, { nom: 'nom', prenom: 'prenom', email: 'email', telephone: 'telephone', role: 'role', delegation: 'delegation', estElu: 'est_elu' });
      else if (['nom', 'prenom', 'email', 'telephone', 'role', 'delegation', 'estElu'].some((k) => patch[k] !== undefined)) throw E.conflict("Identité issue du Hub DSI : elle n'est pas modifiable ici");
      const set = []; const p = [id, org];
      for (const [k, col] of Object.entries(cols)) if (patch[k] !== undefined) { p.push(k === 'email' && patch[k] ? patch[k].toLowerCase() : patch[k]); set.push(`${col} = $${p.length}`); }
      if (!set.length) return before;
      const r = await db.get(`UPDATE elus SET ${set.join(', ')} WHERE id = $1 AND organisme_id = $2 RETURNING *`, p);
      await audit.log(ctx, { organismeId: org, action: 'elu.update', entity: 'elus', entityId: id, before, after: toElu(r) });
      return svc.get(org, id);
    },

    /** Synchronise depuis le Hub : crée les nouveaux, met à jour l'identité, désactive les absents ; ne touche jamais à la surcouche. */
    async syncFromHub(ctx, organismeId) {
      const org = requireOrg(organismeId);
      if (typeof directoryAdapter.listElus !== 'function') throw E.conflict("L'annuaire configuré ne fournit pas les élus");
      const list = await directoryAdapter.listElus();
      const seen = new Set(); let created = 0; let updated = 0;
      for (const e of list) {
        seen.add(e.externalId);
        const ex = await db.get("SELECT * FROM elus WHERE organisme_id = $1 AND source = 'hub' AND external_id = $2", [org, e.externalId]);
        if (!ex) {
          await db.run("INSERT INTO elus (organisme_id, source, external_id, nom, prenom, email, telephone, role, delegation) VALUES ($1,'hub',$2,$3,$4,$5,$6,$7,$8)",
            [org, e.externalId, e.nom, e.prenom, e.email, e.telephone, e.role, e.delegation]); created++;
        } else if (['nom', 'prenom', 'email', 'telephone', 'role', 'delegation'].some((k) => (ex[k] ?? null) !== (e[k] ?? null))) {
          await db.run('UPDATE elus SET nom = $2, prenom = $3, email = $4, telephone = $5, role = $6, delegation = $7, actif = true WHERE id = $1', [ex.id, e.nom, e.prenom, e.email, e.telephone, e.role, e.delegation]); updated++;
        } else if (!ex.actif) { await db.run('UPDATE elus SET actif = true WHERE id = $1', [ex.id]); updated++; }
      }
      const gone = (await db.all("SELECT id, external_id FROM elus WHERE organisme_id = $1 AND source = 'hub' AND actif", [org])).filter((r) => !seen.has(r.external_id));
      for (const g of gone) await db.run('UPDATE elus SET actif = false WHERE id = $1', [g.id]);
      await audit.log(ctx, { organismeId: org, action: 'elu.sync', entity: 'elus', after: { created, updated, deactivated: gone.length } });
      log.info({ organisme: org, created, updated, deactivated: gone.length }, 'élus synchronisés depuis le Hub');
      return { created, updated, deactivated: gone.length, total: list.length };
    },

    // ---- groupes politiques
    async groupes(organismeId) {
      const rows = await db.all(
        `SELECT g.*, (SELECT count(*)::int FROM elus e WHERE e.groupe_id = g.id AND e.actif) AS membres FROM groupes_politiques g WHERE g.organisme_id = $1 ORDER BY g.ordre, g.nom`, [requireOrg(organismeId)]);
      return rows.map((r) => ({ ...toGroupe(r), membres: r.membres }));
    },
    async createGroupe(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      try {
        const r = await db.get('INSERT INTO groupes_politiques (organisme_id, nom, couleur, ordre) VALUES ($1,$2,$3,$4) RETURNING *', [org, b.nom, b.couleur ?? null, b.ordre ?? 0]);
        await audit.log(ctx, { organismeId: org, action: 'groupe.create', entity: 'groupes_politiques', entityId: r.id, after: toGroupe(r) });
        return toGroupe(r);
      } catch (e) { if (e.code === '23505') throw E.conflict('Un groupe porte déjà ce nom'); throw e; }
    },
    async updateGroupe(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const set = []; const p = [id, org];
      for (const [k, col] of [['nom', 'nom'], ['couleur', 'couleur'], ['ordre', 'ordre'], ['actif', 'actif']]) if (b[k] !== undefined) { p.push(b[k]); set.push(`${col} = $${p.length}`); }
      if (!set.length) return (await svc.groupes(org)).find((g) => g.id === id);
      const r = await db.get(`UPDATE groupes_politiques SET ${set.join(', ')} WHERE id = $1 AND organisme_id = $2 RETURNING *`, p);
      if (!r) throw E.notFound('Groupe introuvable');
      await audit.log(ctx, { organismeId: org, action: 'groupe.update', entity: 'groupes_politiques', entityId: id, after: toGroupe(r) });
      return toGroupe(r);
    },
    async removeGroupe(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const r = await db.get('DELETE FROM groupes_politiques WHERE id = $1 AND organisme_id = $2 RETURNING nom', [id, org]);
      if (!r) throw E.notFound('Groupe introuvable');
      await audit.log(ctx, { organismeId: org, action: 'groupe.delete', entity: 'groupes_politiques', entityId: id, before: { nom: r.nom } });
    },
  };
  return svc;
}

module.exports = { createElus };
