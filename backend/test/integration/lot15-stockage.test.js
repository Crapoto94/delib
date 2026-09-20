const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { createStorage } = require('../../src/shared/infra');

let env; let admin; let ville; let t; let acte;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const G = (p = '') => `${base()}/ged${p}`;
let n = 0;
const pdf = async () => { const d = await PDFDocument.create(); d.addPage([300, 300]).drawText(`Annexe ${++n}`, { x: 20, y: 200, size: 14 }); return Buffer.from(await d.save()); };
const annexe = async (titre) => {
  const ctx = await env.c.access.loadContext('dupont'); const buf = await pdf();
  const a = await env.c.annexes.add(ctx, ville.id, acte.id, { titre, communicable: true }, { buffer: buf, originalname: `${titre}.pdf`, size: buf.length, mimetype: 'application/pdf' });
  return { id: a.id, fichierId: a.fichier.id, buf };
};
const cleF = async (fichierId) => (await env.db.get('SELECT storage_key FROM files WHERE id = $1', [fichierId])).storage_key;
const attendreMigration = async () => { await env.c.ged.idle(); };

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { dupont: await loginAs(env, 'dupont', 'pw-dupont') };
  const type = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  acte = (await as(t.dupont).post(`${base()}/actes`, { typeId: type.id, titre: 'Dossier de test du stockage' })).body;
});
afterAll(async () => { await env.close(); });

describe('Alfresco comme stockage des fichiers (GED-09, GED-10)', () => {
  let local1; let local2;

  it('par défaut, les fichiers restent sur le volume local ; réglage réservé à l’administrateur', async () => {
    expect((await as(t.dupont).get(G('/stockage'))).status).toBe(403);
    const e = (await as(admin).get(G('/stockage'))).body;
    expect(e).toMatchObject({ stockage: 'local', gedActive: false, migration: null });
    local1 = await annexe('Locale une'); local2 = await annexe('Locale deux');
    expect(await cleF(local1.fichierId)).not.toMatch(/^alf:/);
    expect((await as(admin).get(G('/stockage'))).body.fichiers.local).toBeGreaterThanOrEqual(2);
  });

  it('bascule refusée tant que la GED n’est pas active ; acceptée quand l’écriture / relecture réussit ; la sonde ne laisse rien', async () => {
    expect((await as(admin).put(G('/config'), { stockage: 'alfresco' })).status).toBe(400);
    expect((await as(admin).put(G('/config'), { mode: 'simulation', actif: true, stockage: 'alfresco' })).status).toBe(200);
    expect((await as(admin).get(G('/config'))).body.stockage).toBe('alfresco');
    expect(await env.db.get("SELECT count(*)::int AS n FROM ged_sim_nodes WHERE nom LIKE 'sonde-%'")).toEqual({ n: 0 });
    expect(await env.db.get("SELECT count(*)::int AS n FROM audit_log WHERE action = 'ged.stockage'")).toEqual({ n: 1 });
  });

  it('les nouveaux fichiers vont en GED (clé alf:, dossier technique), se relisent, y compris sans cache ; les anciens restent lisibles', async () => {
    const a = await annexe('En GED');
    const cle = await cleF(a.fichierId);
    expect(cle).toMatch(/^alf:\d+:[0-9a-f-]{36}$/);
    const noeud = await env.db.get('SELECT nom, parent_id FROM ged_sim_nodes WHERE id = $1', [cle.split(':')[2]]);
    expect(noeud.nom).toMatch(/\.pdf$/);
    const parent = await env.db.get('SELECT nom, parent_id FROM ged_sim_nodes WHERE id = $1', [noeud.parent_id]);
    const an = await env.db.get('SELECT nom FROM ged_sim_nodes WHERE id = $1', [parent.parent_id]);
    const dossier = await env.db.get('SELECT nom FROM ged_sim_nodes WHERE id = $1', [(await env.db.get('SELECT parent_id FROM ged_sim_nodes WHERE id = $1', [parent.parent_id])).parent_id]);
    expect(dossier.nom).toBe('90 Stockage applicatif'); expect(an.nom).toMatch(/^\d{4}$/); expect(parent.nom).toMatch(/^\d{2}$/);
    expect(Buffer.from(await env.c.storage.get(cle)).equals(a.buf)).toBe(true);
    fs.rmSync(path.join(env.config.storage.dir, '.cache-alfresco'), { recursive: true, force: true });   // sans cache : relecture en GED
    expect(Buffer.from(await env.c.storage.get(cle)).equals(a.buf)).toBe(true);
    expect(await env.c.storage.exists(cle)).toBe(true);
    expect(Buffer.from(await env.c.storage.get(await cleF(local1.fichierId))).equals(local1.buf)).toBe(true); // coexistence
    const ctx = await env.c.access.loadContext('dupont');
    expect(Buffer.from((await env.c.annexes.content(ctx, ville.id, acte.id, a.id)).buffer).equals(a.buf)).toBe(true); // via l'application
  });

  it('migration local → Alfresco en arrière-plan : rejouable, source conservée par défaut', async () => {
    const avant = (await as(admin).get(G('/stockage'))).body.fichiers;
    expect((await as(admin).post(G('/stockage/migration'), { sens: 'vers_local' })).status).toBe(409); // le stockage courant est Alfresco
    const r = await as(admin).post(G('/stockage/migration'), { sens: 'vers_alfresco' });
    expect(r.status).toBe(202); expect(r.body).toMatchObject({ demarre: true, total: avant.local });
    await attendreMigration();
    const apres = (await as(admin).get(G('/stockage'))).body;
    expect(apres.fichiers.local).toBe(0); expect(apres.fichiers.alfresco).toBe(avant.alfresco + avant.local);
    expect(apres.migration).toMatchObject({ sens: 'vers_alfresco', enCours: false, echecs: 0, faits: avant.local });
    expect(Buffer.from(await env.c.storage.get(await cleF(local1.fichierId))).equals(local1.buf)).toBe(true);
    expect(await cleF(local1.fichierId)).toMatch(/^alf:/);
    expect((await as(admin).post(G('/stockage/migration'), { sens: 'vers_alfresco' })).body.total).toBe(0);  // rien à refaire
    await attendreMigration();
  });

  it('retour au stockage local : nouveaux fichiers en local, migration Alfresco → local, source supprimée sur demande', async () => {
    expect((await as(admin).put(G('/config'), { stockage: 'local' })).status).toBe(200);
    const b = await annexe('Retour local');
    expect(await cleF(b.fichierId)).not.toMatch(/^alf:/);
    const r = await as(admin).post(G('/stockage/migration'), { sens: 'vers_local', supprimerSource: true });
    expect(r.status).toBe(202);
    await attendreMigration();
    const e = (await as(admin).get(G('/stockage'))).body;
    expect(e.fichiers.alfresco).toBe(0); expect(e.migration).toMatchObject({ sens: 'vers_local', echecs: 0, enCours: false });
    const cle = await cleF(local2.fichierId);
    expect(cle).not.toMatch(/^alf:/);
    expect(Buffer.from(await env.c.storage.get(cle)).equals(local2.buf)).toBe(true);
    expect(await env.db.get("SELECT count(*)::int AS n FROM ged_sim_nodes WHERE NOT dossier AND nom LIKE '%.pdf'")).toEqual({ n: 0 }); // nœuds supprimés de la GED
    expect((await as(admin).post(G('/stockage/migration'), { sens: 'vers_alfresco' })).status).toBe(409); // il faut d'abord choisir Alfresco
  });

  it('le logo suit la migration', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const put = await env.c.storage.put(png, { organismeId: ville.id, ext: 'png' });
    await env.db.run('UPDATE organismes SET logo_path = $2 WHERE id = $1', [ville.id, put.key]);
    await as(admin).put(G('/config'), { stockage: 'alfresco' });
    await as(admin).post(G('/stockage/migration'), { sens: 'vers_alfresco' }); await attendreMigration();
    const logo = (await env.db.get('SELECT logo_path FROM organismes WHERE id = $1', [ville.id])).logo_path;
    expect(logo).toMatch(/^alf:/);
    expect(Buffer.from(await env.c.storage.get(logo)).equals(png)).toBe(true);
    expect((await as(admin).get(G('/stockage'))).body.logo).toBe('alfresco');
    await as(admin).put(G('/config'), { stockage: 'local' });
  });

  it('pas de repli silencieux : si la GED est injoignable, l’écriture échoue (rien n’est dispersé en local)', async () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vd-'));
    const st = createStorage({ storage: { dir } });
    st.attach({ cible: async () => ({ cfg: {}, ad: { deposer: async () => { throw new Error('GED injoignable'); } } }), dossier: async () => 'x', ad: async () => null });
    await expect(st.put(Buffer.from('x'), { organismeId: 1, ext: 'pdf' })).rejects.toThrow(/injoignable/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
