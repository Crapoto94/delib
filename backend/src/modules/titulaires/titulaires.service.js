/**
 * Titulaires (D3, CIR-25) et groupes de valideurs : saisis à la main, propres à chaque organisme.
 *  - fonctions : responsable_intermediaire, chef_service, directeur, dga, dgs ;
 *  - périmètre : organisme, direction ou service ; plus le périmètre est fin, plus il l'emporte ;
 *  - suppléant et dates de validité ;
 *  - modifiables par l'administrateur, et par le directeur / le chef de service pour SON périmètre (D31).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const FONCTIONS = ['responsable_intermediaire', 'chef_service', 'directeur', 'dga', 'dgs'];
const toT = (r) => ({
  id: r.id, organismeId: r.organisme_id, perimetre: r.perimetre, directionCode: r.direction_code, serviceCode: r.service_code,
  fonction: r.fonction, username: r.username, suppleant: r.suppleant, validFrom: r.valid_from, validTo: r.valid_to, createdBy: r.created_by,
});
const today = () => new Date().toISOString().slice(0, 10);

function createTitulaires({ db, audit, access }) {
  const activeSql = "(valid_from IS NULL OR valid_from <= $X) AND (valid_to IS NULL OR valid_to >= $X)";
  const svc = {
    FONCTIONS,

    async list(organismeId, { fonction, directionCode, serviceCode } = {}) {
      const org = requireOrg(organismeId);
      const p = [org]; const w = ['organisme_id = $1'];
      if (fonction) { p.push(fonction); w.push(`fonction = $${p.length}`); }
      if (directionCode) { p.push(directionCode); w.push(`direction_code = $${p.length}`); }
      if (serviceCode) { p.push(serviceCode); w.push(`service_code = $${p.length}`); }
      return (await db.all(`SELECT * FROM titulaires WHERE ${w.join(' AND ')} ORDER BY fonction, direction_code, service_code, username`, p)).map(toT);
    },

    /**
     * Résout un titulaire pour une fonction : service -> direction -> organisme (du plus précis au plus général).
     * Les fonctions de service (responsable intermédiaire, chef de service) ne remontent pas à la direction.
     */
    async resolve(organismeId, fonction, { directionCode, serviceCode } = {}, date = today()) {
      const org = requireOrg(organismeId);
      const rows = await db.all(
        `SELECT * FROM titulaires WHERE organisme_id = $1 AND fonction = $2 AND ${activeSql.replace(/\$X/g, '$3')}`, [org, fonction, date]);
      const pick = (perimetre, pred) => rows.filter((r) => r.perimetre === perimetre && pred(r));
      const serviceLevel = ['responsable_intermediaire', 'chef_service'].includes(fonction);
      const found = pick('service', (r) => r.direction_code === directionCode && r.service_code === serviceCode)
        .concat(serviceLevel ? [] : pick('direction', (r) => r.direction_code === directionCode))
        .concat(serviceLevel ? [] : pick('organisme', () => true));
      return found.map((r) => ({ username: r.username, suppleant: r.suppleant, perimetre: r.perimetre }));
    },

    /** Le directeur d'une direction / le chef d'un service gèrent SON périmètre (D31). */
    async canManage(ctx, organismeId, { directionCode, serviceCode }) {
      if (ctx.isPlatformAdmin || access.rolesIn(ctx, organismeId).includes('org_admin')) return true;
      const mine = await db.all(
        `SELECT * FROM titulaires WHERE organisme_id = $1 AND username = $2 AND fonction IN ('directeur', 'chef_service') AND ${activeSql.replace(/\$X/g, '$3')}`,
        [organismeId, ctx.username, today()]);
      return mine.some((t) => (t.fonction === 'directeur' && t.direction_code === directionCode)
        || (t.fonction === 'chef_service' && t.direction_code === directionCode && serviceCode && t.service_code === serviceCode));
    },

    async add(ctx, organismeId, d) {
      const org = requireOrg(organismeId);
      const perimetre = d.serviceCode ? 'service' : (d.directionCode ? 'direction' : 'organisme');
      if (!(await svc.canManage(ctx, org, d))) throw E.forbidden('Vous ne gérez pas ce périmètre');
      if (perimetre === 'organisme' && !ctx.isPlatformAdmin && !access.rolesIn(ctx, org).includes('org_admin')) throw E.forbidden("Le périmètre « organisme » est réservé à l'administrateur");
      const r = await db.get(
        `INSERT INTO titulaires (organisme_id, perimetre, direction_code, service_code, fonction, username, suppleant, valid_from, valid_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [org, perimetre, d.directionCode || null, d.serviceCode || null, d.fonction, d.username.toLowerCase(), d.suppleant ? d.suppleant.toLowerCase() : null, d.validFrom || null, d.validTo || null, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'titulaire.add', entity: 'titulaires', entityId: r.id, after: toT(r) });
      return toT(r);
    },

    async remove(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const t = await db.get('SELECT * FROM titulaires WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!t) throw E.notFound('Titulaire introuvable');
      if (!(await svc.canManage(ctx, org, { directionCode: t.direction_code, serviceCode: t.service_code }))) throw E.forbidden('Vous ne gérez pas ce périmètre');
      await db.run('DELETE FROM titulaires WHERE id = $1', [id]);
      await audit.log(ctx, { organismeId: org, action: 'titulaire.remove', entity: 'titulaires', entityId: id, before: toT(t) });
    },

    /** Directions et services où l'utilisateur est directeur / chef de service (visibilité des brouillons de sa hiérarchie). */
    async hierarchyScope(username, organismeId) {
      const rows = await db.all(
        `SELECT * FROM titulaires WHERE organisme_id = $1 AND (username = $2 OR suppleant = $2) AND fonction IN ('directeur', 'chef_service', 'dga')
           AND ${activeSql.replace(/\$X/g, '$3')}`, [organismeId, username, today()]);
      return {
        directions: [...new Set(rows.filter((r) => ['directeur', 'dga'].includes(r.fonction)).map((r) => r.direction_code).filter(Boolean))],
        services: rows.filter((r) => r.fonction === 'chef_service').map((r) => [r.direction_code, r.service_code]),
        dgaOrganisme: rows.some((r) => r.fonction === 'dga' && r.perimetre === 'organisme'),
      };
    },

    // ---- groupes de valideurs ----------------------------------------------------------------------------------------
    async groups(organismeId) {
      const org = requireOrg(organismeId);
      const gs = await db.all('SELECT * FROM groupes_valideurs WHERE organisme_id = $1 ORDER BY nom', [org]);
      const ms = await db.all('SELECT m.* FROM groupe_valideurs_membres m JOIN groupes_valideurs g ON g.id = m.groupe_id WHERE g.organisme_id = $1 ORDER BY m.username', [org]);
      return gs.map((g) => ({ id: g.id, code: g.code, nom: g.nom, membres: ms.filter((m) => m.groupe_id === g.id).map((m) => m.username) }));
    },
    async groupMembers(organismeId, code) {
      const r = await db.all(
        `SELECT m.username FROM groupe_valideurs_membres m JOIN groupes_valideurs g ON g.id = m.groupe_id WHERE g.organisme_id = $1 AND g.code = $2 ORDER BY m.username`,
        [requireOrg(organismeId), code]);
      return r.map((x) => x.username);
    },
    async createGroup(ctx, organismeId, { code, nom }) {
      const org = requireOrg(organismeId);
      try {
        const g = await db.get('INSERT INTO groupes_valideurs (organisme_id, code, nom) VALUES ($1,$2,$3) RETURNING *', [org, code, nom]);
        await audit.log(ctx, { organismeId: org, action: 'groupe.create', entity: 'groupes_valideurs', entityId: g.id, after: { code, nom } });
        return { id: g.id, code: g.code, nom: g.nom, membres: [] };
      } catch (e) { if (e.code === '23505') throw E.conflict(`Le groupe « ${code} » existe déjà`); throw e; }
    },
    async setGroupMembers(ctx, organismeId, groupId, usernames) {
      const org = requireOrg(organismeId);
      const g = await db.get('SELECT * FROM groupes_valideurs WHERE id = $1 AND organisme_id = $2', [groupId, org]);
      if (!g) throw E.notFound('Groupe introuvable');
      const list = [...new Set(usernames.map((u) => u.toLowerCase()))];
      const before = await svc.groupMembers(org, g.code);
      await db.tx(async (q) => {
        await q.run('DELETE FROM groupe_valideurs_membres WHERE groupe_id = $1', [groupId]);
        for (const u of list) await q.run('INSERT INTO groupe_valideurs_membres (groupe_id, username) VALUES ($1,$2)', [groupId, u]);
      });
      await audit.log(ctx, { organismeId: org, action: 'groupe.membres', entity: 'groupes_valideurs', entityId: groupId, before: { membres: before }, after: { membres: list } });
      return { id: g.id, code: g.code, nom: g.nom, membres: list };
    },
    async deleteGroup(ctx, organismeId, groupId) {
      const org = requireOrg(organismeId);
      const g = await db.get('DELETE FROM groupes_valideurs WHERE id = $1 AND organisme_id = $2 RETURNING *', [groupId, org]);
      if (!g) throw E.notFound('Groupe introuvable');
      await audit.log(ctx, { organismeId: org, action: 'groupe.delete', entity: 'groupes_valideurs', entityId: groupId, before: { code: g.code } });
    },
  };
  return svc;
}

module.exports = { createTitulaires, FONCTIONS };
