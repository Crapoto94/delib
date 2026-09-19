/** Erreur applicative : porte un statut HTTP et un code stable (corps d'erreur normalisé { error, code }). */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const E = {
  badRequest: (m = 'Requête invalide', d) => new AppError(400, 'BAD_REQUEST', m, d),
  unauthorized: (m = 'Authentification requise') => new AppError(401, 'UNAUTHORIZED', m),
  forbidden: (m = 'Accès refusé') => new AppError(403, 'FORBIDDEN', m),
  notFound: (m = 'Introuvable') => new AppError(404, 'NOT_FOUND', m),
  conflict: (m = 'Conflit', d) => new AppError(409, 'CONFLICT', m, d),
  deadline: (m, details) => new AppError(423, 'DEADLINE_PASSED', m, details),
  tooMany: (m = 'Trop de demandes') => new AppError(429, 'TOO_MANY_REQUESTS', m),
  locked: (m = 'Compte temporairement verrouillé') => new AppError(429, 'LOCKED', m),
  incomplete: (m = 'Dossier incomplet', d) => new AppError(422, 'INCOMPLETE', m, d),
  upstream: (m = 'Service externe indisponible') => new AppError(502, 'UPSTREAM_ERROR', m),
};

module.exports = { AppError, E };
