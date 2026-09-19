const { E } = require('../../shared/errors');
/**
 * Contexte d'accès d'un utilisateur : ses rôles, son agent (cache d'annuaire) et les organismes auxquels il a accès.
 *
 * Un utilisateur accède à un organisme si :
 *   - il est administrateur de plateforme (tous les organismes),
 *   - ou il y détient un rôle explicite (org_admin, scc, teletransmission, lecteur),
 *   - ou sa DIRECTION est rattachée à cet organisme (table organisme_directions) ;
 *     une direction non rattachée relève de l'organisme par défaut (Ville).
 * Aucune visibilité inter-organismes sans l'un de ces liens (MOR-03).
 */
function createAccess(db) {
  const toOrg = (r) => ({
    id: r.id, code: r.code, nom: r.nom, type: r.type, siren: r.siren, actif: r.actif,
    isDefault: r.is_default, couleurs: r.couleurs, vocabulaire: r.vocabulaire,
    hasLogo: !!r.logo_path, logoVersion: r.logo_sha256 ? r.logo_sha256.slice(0, 12) : null,
  });
  // lectures transverses du socle (organismes, rattachements) : hors périmètre d'isolation par organisme
  const sys = (fn) => db.withCtx({ isPlatformAdmin: true }, fn);

  async function accessibleOrganismes({ roles, agent, isPlatformAdmin }) {
    const all = (await db.all('SELECT * FROM organismes ORDER BY nom')).map(toOrg);
    const byId = new Map(all.map((o) => [o.id, { ...o, roles: new Set(), via: new Set() }]));
    const add = (id, via, role) => {
      const o = byId.get(id);
      if (!o) return;
      o.via.add(via);
      if (role) o.roles.add(role);
    };
    if (isPlatformAdmin) all.forEach((o) => add(o.id, 'platform'));
    for (const r of roles) if (r.organisme_id) add(r.organisme_id, 'role', r.role);
    if (agent) {
      const mapped = agent.direction_code
        ? await sys((q) => q.get('SELECT organisme_id FROM organisme_directions WHERE direction_code = $1', [agent.direction_code]))
        : null;
      if (mapped) add(mapped.organisme_id, 'direction');
      else { const def = all.find((o) => o.isDefault); if (def) add(def.id, 'default'); }
    }
    return [...byId.values()]
      .filter((o) => o.via.size > 0 && (o.actif || isPlatformAdmin))
      .map((o) => ({ ...o, roles: [...o.roles], via: [...o.via] }));
  }

  return {
    async loadContext(username, kind = 'ad') {
      const [roles, agent] = await Promise.all([
        db.all('SELECT role, organisme_id FROM user_org_roles WHERE username = $1', [username]),
        db.get('SELECT * FROM agent_ref WHERE username = $1', [username]),
      ]);
      const isPlatformAdmin = roles.some((r) => r.role === 'platform_admin');
      const organismes = await accessibleOrganismes({ roles, agent, isPlatformAdmin });
      return {
        username, kind, agent, isPlatformAdmin, organismes,
        displayName: agent?.display_name || username,
        email: agent?.email || null,
        roles: roles.map((r) => ({ role: r.role, organismeId: r.organisme_id })),
        orgIds: organismes.map((o) => o.id),
      };
    },
  /**
   * Qui peut se faire passer pour qui (audité, D47) :
   *  - administrateur de plateforme : tout agent ;
   *  - administrateur d'organisme : tout agent qui a accès à l'un de SES organismes, sauf administrateur de plateforme ;
   *  - SCC : les agents ordinaires de ses organismes (ni administrateur, ni SCC, ni administrateur de plateforme).
   */
    async actAsTarget(real, username) {
    const adminOrgs = real.roles.filter((r) => ['org_admin', 'scc'].includes(r.role)).map((r) => r.organismeId);
    if (!real.isPlatformAdmin && !adminOrgs.length) throw E.forbidden("« Afficher en tant que » est réservé aux administrateurs et au SCC");
    const target = await this.loadContext(username);
    if (!target.agent && !target.roles.length) throw E.notFound('Utilisateur inconnu');
    if (real.isPlatformAdmin) return target;
    if (target.isPlatformAdmin) throw E.forbidden("Vous ne pouvez pas agir en tant qu'administrateur de plateforme");
    const shared = target.orgIds.filter((id) => real.roles.some((r) => r.organismeId === id && ['org_admin', 'scc'].includes(r.role)));
    if (!shared.length) throw E.forbidden("Cet utilisateur n'appartient à aucun de vos organismes");
    const isOrgAdmin = real.roles.some((r) => r.role === 'org_admin');
    if (!isOrgAdmin && target.roles.some((r) => ['org_admin', 'scc'].includes(r.role))) throw E.forbidden("Le SCC ne peut pas agir en tant qu'administrateur ou que SCC");
    return target;
  },
    canAccess: (ctx, organismeId) => ctx.orgIds.includes(Number(organismeId)),
    /** Rôles détenus dans un organisme (l'administrateur de plateforme est implicitement admin partout). */
    rolesIn: (ctx, organismeId) => [
      ...(ctx.isPlatformAdmin ? ['platform_admin'] : []),
      ...ctx.roles.filter((r) => r.organismeId === Number(organismeId)).map((r) => r.role),
    ],
  };
}

module.exports = { createAccess };
