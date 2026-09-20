/**
 * Spécification OpenAPI 3 générée depuis le registre de routes (voir router.js) + Swagger UI.
 * Les schémas des corps et des paramètres viennent des schémas zod : documentation et validation ne peuvent pas diverger.
 */
const { z } = require('zod');

const toSchema = (zodSchema) => {
  const s = z.toJSONSchema(zodSchema, { io: 'input', unrepresentable: 'any' });
  delete s.$schema;
  return s;
};

function paramsFromPath(path) {
  return [...path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
}

function queryParams(zodSchema) {
  const s = toSchema(zodSchema);
  const required = new Set(s.required || []);
  return Object.entries(s.properties || {}).map(([name, schema]) => ({ name, in: 'query', required: required.has(name), schema }));
}

function buildSpec(registry, { version = '0.1.0' } = {}) {
  const paths = {};
  for (const { method, path, spec } of registry) {
    const oaPath = path.replace(/:(\w+)/g, '{$1}');
    const success = spec.responses || { 200: 'OK' };
    const responses = {};
    for (const [code, description] of Object.entries(success)) responses[code] = { description };
    responses[400] = { $ref: '#/components/responses/BadRequest' };
    if (spec.auth !== false) {
      responses[401] = { $ref: '#/components/responses/Unauthorized' };
      if (spec.apiKey) responses[429] = { description: 'Limite d\'appels de la clé atteinte' };
      if (spec.org || spec.roles || spec.platform) responses[403] = { $ref: '#/components/responses/Forbidden' };
    }
    const op = {
      summary: spec.summary, description: spec.description, tags: spec.tags || ['divers'],
      security: spec.auth === false ? [] : [{ [spec.apiKey ? 'apiKeyAuth' : 'bearerAuth']: [] }],
      parameters: [...paramsFromPath(path), ...(spec.query ? queryParams(spec.query) : [])],
      responses,
    };
    if (spec.body) op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(spec.body) } } };
    const access = [spec.platform && 'administrateur de plateforme', spec.roles && `rôle : ${spec.roles.join(' | ')} (dans l'organisme)`, spec.org && 'accès à l\'organisme'].filter(Boolean);
    if (access.length) op['x-acces'] = access.join(' ; ');
    (paths[oaPath] = paths[oaPath] || {})[method] = op;
  }
  return {
    openapi: '3.0.3',
    info: { title: 'VibeDélib — API', version, description: 'Gestion des délibérations (lot 0 : fondations). Préfixe /api/v1 ; erreurs normalisées { error, code }.' },
    servers: [{ url: '/' }],
    tags: [],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, apiKeyAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Clé d\'API (vd_xxxxxxxx_…) ; l\'en-tête X-API-Key est aussi accepté' } },
      schemas: { Error: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' }, details: {} }, required: ['error', 'code'] } },
      responses: {
        BadRequest: { description: 'Requête invalide', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Unauthorized: { description: 'Authentification requise ou session expirée', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Forbidden: { description: 'Accès refusé', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}

module.exports = { buildSpec };
