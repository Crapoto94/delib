/**
 * Utilisateurs et rôles (D41, USR-01 à USR-04) : recherche d'un agent (agents déjà connectés + annuaire RH), fiche avec
 * tous ses accès dans l'organisme, gestion des rôles avec garde-fous (dernier administrateur, rôles de plateforme).
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const toA = (r) => ({
  username: r.username, displayName: r.display_name || r.username, email: r.email, matricule: r.matricule,
  direction: r.direction_code ? { code: r.direction_code, label: r.direction_label } : null, service: r.service_label ? { code: r.service_code, label: r.service_label } : null,
  poste: r.poste, source: r.source, actif: r.actif, lastLoginAt: r.last_login_at, knownLocally: true,
});

function createUsers({ db, audit, dir, organismes, access, log }) {
  const svc = {
    /** Recherche : agents connus localement puis annuaire RH (une panne de l'annuaire n'empêche pas la recherche locale). */
    async search(ctx, organismeId, q, { avecRole = false, limit = 100, offset = 0 } = {}) {
      const org = requireOrg(organismeId);
      const text = (q || '').trim();
      // sans recherche : la liste des agents connus (déjà connectés), éventuellement ceux qui ont un rôle ici
      const where = [text ? '(username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1 OR nom ILIKE $1 OR prenom ILIKE $1)' : 'TRUE'];
      const p = text ? [`%${text.replace(/[%_]/g, '\\$&')}%`] : [];
      if (avecRole) { p.push(org); where.push(`EXISTS (SELECT 1 FROM user_org_roles r WHERE r.username = agent_ref.username AND (r.organisme_id = $${p.length} OR r.organisme_id IS NULL))`); }
      p.push(limit, offset);
      const local = (await db.all(`SELECT * FROM agent_ref WHERE ${where.join(' AND ')} ORDER BY display_name NULLS LAST, username LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).map(toA);
      const seen = new Set(local.map((a) => a.username));
      let remote = [];
      try {
        if (text.length >= 2 && !avecRole) remote = (await dir.searchLogins(text, 20)).filter((a) => !seen.has(a.username))
          .map((a) => ({ username: a.username, displayName: a.displayName, email: a.email, matricule: null, direction: a.direction ? { code: null, label: a.direction } : null, service: a.service ? { code: null, label: a.service } : null, poste: a.poste, source: 'rh', actif: true, lastLoginAt: null, knownLocally: false }));
      } catch (e) { log.warn({ err: e.message }, 'recherche annuaire indisponible : résultats locaux seulement'); }
      const list = [...local, ...remote];
      const roles = list.length ? await db.all('SELECT * FROM user_org_roles WHERE username = ANY($1::text[]) AND (organisme_id = $2 OR organisme_id IS NULL)', [list.map((a) => a.username), org]) : [];
      return list.map((a) => ({
        ...a, roles: roles.filter((r) => r.username === a.username && r.role !== 'platform_admin').map((r) => ({ id: r.id, role: r.role })),
        isPlatformAdmin: roles.some((r) => r.username === a.username && r.role === 'platform_admin'),
      }));
    },

    /** Tout ce que l'utilisateur détient dans l'organisme (USR-03). */
    async fiche(ctx, organismeId, username) {
      const org = requireOrg(organismeId);
      const u = String(username).toLowerCase();
      const agent = await db.get('SELECT * FROM agent_ref WHERE username = $1', [u]);
      if (!agent) throw E.notFound("Cet agent ne s'est jamais connecté à l'application : il n'a pas encore de fiche");
      const uctx = await access.loadContext(u);
      const [roles, titulaires, groupes, autorisations, delegations, redacteur] = await Promise.all([
        db.all('SELECT id, role, organisme_id, created_by, created_at FROM user_org_roles WHERE username = $1 AND (organisme_id = $2 OR organisme_id IS NULL) ORDER BY role', [u, org]),
        db.all('SELECT id, fonction, perimetre, direction_code, service_code FROM titulaires WHERE organisme_id = $1 AND (username = $2 OR suppleant = $2)', [org, u]),
        db.all('SELECT g.code, g.nom FROM groupe_valideurs_membres m JOIN groupes_valideurs g ON g.id = m.groupe_id WHERE g.organisme_id = $1 AND m.username = $2', [org, u]),
        db.all('SELECT id, direction_code, service_code, expires_at FROM redaction_grants WHERE organisme_id = $1 AND username = $2 AND revoked_at IS NULL', [org, u]).catch(() => []),
        db.all('SELECT id, delegant, delegue, scope, ends_at FROM validation_delegations WHERE organisme_id = $1 AND (delegant = $2 OR delegue = $2) AND revoked_at IS NULL', [org, u]),
        db.get("SELECT count(*)::int AS n FROM actes WHERE organisme_id = $1 AND redacteur = $2 AND statut <> 'abandonne'", [org, u]),
      ]);
      return {
        agent: toA(agent), isPlatformAdmin: roles.some((r) => r.role === 'platform_admin'),
        roles: roles.filter((r) => r.role !== 'platform_admin').map((r) => ({ id: r.id, role: r.role, createdBy: r.created_by, createdAt: r.created_at })),
        accessibleOrganismes: uctx.organismes.map((o) => ({ id: o.id, nom: o.nom, via: o.via, roles: o.roles })),
        titulaires: titulaires.map((t) => ({ id: t.id, fonction: t.fonction, perimetre: t.perimetre, directionCode: t.direction_code, serviceCode: t.service_code })),
        groupes, autorisationsRedaction: autorisations.map((g) => ({ id: g.id, directionCode: g.direction_code, serviceCode: g.service_code, expiresAt: g.expires_at })),
        delegations: delegations.map((d) => ({ id: d.id, delegant: d.delegant, delegue: d.delegue, scope: d.scope, endsAt: d.ends_at })), actesRediges: redacteur.n,
      };
    },

    /** Attribue un rôle d'organisme (l'agent doit exister : déjà connecté ou présent dans l'annuaire RH). */
    async grant(ctx, organismeId, username, role) {
      const u = String(username).toLowerCase();
      const known = await db.get('SELECT 1 AS x FROM agent_ref WHERE username = $1', [u]);
      if (!known && !(await dir.agentExists(u))) throw E.badRequest("Agent inconnu : ni connecté à l'application, ni présent dans l'annuaire RH");
      return organismes.addRole(ctx, organismeId, u, role);
    },

    /** Retrait : jamais le dernier administrateur de l'organisme (USR-04). */
    async revoke(ctx, organismeId, roleId) {
      const org = requireOrg(organismeId);
      const r = await db.get('SELECT * FROM user_org_roles WHERE id = $1 AND organisme_id = $2', [roleId, org]);
      if (!r) throw E.notFound('Rôle introuvable dans cet organisme');
      if (r.role === 'org_admin') {
        const n = (await db.get("SELECT count(*)::int AS n FROM user_org_roles WHERE organisme_id = $1 AND role = 'org_admin'", [org])).n;
        const others = (await db.get("SELECT count(*)::int AS n FROM user_org_roles WHERE role = 'platform_admin'")).n;
        if (n <= 1 && !others) throw E.conflict("C'est le dernier administrateur de l'organisme : désignez-en un autre avant de retirer ce rôle");
        if (r.username === ctx.username && !ctx.isPlatformAdmin && n <= 1) throw E.conflict('Vous ne pouvez pas retirer votre propre rôle de dernier administrateur');
      }
      return organismes.removeRole(ctx, org, roleId);
    },
  };
  return svc;
}

module.exports = { createUsers };
