const { createTestEnv, loginAs, bearer, adminToken, makePdf } = require('../helpers');

let env; let admin; let ville; let tok;
afterAll(async () => { await env.close(); });

it('l\'aperçu du dossier reste possible si un fichier d\'annexe a disparu du disque (page d\'avertissement)', async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  tok = await loginAs(env, 'dupont', 'pw-dupont');
  const base = `/api/v1/organismes/${ville.id}`;
  const type = (await env.http().get(`${base}/referentiels/type_acte`).set(bearer(tok))).body.items[0];
  const a = (await env.http().post(`${base}/actes`).set(bearer(tok)).send({ typeId: type.id, titre: 'Dossier avec annexe perdue' })).body;
  const up = await env.http().post(`${base}/actes/${a.id}/annexes`).set(bearer(tok)).field('titre', 'Plan').attach('file', await makePdf(2), 'plan.pdf');
  expect(up.status).toBe(201);
  const row = await env.db.get('SELECT f.storage_key FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.acte_id = $1', [a.id]);
  await env.c.storage.remove(row.storage_key); // le fichier disparaît (mauvais dossier de stockage, disque restauré…)
  const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
  const r = await env.http().post(`${base}/actes/${a.id}/apercu`).set(bearer(tok)).send({ cible: 'dossier', mode: 'propre' }).buffer(true).parse(binary);
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toMatch(/pdf/);
  expect(Number(r.headers['x-page-count'])).toBeGreaterThanOrEqual(3); // sommaire + exposé + délibération + page d'avertissement
});
