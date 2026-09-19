const { E } = require('../../shared/errors');

/**
 * Valide params, query et body avec zod. Les données validées (et converties) sont exposées dans req.valid :
 * en Express 5, req.query est en lecture seule, on ne le réécrit donc jamais.
 */
function validate(schemas) {
  return (req, res, next) => {
    req.valid = req.valid || {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const r = schemas[part].safeParse(req[part] ?? {});
      if (!r.success) {
        return next(E.badRequest('Requête invalide', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
      }
      req.valid[part] = r.data;
    }
    next();
  };
}

module.exports = { validate };
