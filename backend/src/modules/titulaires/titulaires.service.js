/**
 * Titulaires (D3, CIR-25) et groupes de valideurs : saisis à la main, propres à chaque organisme.
 *  - fonctions : responsable_intermediaire, chef_service, directeur, dga, dgs ;
 *  - périmètre : organisme, direction ou service ; plus le périmètre est fin, plus il l'emporte ;
 *  - suppléant et dates de validité ;
 *  - POSTE VACANT : un titulaire « vacant » n'a pas de personne, l'étape du circuit est contournée automatiquement (D67) ;
 *  - RATTACHEMENT DES DIRECTIONS : chaque direction relève d'un DGA (ou directement de la DGS), choix d'organisation défini ici (D66) ;
 *  - un service qui porte le nom de sa direction (ou l'absence de service) : le responsable de service est le directeur (D68) ;
 *  - modifiables par l'administrateur, et par le directeur / le chef de service pour SON périmètre (D31).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const FONCTIONS = ['responsable_intermediaire', 'chef_service', 'directeur', 'dga', 'dgs'];
const toT = (r) => ({
  id: r.id, organismeId: r.organisme_id, perimetre: r.perimetre, directionCode: r.direction_code, serviceCode: r.service_code,
  fonction: r.fonction, username: r.username, suppleant: r.suppleant, vacant: !!r.vacant, validFrom: r.valid_from, validTo: r.valid_to, createdBy: r.created_by,
});
const today = () => new Date().toISOString().slice(0, 10);

function createTitulaires({ db, audit, access }) {
  let rhVacancy = null; // (directionCode, serviceCode) -> { direction, service } d'après l'organigramme RH (branché par le conteneur)
  const activeSql = "(valid_from IS NULL OR valid_from <= $X) AND (valid_to IS NULL OR valid_to >= $X)";
  const svc = {
    FONCTIONS,
    setRhVacancy(fn) { rhVacancy = fn; },

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
      return found.filter((r) => !r.vacant).map((r) => ({ username: r.username, suppleant: r.suppleant, perimetre: r.perimetre }));
    },

    /** Données de résolution de l'organisme, chargées UNE fois : titulaires actifs, postes de DGA, rattachements des directions. */
    async loadResolution(organismeId, date = today()) {
      const org = requireOrg(organismeId);
      const [rows, postes, rts] = await Promise.all([
        db.all(`SELECT * FROM titulaires WHERE organisme_id = $1 AND ${activeSql.replace(/\$X/g, '$2')}`, [org, date]),
        db.all('SELECT * FROM dga_postes WHERE organisme_id = $1', [org]),
        db.all('SELECT * FROM direction_rattachements WHERE organisme_id = $1', [org]),
      ]);
      return { rows, postes: new Map(postes.map((x) => [x.id, x])), rts: new Map(rts.map((x) => [x.direction_code, x])) };
    },

    /**
     * Qui valide pour une fonction, EN MÉMOIRE (aucune requête) avec les cas particuliers de l'organisation :
     *   { holders: [identifiants], vacant: bool, direct: 'dgs' | null, via: 'directeur' | 'rattachement' | 'rh' | null, poste: libellé du poste de DGA | null }
     *  - DGA : selon le rattachement de la direction — poste de DGA (personne ou poste vacant) ou directement la DGS ; un DGA encadre
     *    plusieurs directions et répond toujours à la DGS ; à défaut de rattachement, titulaires « dga » (D66) ;
     *  - chef de service d'un service qui porte le nom de sa direction (ou sans service) : le directeur (D68) ;
     *  - poste déclaré vacant (titulaire « vacant »), ou vacant dans l'organigramme RH quand personne n'est désigné (D67).
     * `rhv(directionCode, serviceCode)` -> { direction, service } | null : vacance d'après l'organigramme RH.
     */
    resolveIn(data, fonction, { directionCode, serviceCode, serviceSameAsDirection = false } = {}, rhv = null) {
      if (fonction === 'dga' && directionCode) {
        const rt = data.rts.get(directionCode);
        if (rt?.rattachement === 'dgs') return { holders: [], vacant: false, direct: 'dgs', via: 'rattachement', poste: null };
        if (rt?.rattachement === 'dga') {
          const p = data.postes.get(rt.dga_poste_id);
          if (p?.vacant) return { holders: [], vacant: true, direct: null, via: 'rattachement', poste: p.libelle };
          if (p) return { holders: [p.username, p.suppleant].filter(Boolean), vacant: false, direct: null, via: 'rattachement', poste: p.libelle };
        }
      }
      if (fonction === 'chef_service' && (serviceSameAsDirection || !serviceCode)) {
        const r = svc.resolveIn(data, 'directeur', { directionCode }, rhv);
        return { ...r, via: r.via || 'directeur' };
      }
      const serviceLevel = ['responsable_intermediaire', 'chef_service'].includes(fonction);
      const found = data.rows.filter((r) => r.fonction === fonction && ((r.perimetre === 'service' && r.direction_code === directionCode && r.service_code === serviceCode)
        || (!serviceLevel && r.perimetre === 'direction' && r.direction_code === directionCode) || (!serviceLevel && r.perimetre === 'organisme')));
      const persons = found.filter((r) => !r.vacant);
      if (persons.length) return { holders: persons.flatMap((r) => [r.username, r.suppleant]).filter(Boolean), vacant: false, direct: null, via: null, poste: null };
      if (found.some((r) => r.vacant)) return { holders: [], vacant: true, direct: null, via: null, poste: null };
      if (rhv && ['directeur', 'chef_service'].includes(fonction)) {
        const v = rhv(directionCode, serviceCode);
        if (fonction === 'directeur' ? v?.direction : v?.service) return { holders: [], vacant: true, direct: null, via: 'rh', poste: null };
      }
      return { holders: [], vacant: false, direct: null, via: null, poste: null };
    },

    /** Idem `resolveIn`, pour une fonction et un périmètre (chargement des données compris). */
    async resolveFor(organismeId, fonction, scope = {}, date = today()) {
      const data = await svc.loadResolution(organismeId, date);
      let rhv = null;
      if (rhVacancy && ['directeur', 'chef_service'].includes(fonction)) {
        try { const v = await rhVacancy(scope.directionCode, scope.serviceCode); rhv = () => v; } catch { /* organigramme indisponible : on ne présume pas la vacance */ }
      }
      return svc.resolveIn(data, fonction, scope, rhv);
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
      if (d.vacant && d.username) throw E.badRequest('Un poste vacant n\'a pas de titulaire : retirez l\'agent ou décochez « vacant »');
      if (!d.vacant && !d.username) throw E.badRequest('Désignez un agent, ou déclarez le poste vacant');
      if (d.vacant && d.fonction === 'dgs') throw E.badRequest('Le poste de DGS ne peut pas être déclaré vacant : la validation DGS n\'est jamais contournée');
      const r = await db.get(
        `INSERT INTO titulaires (organisme_id, perimetre, direction_code, service_code, fonction, username, suppleant, vacant, valid_from, valid_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [org, perimetre, d.directionCode || null, d.serviceCode || null, d.fonction, d.vacant ? null : d.username.toLowerCase(), !d.vacant && d.suppleant ? d.suppleant.toLowerCase() : null, !!d.vacant, d.validFrom || null, d.validTo || null, ctx.username]);
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
      const rattachees = (await db.all(`SELECT r.direction_code FROM direction_rattachements r JOIN dga_postes p ON p.id = r.dga_poste_id WHERE r.organisme_id = $1 AND (p.username = $2 OR p.suppleant = $2)`, [organismeId, username])).map((r) => r.direction_code);
      return {
        directions: [...new Set([...rows.filter((r) => ['directeur', 'dga'].includes(r.fonction)).map((r) => r.direction_code).filter(Boolean), ...rattachees])],
        services: rows.filter((r) => r.fonction === 'chef_service').map((r) => [r.direction_code, r.service_code]),
        dgaOrganisme: rows.some((r) => r.fonction === 'dga' && r.perimetre === 'organisme'),
      };
    },

    // ---- postes de DGA et rattachement des directions (D66) ----------------------------------------------------------
    /** Postes de DGA avec les directions qu'ils encadrent. */
    async postes(organismeId) {
      const org = requireOrg(organismeId);
      const [ps, rts] = await Promise.all([db.all('SELECT * FROM dga_postes WHERE organisme_id = $1 ORDER BY libelle', [org]), db.all('SELECT direction_code, dga_poste_id FROM direction_rattachements WHERE organisme_id = $1 AND dga_poste_id IS NOT NULL ORDER BY direction_code', [org])]);
      return ps.map((p) => ({ id: p.id, libelle: p.libelle, username: p.username, suppleant: p.suppleant, vacant: p.vacant, directions: rts.filter((r) => r.dga_poste_id === p.id).map((r) => r.direction_code) }));
    },
    async rattachements(organismeId) {
      const rows = await db.all('SELECT * FROM direction_rattachements WHERE organisme_id = $1 ORDER BY direction_code', [requireOrg(organismeId)]);
      return rows.map((r) => ({ directionCode: r.direction_code, rattachement: r.rattachement, dgaPosteId: r.dga_poste_id, updatedBy: r.updated_by, updatedAt: r.updated_at }));
    },
    _admin(ctx, org) { if (!ctx.isPlatformAdmin && !access.rolesIn(ctx, org).includes('org_admin')) throw E.forbidden("L'organisation des DGA est réservée à l'administrateur"); },
    _poste(b) {
      if (b.vacant && b.username) throw E.badRequest("Un poste vacant n'a pas de titulaire");
      if (!b.vacant && !b.username) throw E.badRequest('Désignez le DGA, ou déclarez le poste vacant');
      return { username: b.vacant ? null : String(b.username).trim().toLowerCase(), suppleant: !b.vacant && b.suppleant ? String(b.suppleant).trim().toLowerCase() : null, vacant: !!b.vacant };
    },
    async createPoste(ctx, organismeId, b) {
      const org = requireOrg(organismeId); svc._admin(ctx, org);
      const v = svc._poste(b);
      try {
        const p = await db.get('INSERT INTO dga_postes (organisme_id, libelle, username, suppleant, vacant, updated_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [org, b.libelle.trim(), v.username, v.suppleant, v.vacant, ctx.username]);
        await audit.log(ctx, { organismeId: org, action: 'dga.poste.create', entity: 'dga_postes', entityId: p.id, after: { libelle: p.libelle, username: p.username, vacant: p.vacant } });
        return { id: p.id, libelle: p.libelle, username: p.username, suppleant: p.suppleant, vacant: p.vacant, directions: [] };
      } catch (e) { if (e.code === '23505') throw E.conflict(`Un poste de DGA « ${b.libelle} » existe déjà`); throw e; }
    },
    async updatePoste(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId); svc._admin(ctx, org);
      const before = await db.get('SELECT * FROM dga_postes WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!before) throw E.notFound('Poste de DGA introuvable');
      const v = svc._poste(b);
      try {
        await db.run('UPDATE dga_postes SET libelle = $3, username = $4, suppleant = $5, vacant = $6, updated_by = $7, updated_at = now() WHERE id = $1 AND organisme_id = $2', [id, org, (b.libelle || before.libelle).trim(), v.username, v.suppleant, v.vacant, ctx.username]);
      } catch (e) { if (e.code === '23505') throw E.conflict(`Un poste de DGA « ${b.libelle} » existe déjà`); throw e; }
      await audit.log(ctx, { organismeId: org, action: 'dga.poste.update', entity: 'dga_postes', entityId: id, before: { username: before.username, vacant: before.vacant }, after: { username: v.username, vacant: v.vacant } });
      return (await svc.postes(org)).find((p) => p.id === id);
    },
    async deletePoste(ctx, organismeId, id) {
      const org = requireOrg(organismeId); svc._admin(ctx, org);
      const n = (await db.get('SELECT count(*)::int AS n FROM direction_rattachements WHERE dga_poste_id = $1', [id])).n;
      if (n) throw E.conflict(`Ce poste encadre encore ${n} direction(s) : rattachez-les d'abord à un autre poste ou à la DGS`);
      const r = await db.get('DELETE FROM dga_postes WHERE id = $1 AND organisme_id = $2 RETURNING libelle', [id, org]);
      if (!r) throw E.notFound('Poste de DGA introuvable');
      await audit.log(ctx, { organismeId: org, action: 'dga.poste.delete', entity: 'dga_postes', entityId: id, before: { libelle: r.libelle } });
    },

    /** Rattache une direction à un poste de DGA ou directement à la DGS ; `rattachement: null` retire le rattachement. */
    async setRattachement(ctx, organismeId, directionCode, b) {
      const org = requireOrg(organismeId); svc._admin(ctx, org);
      const before = (await svc.rattachements(org)).find((r) => r.directionCode === directionCode) || null;
      if (!b.rattachement) {
        await db.run('DELETE FROM direction_rattachements WHERE organisme_id = $1 AND direction_code = $2', [org, directionCode]);
        await audit.log(ctx, { organismeId: org, action: 'direction.rattachement.retrait', entity: 'direction_rattachements', entityId: directionCode, before });
        return null;
      }
      if (b.rattachement === 'dga') {
        if (!b.dgaPosteId) throw E.badRequest('Choisissez le poste de DGA de cette direction');
        if (!(await db.get('SELECT 1 AS x FROM dga_postes WHERE id = $1 AND organisme_id = $2', [b.dgaPosteId, org]))) throw E.badRequest('Poste de DGA inconnu');
      }
      await db.run(
        `INSERT INTO direction_rattachements (organisme_id, direction_code, rattachement, dga_poste_id, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organisme_id, direction_code) DO UPDATE SET rattachement = EXCLUDED.rattachement, dga_poste_id = EXCLUDED.dga_poste_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [org, directionCode, b.rattachement, b.rattachement === 'dga' ? b.dgaPosteId : null, ctx.username]);
      const after = (await svc.rattachements(org)).find((r) => r.directionCode === directionCode);
      await audit.log(ctx, { organismeId: org, action: 'direction.rattachement', entity: 'direction_rattachements', entityId: directionCode, before, after });
      return after;
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
