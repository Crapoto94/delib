const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { rateLimit } = require('express-rate-limit');
const { createRouterFactory } = require('./router');
const { createAuthMiddleware } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');
const { buildSpec } = require('./swagger');
const pkg = require('../../package.json');

const MODULES = [
  require('../modules/health/status.routes'),
  require('../modules/auth/auth.routes'),
  require('../modules/me/me.routes'),
  require('../modules/organismes/organismes.routes'),
  require('../modules/settings/settings.routes'),
  require('../modules/directory/directory.routes'),
  require('../modules/audit/audit.routes'),
  require('../modules/referentiels/referentiels.routes'),
  require('../modules/titulaires/titulaires.routes'),
  require('../modules/redaction/redaction.routes'),
  require('../modules/actes/actes.routes'),
  require('../modules/annexes/annexes.routes'),
  require('../modules/comments/comments.routes'),
  require('../modules/textes/textes.routes'),
  require('../modules/render/render.routes'),
  require('../modules/circuit/workflow.routes'),
  require('../modules/circuit/circuits.routes'),
  require('../modules/circuit/delegations.routes'),
  require('../modules/notifications/notifications.routes'),
  require('../modules/elus/elus.routes'),
  require('../modules/commissions/commissions.routes'),
  require('../modules/seances/seances.routes'),
  require('../modules/seances/odj.routes'),
  require('../modules/seances/cahier.routes'),
  require('../modules/seances/kpis.routes'),
  require('../modules/convocations/convocations.routes'),
  require('../modules/users/users.routes'),
  require('../modules/ai/ai.routes'),
];

function createApp(c) {
  const { config, log } = c;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // Swagger UI charge ses propres scripts : sa CSP est assouplie, celle des routes d'API reste stricte.
  app.use('/api-docs', helmet({ contentSecurityPolicy: false }));
  app.use(helmet());

  // CORS restreint aux origines connues, jamais « * » (guide §6). Sans origine (appel serveur à serveur) : autorisé.
  const origins = config.corsOrigins.length ? config.corsOrigins : (config.isProd ? [] : ['http://localhost:5160']);
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)), credentials: false, maxAge: 600 }));

  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const t = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/status') return;
      log.info({ reqId: req.id, method: req.method, url: req.path, status: res.statusCode, ms: Date.now() - t, user: req.ctx?.username }, 'requête');
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const mw = createAuthMiddleware({ config, sessions: c.sessions, access: c.access, organismes: c.organismes });
  const registry = [];
  const makeRouter = createRouterFactory(mw, registry);
  const limiter = config.env === 'test' ? (req, res, next) => next()
    : rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes', code: 'TOO_MANY_REQUESTS' } });

  for (const register of MODULES) {
    for (const api of register({ ...c, makeRouter, limiter })) app.use(api.base, api.router);
  }

  const spec = buildSpec(registry, { version: pkg.version });
  app.get('/swagger.json', (req, res) => res.json(spec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'VibeDélib — API' }));

  app.use(notFound);
  app.use(errorHandler(log));
  app.locals.registry = registry;
  app.locals.spec = spec;
  return app;
}

module.exports = { createApp };
