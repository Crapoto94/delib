/**
 * Configuration : lit le .env (sans écraser l'environnement existant), valide, et expose un objet figé.
 * Règle du guide : aucune URL, port, clé ou secret en dur — tout vient de l'environnement.
 * Le démarrage échoue explicitement si une variable obligatoire manque.
 */
const path = require('path');
const { z } = require('zod');

const flag = (def) => z.enum(['true', 'false']).default(def).transform((v) => v === 'true');
const csv = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** « 8h », « 30m », « 2d », « 3600 » (secondes) → secondes. */
function parseDuration(value) {
  const m = /^(\d+)\s*([smhd]?)$/i.exec(String(value).trim());
  if (!m) throw new Error(`Durée invalide : « ${value} » (attendu : 30m, 8h, 2d…)`);
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase()];
  return Number(m[1]) * unit;
}

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3021),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'nom de schéma invalide').default('ivrydelib'),
  APM_API_URL: z.string().url(),
  APM_API_KEY: z.string().min(8),
  HUBDSI_API_URL: z.string().url(),
  HUBDSI_API_KEY: z.string().min(8),
  VILLE_CA_FILE: z.string().optional(),
  VILLE_ALLOW_SELF_SIGNED_CERTS: flag('false'),
  JWT_SECRET: z.string().min(24, 'JWT_SECRET doit faire au moins 24 caractères'),
  JWT_TTL: z.string().default('8h'),
  SESSION_MAX_HOURS: z.coerce.number().positive().default(24),
  BOOTSTRAP_ADMINS: z.string().default(''),
  DEFAULT_ORGANISME_NAME: z.string().default('Ville'),
  LOCAL_ADMIN_ENABLED: flag('true'),
  LOCAL_ADMIN_USERNAME: z.string().optional(),
  LOCAL_ADMIN_PASSWORD: z.string().optional(),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: flag('false'),
  RLS_ENABLED: flag('false'),
  AUTO_MIGRATE: flag('true'),
  DIRECTORY_CACHE_TTL_MIN: z.coerce.number().positive().default(60),
  LOG_LEVEL: z.string().default('info'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  MAIL_REDIRECT_TO: z.string().optional(),
  EMAIL_DOMAIN: z.string().default('ivry94.fr'),
  DEV_LOGIN_PASSWORD: z.string().optional(),
  FONTS_DIR: z.string().optional(),
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  TEAMS_ORGANIZER_UPN: z.string().optional(),
  SCHEDULER_ENABLED: flag('false'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:5160'),
  ANNOTATIONS_KEY: z.string().optional(),
});

function loadEnvFile() {
  const file = process.env.ENV_FILE || path.resolve(__dirname, '../../../.env');
  require('dotenv').config({ path: file, quiet: true }); // n'écrase jamais une variable déjà définie
}

function buildConfig(env = process.env) {
  // Une variable vide (« CLE= ») vaut « absente ».
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const ttlSeconds = parseDuration(e.JWT_TTL);
  const prod = e.NODE_ENV === 'production';
  if (prod && e.DEV_LOGIN_PASSWORD) throw new Error('DEV_LOGIN_PASSWORD (connexion de développement sans AD) est interdit en production.');
  if (prod && !e.CORS_ORIGINS) throw new Error('CORS_ORIGINS est obligatoire en production (jamais « * »).');
  return Object.freeze({
    env: e.NODE_ENV,
    isProd: prod,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    autoMigrate: e.AUTO_MIGRATE,
    rlsEnabled: e.RLS_ENABLED,
    db: Object.freeze({
      host: e.POSTGRES_HOST, port: e.POSTGRES_PORT, database: e.POSTGRES_DB,
      user: e.POSTGRES_USER, password: e.POSTGRES_PASSWORD, schema: e.DB_SCHEMA, poolMax: e.DB_POOL_MAX,
    }),
    apm: Object.freeze({ url: e.APM_API_URL.replace(/\/+$/, ''), key: e.APM_API_KEY }),
    hub: Object.freeze({ url: e.HUBDSI_API_URL.replace(/\/+$/, ''), key: e.HUBDSI_API_KEY }),
    tls: Object.freeze({ caFile: e.VILLE_CA_FILE || null, allowSelfSigned: e.VILLE_ALLOW_SELF_SIGNED_CERTS }),
    jwt: Object.freeze({ secret: e.JWT_SECRET, ttlSeconds, sessionMaxSeconds: Math.round(e.SESSION_MAX_HOURS * 3600) }),
    bootstrapAdmins: csv(e.BOOTSTRAP_ADMINS),
    defaultOrganismeName: e.DEFAULT_ORGANISME_NAME,
    localAdmin: Object.freeze({
      enabled: e.LOCAL_ADMIN_ENABLED && !!e.LOCAL_ADMIN_USERNAME && !!e.LOCAL_ADMIN_PASSWORD,
      username: (e.LOCAL_ADMIN_USERNAME || '').trim().toLowerCase(),
      password: e.LOCAL_ADMIN_PASSWORD || '',
    }),
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    directoryCacheMs: Math.round(e.DIRECTORY_CACHE_TTL_MIN * 60 * 1000),
    storage: Object.freeze({ dir: path.resolve(path.resolve(__dirname, '../..'), e.STORAGE_DIR), // relatif au dossier backend, JAMAIS au dossier de lancement (sinon deux processus lancés de dossiers différents ne voient pas les mêmes fichiers)
       maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024) }),
    mailRedirectTo: e.MAIL_REDIRECT_TO || null,
    fontsDir: e.FONTS_DIR ? path.resolve(e.FONTS_DIR) : path.resolve(__dirname, '../../../police'),
    teams: Object.freeze({ tenant: e.GRAPH_TENANT_ID || null, clientId: e.GRAPH_CLIENT_ID || null, secret: e.GRAPH_CLIENT_SECRET || null, organizer: e.TEAMS_ORGANIZER_UPN || null }),
    devLoginPassword: e.DEV_LOGIN_PASSWORD || null,
    emailDomain: e.EMAIL_DOMAIN.replace(/^@/, ''),
    schedulerEnabled: e.SCHEDULER_ENABLED,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    annotationsKey: e.ANNOTATIONS_KEY || null,
  });
}

function loadConfig() {
  loadEnvFile();
  return buildConfig(process.env);
}

module.exports = { loadConfig, buildConfig, parseDuration };
