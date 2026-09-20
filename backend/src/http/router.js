/**
 * Registre de routes. Chaque route déclare, en un seul endroit :
 *   - sa politique d'accès (auth, organisme, rôles, administrateur de plateforme),
 *   - ses schémas de validation zod (params, query, body),
 *   - sa documentation OpenAPI (résumé, tags, réponses).
 * Le middleware est empilé dans le bon ordre et la spécification Swagger est générée depuis ce registre :
 * une route ne peut donc pas exister sans être documentée (critère d'acceptation n°7 du lot 0).
 *
 * spec = {
 *   summary, tags, description?,
 *   auth?: false,                 // true par défaut
 *   elu?: true,                   // jeton d'ÉLU (espace élus) au lieu du jeton d'agent
 *   org?: true,                   // exige un organisme (paramètre :orgId ou en-tête X-Organisme-Id) auquel l'utilisateur a accès
 *   roles?: ['org_admin', ...],   // rôles admis dans cet organisme (l'administrateur de plateforme passe toujours)
 *   platform?: true,              // administrateur de plateforme uniquement
 *   limiter?: middleware,         // limitation de débit
 *   params?, query?, body?: zod,  // validation + schéma de la documentation
 *   responses?: { 201: 'Créé' }   // codes de succès (200 par défaut)
 * }
 */
const express = require('express');
const { validate } = require('./middleware/validate');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function createRouterFactory(mw, registry) {
  return function makeRouter(base) {
    const router = express.Router({ mergeParams: true });
    const api = { router, base };
    for (const method of METHODS) {
      api[method] = (path, spec, ...handlers) => {
        const stack = [];
        if (spec.limiter) stack.push(spec.limiter);
        if (spec.elu) stack.push(mw.authenticateElu); // espace élus : jeton d'élu, jamais un jeton d'agent
        else if (spec.auth !== false) stack.push(mw.authenticate);
        if (spec.org) stack.push(mw.orgContext);
        if (spec.platform) stack.push(mw.requirePlatformAdmin);
        if (spec.roles) stack.push(mw.requireRoles(spec.roles));
        if (spec.params || spec.query || spec.body) stack.push(validate(spec));
        router[method](path, ...stack, ...handlers);
        registry.push({ method, path: (base + path).replace(/\/+$/, '') || '/', spec });
        return api;
      };
    }
    return api;
  };
}

module.exports = { createRouterFactory };
