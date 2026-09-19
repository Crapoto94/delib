const { buildConfig, parseDuration } = require('../../src/config');

const OK = {
  POSTGRES_HOST: 'h', POSTGRES_DB: 'd', POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p',
  APM_API_URL: 'https://apm.test', APM_API_KEY: 'k'.repeat(16),
  HUBDSI_API_URL: 'http://hub.test', HUBDSI_API_KEY: 'k'.repeat(16),
  JWT_SECRET: 's'.repeat(32),
};

describe('configuration', () => {
  it('applique les valeurs par défaut décidées (port 3021, schéma ivrydelib)', () => {
    const c = buildConfig(OK);
    expect(c.port).toBe(3021);
    expect(c.db.schema).toBe('ivrydelib');
    expect(c.jwt.ttlSeconds).toBe(8 * 3600);
  });

  it('échoue explicitement quand une variable obligatoire manque', () => {
    const sansSecret = { ...OK }; delete sansSecret.JWT_SECRET;
    expect(() => buildConfig(sansSecret)).toThrow(/JWT_SECRET/);
    expect(() => buildConfig({ ...OK, APM_API_KEY: undefined })).toThrow(/APM_API_KEY/);
  });

  it('traite une variable vide comme absente', () => {
    expect(() => buildConfig({ ...OK, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });

  it('refuse un secret JWT trop court et un nom de schéma dangereux', () => {
    expect(() => buildConfig({ ...OK, JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
    expect(() => buildConfig({ ...OK, DB_SCHEMA: 'x; DROP SCHEMA public' })).toThrow(/DB_SCHEMA/);
  });

  it('exige CORS_ORIGINS en production', () => {
    expect(() => buildConfig({ ...OK, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(buildConfig({ ...OK, NODE_ENV: 'production', CORS_ORIGINS: 'https://delib.ivry.local' }).corsOrigins).toEqual(['https://delib.ivry.local']);
  });

  it("n'active le compte de secours que si identifiant ET mot de passe sont fournis", () => {
    expect(buildConfig(OK).localAdmin.enabled).toBe(false);
    expect(buildConfig({ ...OK, LOCAL_ADMIN_USERNAME: 'Admin', LOCAL_ADMIN_PASSWORD: 'x' }).localAdmin).toMatchObject({ enabled: true, username: 'admin' });
    expect(buildConfig({ ...OK, LOCAL_ADMIN_ENABLED: 'false', LOCAL_ADMIN_USERNAME: 'a', LOCAL_ADMIN_PASSWORD: 'x' }).localAdmin.enabled).toBe(false);
  });

  it('normalise la liste des administrateurs amorcés en minuscules', () => {
    expect(buildConfig({ ...OK, BOOTSTRAP_ADMINS: ' MDupont , alice ,, ' }).bootstrapAdmins).toEqual(['mdupont', 'alice']);
  });

  it('lit les durées', () => {
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('2d')).toBe(172800);
    expect(parseDuration('90')).toBe(90);
    expect(() => parseDuration('bientôt')).toThrow();
  });
});
