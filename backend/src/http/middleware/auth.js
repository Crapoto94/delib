const jwt = require('jsonwebtoken');
const { E } = require('../../shared/errors');

/**
 * Middlewares d'accès :
 *  - authenticate : JWT valide + session non révoquée et non expirée ; charge le contexte (rôles, organismes) ;
 *  - orgContext : organisme demandé (paramètre :orgId ou en-tête X-Organisme-Id) auquel l'utilisateur doit avoir accès ;
 *  - requireRoles / requirePlatformAdmin : autorisation par rôle dans l'organisme du contexte.
 * L'autorisation est vérifiée CÔTÉ SERVEUR à chaque requête (SEC-02) ; les rôles ne sont jamais lus dans le jeton.
 */
function createAuthMiddleware({ config, sessions, access, organismes }) {
  const authenticate = async (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    if (!token) throw E.unauthorized();
    let claims;
    try { claims = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }); } catch { throw E.unauthorized('Jeton invalide ou expiré'); }
    const s = await sessions.get(claims.jti);
    if (!s || s.revoked_at || s.username !== claims.sub || new Date(s.expires_at) <= new Date()) throw E.unauthorized('Session expirée ou révoquée');
    const ctx = await access.loadContext(claims.sub, s.kind);
    req.ctx = { ...ctx, jti: claims.jti, ip: req.ip };
    next();
  };

  const orgContext = async (req, res, next) => {
    const raw = req.params.orgId ?? req.headers['x-organisme-id'];
    const id = Number(raw);
    if (!raw || !Number.isInteger(id) || id <= 0) throw E.badRequest("Organisme manquant ou invalide (paramètre :orgId ou en-tête X-Organisme-Id)");
    if (!access.canAccess(req.ctx, id)) throw E.forbidden('Accès refusé à cet organisme');
    const org = await organismes.getById(id);
    if (!org) throw E.notFound('Organisme introuvable');
    req.org = org;
    req.orgRoles = access.rolesIn(req.ctx, id);
    next();
  };

  const requirePlatformAdmin = (req, res, next) => {
    if (!req.ctx.isPlatformAdmin) throw E.forbidden('Réservé aux administrateurs de plateforme');
    next();
  };

  const requireRoles = (roles) => (req, res, next) => {
    if (req.ctx.isPlatformAdmin) return next();
    if (!req.orgRoles?.some((r) => roles.includes(r))) throw E.forbidden(`Rôle requis dans cet organisme : ${roles.join(' ou ')}`);
    next();
  };

  return { authenticate, orgContext, requirePlatformAdmin, requireRoles };
}

module.exports = { createAuthMiddleware };
