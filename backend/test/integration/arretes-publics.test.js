const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let dupont; let ville; let pdf;
const base = () => `/api/v1/organismes/${ville.id}`;
const P = (u = '') => `/api/v1/public/arretes${u}`;
const regler = (key, val) => env.c.settings.put({ username: 'test' }, { scope: 'organisme', organismeId: ville.id, key, val });
const binaire = (u) => env.http().get(u).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

const creer = (champs = {}, annexes = []) => {
  let r = env.http().post(`${base()}/actes/arrete-signe`).set(bearer(dupont));
  const f = { titre: 'Arrêté de fermeture de la rue Truillot', dateSignature: '2026-09-02', numeroArrete: 'AR202609_41', controleLegalite: JSON.stringify({ etat: 'a_transmettre' }), ...champs };
  for (const [k, v] of Object.entries(f)) r = r.field(k, v);
  r = r.attach('arrete', pdf, 'arrete.pdf');
  annexes.forEach((a, i) => { r = r.attach('annexes', pdf, `annexe-${i + 1}.pdf`); });
  return annexes.length ? r.field('annexesTitres', JSON.stringify(annexes)) : r;
};

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  const d = await PDFDocument.create(); d.addPage([200, 200]); pdf = Buffer.from(await d.save());
  expect((await creer({}, ['Plan de circulation'])).status).toBe(201);
  expect((await creer({ titre: 'Arrêté de stationnement place Voltaire', dateSignature: '2024-03-10', numeroArrete: 'AR202403_07' })).status).toBe(201);
  expect((await creer({ titre: 'Arrêté confidentiel individuel', confidentialite: 'confidentiel' })).status).toBe(201);
  // un arrêté qui n'est pas signé (brouillon) ne doit jamais sortir
  const type = (await env.http().get(`${base()}/referentiels/type_acte`).set(bearer(admin))).body.items.find((x) => x.code === 'arrete');
  expect((await env.http().post(`${base()}/actes`).set(bearer(dupont)).send({ typeId: type.id, titre: 'Arrêté en cours de rédaction' })).status).toBe(201);
});
afterAll(async () => { await env.close(); });

describe('arrêtés publics (sans authentification)', () => {
  it('désactivés par défaut', async () => {
    for (const u of ['', '/recherche', '/recherche/filtres', `/f/${'A'.repeat(60)}`]) expect((await env.http().get(P(u))).status).toBe(404);
  });

  it('activés : arrêtés signés non confidentiels, liens chiffrés, annexes, paginés', async () => {
    await regler('publication.arretes_actif', true); await regler('publication.arretes_mois', 1200);
    const r = await env.http().get(P());
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.titre)).toEqual(['Arrêté de fermeture de la rue Truillot', 'Arrêté de stationnement place Voltaire']);   // récent d'abord ; ni brouillon ni confidentiel
    const a = r.body.items[0];
    expect(a).toMatchObject({ numero: 'AR202609_41' }); expect(a.annexes.map((x) => x.titre)).toEqual(['Plan de circulation']);
    expect(JSON.stringify(r.body)).not.toMatch(/"id"|dupont|redacteur/i);
    expect(a.pdf).toMatch(/\/api\/v1\/public\/arretes\/f\/[A-Za-z0-9_-]{30,}$/);
    const doc = await binaire(a.pdf);
    expect(doc.status).toBe(200); expect(doc.headers['content-type']).toMatch(/pdf/); expect(doc.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await binaire(a.annexes[0].url)).status).toBe(200);
    expect((await env.http().get(P('?limit=1&page=2'))).body.items.map((i) => i.titre)).toEqual(['Arrêté de stationnement place Voltaire']);
    expect((await env.http().get(P('?limit=51'))).status).toBe(400);
  });

  it('un lien ne se devine ni ne se forge ; la recherche n’est pas ouverte tant qu’elle n’est pas activée', async () => {
    const a = (await env.http().get(P())).body.items[0];
    const jeton = a.pdf.split('/f/')[1];
    expect((await env.http().get(P(`/f/${jeton.slice(0, -2)}AA`))).status).toBe(404);
    expect((await env.http().get(P('/f/1'))).status).toBe(400);
    expect((await env.http().get(P('/recherche'))).status).toBe(404);
  });

  it('moteur de recherche : texte de l’objet ou numéro, année, dates, sans limite de durée', async () => {
    await regler('publication.arretes_recherche_actif', true); await regler('publication.arretes_actif', false);
    const t = async (q) => (await env.http().get(P(`/recherche${q}`))).body.items?.map((i) => i.titre) ?? [];
    expect(await t('')).toHaveLength(2);
    expect(await t('?q=Voltaire')).toEqual(['Arrêté de stationnement place Voltaire']);
    expect(await t('?q=STATIONNEMENT')).toEqual(['Arrêté de stationnement place Voltaire']);
    expect(await t('?q=AR202609_41')).toEqual(['Arrêté de fermeture de la rue Truillot']);
    expect(await t('?annee=2024')).toEqual(['Arrêté de stationnement place Voltaire']);
    expect(await t('?dateDebut=2026-01-01&dateFin=2026-12-31')).toEqual(['Arrêté de fermeture de la rue Truillot']);
    expect(await t('?q=inconnu')).toEqual([]);
    expect((await env.http().get(P('/recherche?dateDebut=pas-une-date'))).status).toBe(400);
    expect((await env.http().get(P('/recherche/filtres'))).body.annees).toEqual([{ annee: 2026, nb: 1 }, { annee: 2024, nb: 1 }]);
    const a = (await env.http().get(P('/recherche?q=Voltaire'))).body.items[0];
    expect((await binaire(a.pdf)).status).toBe(200);                                       // le document d'un arrêté ancien reste accessible via le moteur
  });

  it('la spécification publique décrit ces routes', async () => {
    const r = await env.http().get('/api/v1/externe/openapi.json');
    expect(Object.keys(r.body.paths)).toEqual(expect.arrayContaining(['/api/v1/public/arretes', '/api/v1/public/arretes/recherche', '/api/v1/public/arretes/recherche/filtres', '/api/v1/public/arretes/f/{jeton}']));
  });
});
