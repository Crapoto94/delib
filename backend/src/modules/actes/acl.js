/**
 * Droits d'accès à un acte (VIS-01 à VIS-06), vérifiés côté serveur à chaque requête.
 *  - administrateur, SCC, lecteur : voient tous les actes de l'organisme (lecture seule pour le lecteur) ;
 *  - rédacteur et co-rédacteurs ;
 *  - participants du circuit : chaque personne du circuit voit l'acte dès l'envoi, avant son tour (VIS-01) ;
 *  - actes du service ou de la direction : PARAMÈTRE GÉNÉRAL de l'organisme (`actes.visibilite` : rédacteur uniquement, service, direction),
 *    modifiable pour chaque utilisateur (D72) — remplace l'ancienne règle « brouillons du service » (VIS-02, D28) ;
 *  - édition : le rédacteur tant que l'acte est brouillon / à modifier ; en circuit, le détenteur de l'étape si elle est
 *    éditable (crochet enregistré par le moteur de circuit).
 */
const EDITABLE = ['brouillon', 'modification_demandee'];
const MODES = ['redacteur', 'service', 'direction'];
const DEFAULT_MODE = 'service';

function createActeAcl({ db, access, titulaires, settings }) {
  const editHooks = [];
  const isStaff = (ctx, orgId) => ctx.isPlatformAdmin || access.rolesIn(ctx, orgId).some((r) => ['org_admin', 'scc', 'lecteur'].includes(r));
  const isAdmin = (ctx, orgId) => ctx.isPlatformAdmin || access.rolesIn(ctx, orgId).some((r) => ['org_admin', 'scc'].includes(r));

  const sameService = (ctx, a) => !!ctx.agent && ctx.agent.direction_code === a.direction_code && (!a.service_code || ctx.agent.service_code === a.service_code);
  const inHierarchy = (h, a) => h.dgaOrganisme || h.directions.includes(a.direction_code) || h.services.some(([d, s]) => d === a.direction_code && s === a.service_code);

  return {
    EDITABLE,
    isAdmin,
    isStaff,
    registerEditHook: (fn) => editHooks.push(fn),

    MODES, DEFAULT_MODE,

    /** Visibilité des actes de l'utilisateur : son réglage personnel s'il existe, sinon le réglage général de l'organisme, sinon « service ». */
    async visibilityMode(ctx, orgId) {
      const mine = await db.get('SELECT visibilite FROM user_acte_visibility WHERE organisme_id = $1 AND username = $2', [orgId, ctx.username]);
      if (mine && MODES.includes(mine.visibilite)) return mine.visibilite;
      const general = (await settings.resolve(orgId))['actes.visibilite']?.value;
      return MODES.includes(general) ? general : DEFAULT_MODE;
    },

    async scope(ctx, orgId) { return { hier: await titulaires.hierarchyScope(ctx.username, orgId), mode: await this.visibilityMode(ctx, orgId) }; },

    async canView(ctx, acte, scope) {
      if (isStaff(ctx, acte.organisme_id)) return true;
      if (acte.redacteur === ctx.username || (acte.co_redacteurs || []).includes(ctx.username)) return true;
      if ((acte.participants || []).includes(ctx.username)) return true;
      const s = scope || await this.scope(ctx, acte.organisme_id);
      if (s.mode === 'direction' && ctx.agent?.direction_code && ctx.agent.direction_code === acte.direction_code) return true;
      if (s.mode === 'service' && sameService(ctx, acte)) return true;
      return inHierarchy(s.hier, acte);
    },

    /** Le rédacteur (ou un co-rédacteur, ou tout le service si la co-édition est activée) modifie tant que l'acte est éditable. */
    async canEdit(ctx, acte) {
      // le rédacteur modifie tant que l'acte est chez lui : brouillon, ou renvoyé à la première étape
      const withDrafter = acte.statut === 'brouillon' || !acte.current_step_key || (acte.trail || [])[0] === acte.current_step_key;
      if (EDITABLE.includes(acte.statut) && withDrafter) {
        if (acte.redacteur === ctx.username || (acte.co_redacteurs || []).includes(ctx.username)) return true;
        if (ctx.isPlatformAdmin || access.rolesIn(ctx, acte.organisme_id).includes('org_admin')) return true;
        if (sameService(ctx, acte) && (await settings.resolve(acte.organisme_id))['redaction.coedition_service']?.value === true) return true;
      }
      for (const hook of editHooks) if (await hook(ctx, acte)) return true;
      return false;
    },

    /** Fragment SQL de visibilité pour les listes (même règle que canView, évaluée en base). */
    async visibilitySql(ctx, orgId, startIndex) {
      if (isStaff(ctx, orgId)) return { where: 'TRUE', params: [] };
      const sc = await this.scope(ctx, orgId); const h = sc.hier;
      const p = []; const or = []; const add = (v) => { p.push(v); return `$${startIndex + p.length - 1}`; };
      const u = add(ctx.username);
      or.push(`a.redacteur = ${u}`, `a.co_redacteurs ? ${u}`, `a.participants ? ${u}`);
      if (ctx.agent?.direction_code && sc.mode === 'direction') or.push(`a.direction_code = ${add(ctx.agent.direction_code)}`);
      else if (ctx.agent?.direction_code && sc.mode === 'service') {
        const d = add(ctx.agent.direction_code); const s = add(ctx.agent.service_code || null);
        or.push(`(a.direction_code = ${d} AND (a.service_code IS NULL OR a.service_code = ${s}))`);
      }
      if (h.dgaOrganisme) or.push('TRUE');
      if (h.directions.length) or.push(`a.direction_code = ANY(${add(h.directions)}::text[])`);
      for (const [d, s] of h.services) or.push(`(a.direction_code = ${add(d)} AND a.service_code = ${add(s)})`);
      return { where: `(${or.join(' OR ')})`, params: p };
    },
  };
}

module.exports = { createActeAcl, EDITABLE, MODES: ['redacteur', 'service', 'direction'] };
