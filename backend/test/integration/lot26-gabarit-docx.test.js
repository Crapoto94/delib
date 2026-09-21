const JSZip = require('jszip');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

const as = (tok) => ({
  get: (u, q) => env.http().get(u).set(bearer(tok)).query(q || {}),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
/** Téléchargement binaire (supertest ne tamponne pas le corps par défaut). */
const bin = (tok, u, q) => env.http().get(u).set(bearer(tok)).query(q || {}).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });

/** Modèle Word minimal : variables + bloc conditionnel. */
const modeleDocx = async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:r><w:t>{titre}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{IF visas|VU : {visas}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{dispositif}</w:t></w:r></w:p>
  </w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
};
const xmlDe = async (buf) => (await JSZip.loadAsync(buf)).file('word/document.xml').async('text');

let env; let admin; let ville; let t; let acteId;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin, dupont: await loginAs(env, 'dupont', 'pw-dupont') };
  const refs = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  const typeDelib = (await refs('type_acte')).find((x) => x.code === 'deliberation');
  const matiere = (await refs('matiere'))[0]; const rubrique = (await refs('rubrique'))[0];
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Subvention Ivry Sport' })).body;
  acteId = a.id;
  await as(t.dupont).put(`${base()}/actes/${acteId}`, { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1 });
  for (const x of (await as(t.dupont).get(`${base()}/actes/${acteId}/textes`)).body.items) {
    await as(t.dupont).put(`${base()}/actes/${acteId}/textes/${x.id}`, { markdown: x.kind === 'expose' ? 'Il est proposé une subvention.' : x.kind === 'visas' ? 'Vu le CGCT ;' : 'Article 1 : accordé.', baseVersion: x.version });
  }
});
afterAll(async () => { await env.close(); });

describe('gabarit Word (.docx) : dépôt, variables et fusion', () => {
  it('dépose un modèle .docx sur un gabarit et le retélécharge', async () => {
    const r = await env.http().post(`${base()}/gabarits/deliberation/docx`).set(bearer(t.boot)).attach('file', await modeleDocx(), 'modele.docx');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ docType: 'deliberation', docx: true });
    const d = await bin(t.boot, `${base()}/gabarits/deliberation/docx`);
    expect(d.status).toBe(200);
    expect(d.headers['content-type']).toMatch(/wordprocessingml/);
    expect(await xmlDe(d.body)).toContain('{titre}');
  });

  it('liste les variables disponibles', async () => {
    const v = (await as(t.boot).get(`${base()}/gabarits/deliberation/docx/variables`)).body.items;
    expect(v.some((x) => x.nom === '{expose}')).toBe(true);
    expect(v.some((x) => x.nom === '{visas}')).toBe(true);
  });

  it('fusionne le modèle avec les zones de la délibération', async () => {
    const r = await bin(t.boot, `${base()}/actes/${acteId}/docx`, { docType: 'deliberation' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/wordprocessingml/);
    const xml = await xmlDe(r.body);
    expect(xml).toContain('Subvention Ivry Sport');
    expect(xml).toContain('VU : Vu le CGCT ;');
    expect(xml).toContain('Article 1 : accordé.');
  });

  it('refuse la génération quand aucun modèle n’est déposé', async () => {
    const r = await as(t.boot).get(`${base()}/actes/${acteId}/docx`, { docType: 'expose' });
    expect(r.status).toBe(400);
  });

  it('retire le modèle du gabarit', async () => {
    const r = await as(t.boot).del(`${base()}/gabarits/deliberation/docx`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ docx: false });
  });
});
