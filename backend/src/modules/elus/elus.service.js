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
  mobile: r.mobile_local || r.telephone || null, mobileLocal: r.mobile_local ?? null, desactiveManuellement: !!r.desactive_manuellement,
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
        `INSERT INTO elus (organisme_id, source, nom, prenom, email, telephone, role, delegation, est_elu, groupe_id, mandat_debut, mandat_fin, mobile_local)
         VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [org, b.nom, b.prenom || '', b.email?.toLowerCase() ?? null, b.telephone ?? null, b.role ?? null, b.delegation ?? null, b.estElu ?? true, b.groupeId ?? null, b.mandatDebut ?? null, b.mandatFin ?? null, b.mobile || null]);
      await audit.log(ctx, { organismeId: org, action: 'elu.create', entity: 'elus', entityId: r.id, after: toElu(r) });
      return toElu(r);
    },

    /** Élu issu du Hub : seuls le groupe, le mandat et l'état actif se modifient ici (identité en lecture seule). */
    async update(ctx, organismeId, id, patch) {
      const org = requireOrg(organismeId);
      const before = await svc.get(org, id);
      await svc.checkGroupe(org, patch.groupeId);
      const cols = { groupeId: 'groupe_id', mandatDebut: 'mandat_debut', mandatFin: 'mandat_fin', actif: 'actif', mobile: 'mobile_local' };
      if (before.source === 'manual') Object.assign(cols, { nom: 'nom', prenom: 'prenom', email: 'email', telephone: 'telephone', role: 'role', delegation: 'delegation', estElu: 'est_elu' });
      else if (['nom', 'prenom', 'email', 'telephone', 'role', 'delegation', 'estElu'].some((k) => patch[k] !== undefined)) throw E.conflict("Identité issue du Hub DSI : elle n'est pas modifiable ici");
      const set = []; const p = [id, org];
      for (const [k, col] of Object.entries(cols)) if (patch[k] !== undefined) { p.push(k === 'email' && patch[k] ? patch[k].toLowerCase() : (k === 'mobile' ? (patch[k] || null) : patch[k])); set.push(`${col} = $${p.length}`); }
      if (patch.actif !== undefined) { p.push(!patch.actif); set.push(`desactive_manuellement = $${p.length}`); } // désactivé à la main : la synchronisation ne le réactive jamais (ELU-81)
      if (!set.length) return before;
      const r = await db.get(`UPDATE elus SET ${set.join(', ')} WHERE id = $1 AND organisme_id = $2 RETURNING *`, p);
      await audit.log(ctx, { organismeId: org, action: 'elu.update', entity: 'elus', entityId: id, before, after: toElu(r) });
      return svc.get(org, id);
    },

    /**
     * Suppression (ELU-82) : refusée pour un élu du Hub (il serait recréé : on le désactive) et pour tout élu ayant un historique.
     * Sinon définitive ; son compte d'accès et ses sessions partent avec lui.
     */
    async usage(organismeId, id) {
      const org = requireOrg(organismeId);
      const n = async (sql) => (await db.get(sql, [id])).n;
      return {
        presences: await n('SELECT count(*)::int AS n FROM seance_presences WHERE elu_id = $1'),
        votes: await n('SELECT (SELECT count(*) FROM seance_votes WHERE elu_id = $1) + (SELECT count(*) FROM seance_amendement_votes WHERE elu_id = $1) AS n'),
        pouvoirs: await n('SELECT count(*)::int AS n FROM seance_procurations WHERE mandant_elu_id = $1 OR mandataire_elu_id = $1'),
        actes: await n('SELECT count(*)::int AS n FROM actes WHERE rapporteur_id = $1 OR rapporteur_compl_id = $1'),
        commissions: await n('SELECT count(*)::int AS n FROM commission_membres WHERE elu_id = $1'),
        annotations: await n('SELECT count(*)::int AS n FROM elu_annotations WHERE elu_id = $1'),
        _org: org,
      };
    },
    async remove(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const e = await svc.get(org, id);
      if (e.source === 'hub') throw E.conflict('Élu issu du Hub DSI : il serait recréé à la prochaine synchronisation. Désactivez-le : la désactivation est conservée.');
      const u = await svc.usage(org, id); delete u._org;
      const libelles = { presences: 'présence(s)', votes: 'vote(s)', pouvoirs: 'pouvoir(s)', actes: 'acte(s) comme rapporteur', commissions: 'appartenance(s) à une commission', annotations: 'annotation(s)' };
      const usages = Object.entries(u).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${libelles[k]}`);
      if (usages.length) throw E.conflict(`Cet élu a un historique (${usages.join(', ')}) : désactivez-le plutôt que de le supprimer`);
      await db.run('DELETE FROM elus WHERE id = $1 AND organisme_id = $2', [id, org]);
      await audit.log(ctx, { organismeId: org, action: 'elu.delete', entity: 'elus', entityId: id, before: e });
      return { id };
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
          await db.run('UPDATE elus SET nom = $2, prenom = $3, email = $4, telephone = $5, role = $6, delegation = $7, actif = NOT desactive_manuellement WHERE id = $1', [ex.id, e.nom, e.prenom, e.email, e.telephone, e.role, e.delegation]); updated++;
        } else if (!ex.actif && !ex.desactive_manuellement) { await db.run('UPDATE elus SET actif = true WHERE id = $1', [ex.id]); updated++; }
      }
      const gone = (await db.all("SELECT id, external_id FROM elus WHERE organisme_id = $1 AND source = 'hub' AND actif", [org])).filter((r) => !seen.has(r.external_id));
      for (const g of gone) await db.run('UPDATE elus SET actif = false WHERE id = $1', [g.id]);
      const groupes = await svc.rattacherGroupes(ctx, org);
      await audit.log(ctx, { organismeId: org, action: 'elu.sync', entity: 'elus', after: { created, updated, deactivated: gone.length, ...groupes } });
      log.info({ organisme: org, created, updated, deactivated: gone.length, ...groupes }, 'élus synchronisés depuis le Hub');
      return { created, updated, deactivated: gone.length, total: list.length, ...groupes };
    },

    /**
     * Le Hub DSI saisit le groupe politique d'un élu dans sa colonne « délégation » (« IVRY AVANT TOUT », « Front Populaire… »).
     * Les élus du Hub qui n'ont pas encore de groupe local sont rattachés au groupe de ce nom (créé au besoin : le plus nombreux
     * prend l'ordre 1, c'est la majorité). Un groupe déjà choisi localement n'est JAMAIS écrasé (surcouche locale, CMN-02).
     */
    async rattacherGroupes(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const key = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const elus = await db.all("SELECT id, delegation, groupe_id FROM elus WHERE organisme_id = $1 AND source = 'hub' AND actif AND est_elu AND btrim(COALESCE(delegation, '')) <> ''", [org]);
      const groupes = new Map((await db.all('SELECT id, nom FROM groupes_politiques WHERE organisme_id = $1', [org])).map((g) => [key(g.nom), g.id]));
      const PALETTE = ['#2563EB', '#D97706', '#7C3AED', '#059669', '#DC2626', '#0891B2'];
      const taille = new Map(); for (const e of elus) taille.set(key(e.delegation), (taille.get(key(e.delegation)) || 0) + 1);
      let crees = 0; let rattaches = 0;
      const noms = new Map(); for (const e of elus) if (!noms.has(key(e.delegation))) noms.set(key(e.delegation), e.delegation.trim());
      const ordre = [...noms.keys()].sort((a, b) => taille.get(b) - taille.get(a));
      const next = (await db.get('SELECT COALESCE(max(ordre), 0)::int AS n FROM groupes_politiques WHERE organisme_id = $1', [org])).n;
      for (const k of ordre) {
        if (groupes.has(k)) continue;
        const g = await svc.createGroupe(ctx, org, { nom: noms.get(k), couleur: PALETTE[(next + crees) % PALETTE.length], ordre: next + crees + 1 });
        groupes.set(k, g.id); crees++;
      }
      for (const e of elus) {
        if (e.groupe_id) continue;
        await db.run('UPDATE elus SET groupe_id = $2 WHERE id = $1', [e.id, groupes.get(key(e.delegation))]); rattaches++;
      }
      return { groupesCrees: crees, elusRattaches: rattaches };
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
