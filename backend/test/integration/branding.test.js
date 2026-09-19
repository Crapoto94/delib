const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

/** PNG 40×20 minimal valide (rouge) fabriqué à la main : pas de fichier de test à versionner. */
function png(w = 40, h = 20) {
  const crc = (buf) => { let c; const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = t[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [200, 30, 30]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let env; let admin; let ville; let tok;
const base = () => `/api/v1/organismes/${ville.id}`;
beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  tok = await loginAs(env, 'dupont', 'pw-dupont');
});
afterAll(async () => { await env.close(); });

describe('identité de l\'organisme : nom, coordonnées, logo', () => {
  it('modifie le nom et les coordonnées (fusionnées, clés inconnues ignorées)', async () => {
    const r = await env.http().put(base()).set(bearer(admin)).send({ nom: 'Ville d\'Ivry-sur-Seine', adresse: '7 esplanade Georges Marrane', contact: { codePostal: '94200', ville: 'Ivry-sur-Seine', telephone: '01 49 60 25 25', signataire: 'Le Maire' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nom: 'Ville d\'Ivry-sur-Seine', adresse: '7 esplanade Georges Marrane', contact: { codePostal: '94200', ville: 'Ivry-sur-Seine' } });
    const r2 = await env.http().put(base()).set(bearer(admin)).send({ contact: { email: 'mairie@ivry94.fr' } });
    expect(r2.body.contact).toMatchObject({ codePostal: '94200', email: 'mairie@ivry94.fr' });
    expect((await env.http().put(base()).set(bearer(tok)).send({ nom: 'Piraté' })).status).toBe(403);
  });

  it('branding public sans logo, puis avec logo : signature vérifiée, jamais l\'extension', async () => {
    expect((await env.http().get('/api/v1/public/branding')).body).toMatchObject({ nom: 'Ville d\'Ivry-sur-Seine', hasLogo: false });
    expect((await env.http().get(`/api/v1/public/organismes/${ville.id}/logo`)).status).toBe(404);
    expect((await env.http().post(`${base()}/logo`).set(bearer(admin)).attach('file', Buffer.from('pas une image'), 'logo.png')).status).toBe(400);
    expect((await env.http().post(`${base()}/logo`).set(bearer(tok)).attach('file', png(), 'logo.png')).status).toBe(403);
    const ok = await env.http().post(`${base()}/logo`).set(bearer(admin)).attach('file', png(), 'logo.png');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ hasLogo: true });
    expect(ok.body.logoVersion).toMatch(/^[0-9a-f]{12}$/);
    const b = (await env.http().get('/api/v1/public/branding')).body;
    expect(b).toMatchObject({ hasLogo: true, organismeId: ville.id, logoVersion: ok.body.logoVersion });
    const img = await env.http().get(`/api/v1/public/organismes/${ville.id}/logo`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.body.subarray(1, 4).toString()).toBe('PNG');
  });

  it('le logo est posé en tête des PDF (sans fond de page) et réserve sa place', async () => {
    const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
    const type = (await env.http().get(`${base()}/referentiels/type_acte`).set(bearer(tok))).body.items[0];
    const a = (await env.http().post(`${base()}/actes`).set(bearer(tok)).send({ typeId: type.id, titre: 'Acte avec logo' })).body;
    const withLogo = await env.http().post(`${base()}/actes/${a.id}/apercu`).set(bearer(tok)).send({ cible: 'expose', mode: 'propre' }).buffer(true).parse(binary);
    expect(withLogo.status).toBe(200);
    const doc = await PDFDocument.load(withLogo.body);
    const xobjects = JSON.stringify(doc.getPage(0).node.Resources()?.lookup?.(require('pdf-lib').PDFName.of('XObject'))?.keys?.().map(String) ?? []);
    expect(xobjects).toMatch(/Image|Im/i);
    // option désactivée : plus d'image
    await env.http().put(`${base()}/gabarits/expose`).set(bearer(admin)).send({ logo: { afficher: false } });
    const without = await env.http().post(`${base()}/actes/${a.id}/apercu`).set(bearer(tok)).send({ cible: 'expose', mode: 'propre' }).buffer(true).parse(binary);
    expect(without.body.length).toBeLessThan(withLogo.body.length);
  });

  it('les coordonnées sont des variables de gabarit', async () => {
    const type = (await env.http().get(`${base()}/referentiels/type_acte`).set(bearer(tok))).body.items[0];
    const a = (await env.http().post(`${base()}/actes`).set(bearer(tok)).send({ typeId: type.id, titre: 'Variables' })).body;
    const vars = await env.c.render.varsFor(await env.db.get('SELECT * FROM actes WHERE id = $1', [a.id]), null);
    expect(vars).toMatchObject({ organisme: 'Ville d\'Ivry-sur-Seine', adresse: '7 esplanade Georges Marrane', ville: 'Ivry-sur-Seine', code_postal: '94200', signataire: 'Le Maire' });
  });

  it('retire le logo', async () => {
    const r = await env.http().delete(`${base()}/logo`).set(bearer(admin));
    expect(r.body.hasLogo).toBe(false);
    expect((await env.http().get('/api/v1/public/branding')).body.hasLogo).toBe(false);
  });
});
