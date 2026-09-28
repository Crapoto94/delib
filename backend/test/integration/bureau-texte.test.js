/**
 * Bureau en ligne — édition externe d'un texte suivi (exposé, « Vu et considérant », délibéré).
 *
 * Le moteur est simulé (`createFakeBureau`) : on vérifie le cycle complet — le document Word fabriqué depuis le
 * markdown, la relecture, la reconversion en markdown, et le refus d'écraser une version modifiée entre-temps.
 */
const JSZip = require('jszip');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { createFakeBureau } = require('../../src/adapters/fake-bureau');
const { markdownVersDocx, docxVersMarkdown } = require('../../src/modules/render/docx.service');

const SECRET = 'secret-partage-bureau-de-test-texte-0123';
const binaire = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
/** Document bureautique minimal portant une police et une taille reconnaissables (comme un texte édité dans Word). */
const docxPolice = async (texte, police) => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="${police}"/><w:sz w:val="28"/></w:rPr><w:t>${texte}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
};

let env; let tok; let admin; let base; let acte; let texte; let moteur;
const as = () => ({ get: (u) => env.http().get(u).set(bearer(tok)), post: (u, b) => env.http().post(u).set(bearer(tok)).send(b), put: (u, b) => env.http().put(u).set(bearer(tok)).send(b) });
const texteURL = () => `${base}/actes/${acte.id}/textes/${texte.id}`;
const propre = async () => (await as().get(`${base}/actes/${acte.id}/textes/${texte.id}`)).body;
const rapport = (cle, statut) => env.http().post('/api/v1/public/bureau/rappel')
  .set({ Authorization: `Bearer ${moteur.signerRappel({ key: cle, status: statut, url: 'http://moteur/fichier', filetype: 'docx' })}` })
  .send();
const ouvrir = async () => (await as().post(`${texteURL()}/ouvrir`, {})).body;

beforeAll(async () => {
  moteur = createFakeBureau({ secret: SECRET });
  env = await createTestEnv({
    bureauPort: { onlyoffice: moteur },
    env: {
      BUREAU_MOTEUR: 'onlyoffice',
      BUREAU_URL: 'http://moteur:8080',
      BUREAU_URL_NAVIGATEUR: '/office',
      BUREAU_URL_RAPPEL: 'http://backend:3121',
      BUREAU_JWT_SECRET: SECRET,
    },
  });
  admin = await adminToken(env);
  const ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  base = `/api/v1/organismes/${ville.id}`;
  tok = await loginAs(env, 'dupont', 'pw-dupont');
  const types = (await as().get(`${base}/referentiels/type_acte`)).body.items;
  const type = types.find((t) => t.meta?.expose !== 'none') || types[0];
  acte = (await as().post(`${base}/actes`, { typeId: type.id, titre: 'Dossier avec texte édité dehors' })).body;
  texte = (await as().get(`${base}/actes/${acte.id}/textes`)).body.items.find((t) => t.kind === 'expose');
  await as().put(`${base}/actes/${acte.id}/textes/${texte.id}`, { markdown: '**Article 1** : vue initiale.', baseVersion: texte.version });
});

afterAll(async () => { await env.close(); });

it('fabrique un vrai document Word à partir du texte et le sert au moteur', async () => {
  const ouverture = await ouvrir();
  expect(ouverture.cle).toMatch(/^[0-9a-f]{32}$/);
  expect(ouverture.config).toMatchObject({ forcesave: true });
  expect(ouverture.nom).toMatch(/\.docx$/);

  const r = await env.http().get(`/api/v1/public/bureau/fichier/${ouverture.cle}`).buffer(true).parse(binaire);
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toMatch(/wordprocessingml/);
  expect(r.body.subarray(0, 2).toString()).toBe('PK');
  expect(await docxVersMarkdown(r.body)).toContain('**Article 1** : vue initiale.');
});

it('enregistre le document rapporté : nouvelle version et markdown reconverti', async () => {
  const ouverture = await ouvrir();
  moteur.armer({ buffer: await markdownVersDocx('Article 1 : vue modifiée dans Word.\n\nVu le code général.') });
  expect((await rapport(ouverture.cle, 2)).body).toEqual({ error: 0 });
  const t = await propre();
  expect(t.version).toBe(ouverture.version + 1);
  expect(t.markdown).toContain('Article 1 : vue modifiée dans Word.');
  expect(t.markdown).toContain('Vu le code général.');
});

it('rouvre le document bureautique enregistré, sans le reconstruire depuis le markdown', async () => {
  const row = await env.db.get('SELECT bureau_file_id FROM tracked_texts WHERE id = $1', [texte.id]);
  expect(row.bureau_file_id).toBeTruthy();                 // le .docx est bien la source enregistrée
  const ouverture = await ouvrir();
  const r = await env.http().get(`/api/v1/public/bureau/fichier/${ouverture.cle}`).buffer(true).parse(binaire);
  const md = await docxVersMarkdown(r.body);
  expect(md).toContain('Article 1 : vue modifiée dans Word.');   // le document rouvert est celui enregistré
});

it('un rappel tardif n’écrase pas une version modifiée entre-temps', async () => {
  const ouverture = await ouvrir();
  const courante = await propre();
  await as().put(texteURL(), { markdown: 'Article 1 : modifié dans l’outil.', baseVersion: courante.version });
  moteur.armer({ buffer: await markdownVersDocx('Article 1 : écrasé depuis Word.') });
  expect((await rapport(ouverture.cle, 2)).body).toEqual({ error: 1 });
  expect((await propre()).markdown).toContain('modifié dans l’outil');
});

it('l’audit retrace l’ouverture externe du texte', async () => {
  const r = await env.db.get('SELECT actor, action, entity, entity_id FROM audit_log WHERE action = $1 ORDER BY id DESC LIMIT 1', ['bureau.ouvrir_texte']);
  expect(r).toMatchObject({ actor: 'dupont', action: 'bureau.ouvrir_texte', entity: 'tracked_texts' });
  expect(Number(r.entity_id)).toBe(texte.id);
});

it('fusionne le document bureautique dans le modèle Word en conservant la police', async () => {
  const ouverture = await ouvrir();
  moteur.armer({ buffer: await docxPolice('TEXTE OFFICE GROS', 'Arial Black') });
  expect((await rapport(ouverture.cle, 2)).body).toEqual({ error: 0 });

  const modele = new JSZip();
  modele.file('[Content_Types].xml', '<Types/>');
  modele.file('word/document.xml', '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>{expose}</w:t></w:r></w:p></w:body></w:document>');
  const up = await env.http().post(`${base}/gabarits/deliberation/docx`).set(bearer(admin)).attach('file', await modele.generateAsync({ type: 'nodebuffer' }), 'modele.docx');
  expect(up.status, JSON.stringify(up.body)).toBe(200);

  const r = await env.http().get(`${base}/actes/${acte.id}/docx`).set(bearer(tok)).query({ docType: 'deliberation' }).buffer(true).parse(binaire);
  expect(r.status).toBe(200);
  const xml = await (await JSZip.loadAsync(r.body)).file('word/document.xml').async('text');
  expect(xml).toContain('TEXTE OFFICE GROS');
  expect(xml).toContain('w:ascii="Arial Black"');
});
