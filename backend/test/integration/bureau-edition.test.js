/**
 * Bureau en ligne : le cycle d'édition complet, du clic de l'agent jusqu'à la version enregistrée.
 *
 * Le moteur est simulé (`createFakeBureau`) : aucun conteneur n'est requis pour ces tests. Ce qui est vérifié ici est
 * ce qui engage l'agent et la collectivité : la version attendue, le refus d'écrasement, le PDF régénéré, la trace.
 */
const { createTestEnv, loginAs, bearer, adminToken, makePdf } = require('../helpers');
const { createFakeBureau } = require('../../src/adapters/fake-bureau');

const SECRET = 'secret-partage-bureau-de-test-0123456789';
const docx = (marqueur) => Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(`fake-docx-${marqueur}`)]);
const binaire = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

let env; let tok; let base; let acte; let annexe; let moteur;
const as = () => ({ get: (u) => env.http().get(u).set(bearer(tok)), post: (u, b) => env.http().post(u).set(bearer(tok)).send(b) });
const versions = async () => (await as().get(`${base}/actes/${acte.id}/annexes/${annexe.id}/versions`)).body.items;
const etat = async () => (await as().get(`${base}/actes/${acte.id}/annexes`)).body.items.find((x) => x.id === annexe.id);

/** Le rappel du moteur est anonyme : le test l'envoie donc comme le moteur, avec son jeton. */
const rappel = (cle, statut, extra = {}) => env.http().post('/api/v1/public/bureau/rappel')
  .set({ Authorization: `Bearer ${moteur.signerRappel({ key: cle, status: statut, url: 'http://moteur/fichier', ...extra })}` })
  .send();

beforeAll(async () => {
  moteur = createFakeBureau({ secret: SECRET, pdf: await makePdf(2) });
  env = await createTestEnv({
    bureauPort: moteur,
    env: {
      BUREAU_MOTEUR: 'onlyoffice',
      BUREAU_URL: 'http://moteur:8080',
      BUREAU_URL_NAVIGATEUR: '/office',
      BUREAU_URL_RAPPEL: 'http://backend:3121',
      BUREAU_JWT_SECRET: SECRET,
    },
  });
  const admin = await adminToken(env);
  const ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  base = `/api/v1/organismes/${ville.id}`;
  tok = await loginAs(env, 'dupont', 'pw-dupont');
  const type = (await as().get(`${base}/referentiels/type_acte`)).body.items[0];
  acte = (await as().post(`${base}/actes`, { typeId: type.id, titre: 'Dossier avec annexe éditable' })).body;
  const up = await env.http().post(`${base}/actes/${acte.id}/annexes`).set(bearer(tok)).field('titre', 'Note de service').attach('file', docx('v1'), 'note.docx');
  expect(up.status).toBe(201);
  annexe = (await as().get(`${base}/actes/${acte.id}/annexes`)).body.items[0];
});

afterAll(async () => { await env.close(); });

it('l’interface sait qu’un bureau existe et pour quels formats', async () => {
  const r = await as().get(`${base}/bureau`);
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ enabled: true, formats: expect.arrayContaining(['docx']) });
});

it('ouvrir une annexe Word rend une configuration d’éditeur servie à l’agent', async () => {
  const r = await as().post(`${base}/actes/${acte.id}/annexes/${annexe.id}/ouvrir`, {});
  expect(r.status).toBe(200);
  expect(r.body.sdk).toMatch(/editeur/);
  expect(r.body.config).toMatchObject({ forcesave: true });
  expect(moteur.journal.filter((j) => j.type === 'ouverture')).toHaveLength(1);
});

it('le moteur récupère le fichier source avec la clé qu’il a reçue, sans session', async () => {
  const cle = (await as().post(`${base}/actes/${acte.id}/annexes/${annexe.id}/ouvrir`, {})).body.config.cle;
  const r = await env.http().get(`/api/v1/public/bureau/fichier/${cle}`).buffer(true).parse(binaire);
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toMatch(/wordprocessingml/);
  expect(r.body.subarray(0, 2).toString()).toBe('PK');
  // une clé inventée ne donne rien
  expect((await env.http().get('/api/v1/public/bureau/fichier/' + '0'.repeat(32))).status).toBe(404);
});

it('un rappel sans jeton, ou avec une clé inconnue, est refusé sans rien écrire', async () => {
  const avant = (await etat()).version;
  const sansJeton = await env.http().post('/api/v1/public/bureau/rappel').send({ key: 'x', status: 2 });
  expect(sansJeton.body).toEqual({ error: 1 });
  const cle = (await as().post(`${base}/actes/${acte.id}/annexes/${annexe.id}/ouvrir`, {})).body.config.cle;
  expect((await rappel('cle-inventee-0000000000000000000', 2)).body).toEqual({ error: 1 });
  expect((await etat()).version).toBe(avant);   // aucune version créée
  expect(cle).toBeTruthy();
});

it('chaque enregistrement dans le même onglet crée une version, et le PDF suit', async () => {
  const cle = (await as().post(`${base}/actes/${acte.id}/annexes/${annexe.id}/ouvrir`, {})).body.config.cle;

  moteur.armer({ buffer: docx('v2') });
  expect((await rappel(cle, 2)).body).toEqual({ error: 0 });
  let a = await etat();
  expect(a.version).toBe(2);
  expect(a.fichier.sha256).toBeTruthy();
  expect(a.pdf).toBeTruthy();                                   // PDF régénéré immédiatement, pas à la validation
  const pdf = await env.db.get('SELECT f.moteur FROM files f WHERE f.id = $1', [a.pdf.id]);
  expect(pdf.moteur).toBe('fake');                              // produit par le même moteur que l'édition

  // deuxième Ctrl+S dans le même onglet : OnlyOffice signale chaque enregistrement, ce n'est pas un conflit
  moteur.armer({ buffer: docx('v3') });
  expect((await rappel(cle, 6)).body).toEqual({ error: 0 });
  expect((await etat()).version).toBe(3);

  // et un enregistrement au contenu identique ne crée pas de version inutile
  expect((await rappel(cle, 6)).body).toEqual({ error: 0 });
  expect((await etat()).version).toBe(3);
});

it('l’historique conserve toutes les versions : l’ancienne reste consultable', async () => {
  const v = await versions();
  expect(v.map((x) => x.version)).toEqual([3, 2, 1]);
  expect(v.every((x) => x.fichier.sha256)).toBe(true);
  expect(v[0].by).toBe('dupont');
});

it('un dépôt manuel pendant l’édition n’est pas écrasé par le rappel suivant', async () => {
  const cle = (await as().post(`${base}/actes/${acte.id}/annexes/${annexe.id}/ouvrir`, {})).body.config.cle;
  const depot = await env.http().put(`${base}/actes/${acte.id}/annexes/${annexe.id}/file`).set(bearer(tok)).attach('file', docx('depose-a-la-main'), 'note.docx');
  expect(depot.status).toBe(200);
  const versionApresDepot = (await etat()).version;
  moteur.armer({ buffer: docx('v4') });
  expect((await rappel(cle, 6)).body).toEqual({ error: 1 });      // refusé : la version attendue n'est plus la bonne
  expect((await etat()).version).toBe(versionApresDepot);        // le dépôt manuel est intact
});

it('un PDF n’a pas de source à rééditer, et un agent sans droit ne l’ouvre pas', async () => {
  const pdf = (await env.http().post(`${base}/actes/${acte.id}/annexes`).set(bearer(tok)).field('titre', 'Arrêté').attach('file', await makePdf(1), 'arrete.pdf')).body;
  const r = await as().post(`${base}/actes/${acte.id}/annexes/${pdf.id}/ouvrir`, {});
  expect(r.status).toBe(400);
  expect(r.body.message).toMatch(/PDF/);

  const martin = await loginAs(env, 'martin', 'pw-martin');       // autre direction, aucun droit sur ce dossier
  const refuse = await env.http().post(`${base}/actes/${acte.id}/annexes/${annexe.id}/ouvrir`).set(bearer(martin)).send({});
  expect([403, 404]).toContain(refuse.status);
});

it('l’audit retrace l’ouverture du document (qui, quelle version, quand)', async () => {
  const r = await env.db.get('SELECT actor, action, entity, entity_id, after FROM audit_log WHERE action = $1 ORDER BY id DESC LIMIT 1', ['bureau.ouvrir']);
  expect(r).toMatchObject({ actor: 'dupont', action: 'bureau.ouvrir', entity: 'annexes' });
  expect(Number(r.entity_id)).toBe(annexe.id);
  expect(r.after).toMatchObject({ format: 'docx' });
});
