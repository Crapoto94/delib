const { createTestEnv, bearer, adminToken } = require('../helpers');
const { lire, autorise, DEFAUT } = require('../../src/modules/publication/origines.service');

let env; let admin; let ville;
const regler = async (val) => { await env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key: 'publication.sites_autorises', val }); env.c.origines.oublier(); };

describe('sites autorisés : correspondance des origines', () => {
  const L = DEFAUT;
  it('autorise les sous-domaines et le domaine nu, selon l\'entrée', () => {
    expect(autorise('https://www.ivry94.fr', L)).toBe(true);
    expect(autorise('https://a.b.ivry94.fr', L)).toBe(true);
    expect(autorise('https://ivry94.fr', L)).toBe(true);                       // entrée https://ivry94.fr
    expect(autorise('https://portail.ivry.local', L)).toBe(true);
    expect(autorise('http://portail.ivry.local', L)).toBe(true);               // http admis pour .local
    expect(autorise('https://ivry.local', ['https://*.ivry.local'])).toBe(false);   // « * » ne couvre pas le domaine nu
  });
  it('refuse ce qui n\'est pas listé, y compris les ressemblances et les mauvais protocoles ou ports', () => {
    for (const o of ['https://ivry94.fr.evil.com', 'https://evilivry94.fr', 'https://www.ivry94.fr.evil.com', 'http://www.ivry94.fr', 'https://www.ivry94.fr:8443', 'https://example.org', 'null', 'file://x', 'javascript:alert(1)', '']) {
      expect({ o, ok: autorise(o, L) }).toEqual({ o, ok: false });
    }
    expect(autorise('https://www.ivry94.fr:8443', ['https://*.ivry94.fr:8443'])).toBe(true);
  });
  it('assainit la liste : entrées invalides ignorées, jamais recopiées dans un en-tête', () => {
    const r = lire('https://ivry94.fr\nhttps://*.ivry94.fr; frame-ancestors *\n*\nhttps://x.fr/chemin\n"https://a.fr"\nhttps://ok.fr, HTTPS://OK.fr');
    expect(r.valides).toEqual(['https://ivry94.fr', 'https://*.ivry94.fr', 'https://ok.fr']);      // « ; » sépare : ce qui suit n'est jamais une directive
    expect(r.ignorees).toEqual(expect.arrayContaining(['frame-ancestors', '*', 'https://x.fr/chemin', '"https://a.fr"']));
    expect(r.valides.join(' ')).not.toMatch(/[;'"\s]{2}|frame-ancestors/);
  });
});

describe('sites autorisés : API publique et relais des iframes', () => {
  beforeAll(async () => {
    env = await createTestEnv();
    admin = await adminToken(env);
    ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
    await env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key: 'publication.deliberations_actif', val: true });
    await env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key: 'publication.arretes_actif', val: true });
  });
  afterAll(async () => { await env.close(); });

  it('par défaut : seuls ivry94.fr et ivry.local reçoivent l\'en-tête CORS', async () => {
    for (const u of ['/api/v1/public/deliberations', '/api/v1/public/arretes']) {
      const ok = await env.http().get(u).set('Origin', 'https://www.ivry94.fr');
      expect(ok.status).toBe(200); expect(ok.headers['access-control-allow-origin']).toBe('https://www.ivry94.fr'); expect(ok.headers.vary).toMatch(/Origin/);
      const ko = await env.http().get(u).set('Origin', 'https://site-tiers.example');
      expect(ko.status).toBe(200); expect(ko.headers['access-control-allow-origin']).toBeUndefined();           // lisible par programme, bloqué par le navigateur
      const sans = await env.http().get(u);
      expect(sans.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('la pré-vérification (OPTIONS) suit la même règle', async () => {
    const ok = await env.http().options('/api/v1/public/deliberations').set('Origin', 'http://portail.ivry.local').set('Access-Control-Request-Method', 'GET');
    expect(ok.status).toBe(204); expect(ok.headers['access-control-allow-origin']).toBe('http://portail.ivry.local'); expect(ok.headers['access-control-allow-methods']).toMatch(/GET/);
    const ko = await env.http().options('/api/v1/public/arretes').set('Origin', 'https://site-tiers.example').set('Access-Control-Request-Method', 'GET');
    expect(ko.status).toBe(204); expect(ko.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('le réglage de Paramétrage remplace la liste, sans redémarrage', async () => {
    await regler('https://partenaire.example\nhttps://*.autre.example');
    expect((await env.http().get('/api/v1/public/deliberations').set('Origin', 'https://partenaire.example')).headers['access-control-allow-origin']).toBe('https://partenaire.example');
    expect((await env.http().get('/api/v1/public/deliberations').set('Origin', 'https://www.ivry94.fr')).headers['access-control-allow-origin']).toBeUndefined();
    const fa = await env.http().get('/api/v1/public/publication/origines');
    expect(fa.status).toBe(204); expect(fa.headers['x-frame-ancestors']).toBe('https://partenaire.example https://*.autre.example');
  });

  it('liste vide ou entièrement invalide : aucun site ne peut intégrer (\'self\' seulement)', async () => {
    await regler('n\'importe quoi; frame-ancestors *');
    const fa = await env.http().get('/api/v1/public/publication/origines');
    expect(fa.headers['x-frame-ancestors']).toBe("'self'");
    await regler('');                                                                               // réglage vide : retour à la liste par défaut
    expect((await env.http().get('/api/v1/public/publication/origines')).headers['x-frame-ancestors']).toBe(DEFAUT.join(' '));
  });
});
