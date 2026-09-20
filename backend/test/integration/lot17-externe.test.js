const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { ipAutorisee } = require('../../src/modules/externe/apikeys.service');

let env; let admin; let dupont; let ville; let ids;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const K = (p = '') => `/api/v1/organismes/${ville.id}/cles-api${p}`;
const X = (p = '') => `/api/v1/externe${p}`;
const avec = (cle) => ({ get: (u) => env.http().get(u).set('Authorization', `Bearer ${cle}`) });
const creerCle = async (portees, extra = {}) => (await as(admin).post(K(), { nom: `Appli ${portees.join('+')}`, portees, ...extra })).body;
const statut = (id, s, extra = '') => env.db.run(`UPDATE actes SET statut = $2 ${extra} WHERE id = $1`, [id, s]);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  const base = `/api/v1/organismes/${ville.id}`;
  const type = (await as(admin).get(`${base}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  const matiere = (await as(admin).get(`${base}/referentiels/matiere`)).body.items.find((x) => x.code === '7.5');
  const cree = async (titre) => {
    const a = (await as(dupont).post(`${base}/actes`, { typeId: type.id, titre, matiereId: matiere.id })).body;
    for (const t of (await as(dupont).get(`${base}/actes/${a.id}/textes`)).body.items) await as(dupont).put(`${base}/actes/${a.id}/textes/${t.id}`, { markdown: `Texte ${t.kind} de « ${titre} ».`, baseVersion: t.version });
    return a.id;
  };
  ids = { exe: await cree('Subvention exécutoire'), exe2: await cree('Convention exécutoire de 2025'), adop: await cree('Délibération adoptée'), cours: await cree('Projet en rédaction'), huis: await cree('Huis clos exécutoire'), rej: await cree('Délibération rejetée'), aband: await cree('Acte abandonné') };
  await statut(ids.exe, 'executoire'); await statut(ids.exe2, 'publie'); await statut(ids.adop, 'adopte'); await statut(ids.huis, 'executoire', ", confidentialite = 'huis_clos'"); await statut(ids.rej, 'rejete'); await statut(ids.aband, 'abandonne');
  // une annexe publiable et une qui ne l'est pas, sur l'acte exécutoire
  const d = await PDFDocument.create(); d.addPage([200, 200]); const buf = Buffer.from(await d.save());
  const ctx = await env.c.access.loadContext('admin').catch(() => env.c.access.loadContext('dupont'));
  const ajouter = (titre) => env.c.annexes.add({ ...ctx, isPlatformAdmin: true }, ville.id, ids.exe, { titre, communicable: true }, { buffer: buf, originalname: `${titre}.pdf`, size: buf.length, mimetype: 'application/pdf' });
  await env.db.run("UPDATE actes SET statut = 'brouillon' WHERE id = $1", [ids.exe]);
  const publique = await ajouter('Convention signée'); const privee = await ajouter('Note interne');
  await statut(ids.exe, 'executoire');
  await env.db.run('UPDATE annexes SET publiable = false WHERE id = $1', [privee.id]);
  ids.annexePublique = publique.id; ids.annexePrivee = privee.id;
  // un accusé de réception de la préfecture
  await env.db.run("INSERT INTO tlt_transactions (organisme_id, acte_id, numero_transmis, mode, etat, package, prepared_by, sent_at, ar_at) VALUES ($1,$2,'2026CM01_001','simulation','poste','{}'::jsonb,'x', now() - interval '3 days', now() - interval '2 days')", [ville.id, ids.exe]);
});
afterAll(async () => { await env.close(); });

describe('clés d’API : administration (EXT-01)', () => {
  it('création par l’administrateur : la clé n’est montrée qu’une fois, seule son empreinte est conservée', async () => {
    expect((await as(dupont).post(K(), { nom: 'x', portees: ['actes:executoires'] })).status).toBe(403);
    expect((await as(admin).post(K(), { nom: 'Site', portees: [] })).status).toBe(400);
    expect((await as(admin).post(K(), { nom: 'Site', portees: ['actes:tout'] })).status).toBe(400);
    expect((await as(admin).post(K(), { nom: 'Site', portees: ['actes:executoires'], ips: ['pas-une-ip'] })).status).toBe(400);
    const r = await as(admin).post(K(), { nom: 'Site de la Ville', portees: ['actes:executoires'], limiteMinute: 60 });
    expect(r.status).toBe(201); expect(r.body.cle).toMatch(/^vd_[0-9a-f]{8}_[A-Za-z0-9_-]{32}$/);
    expect(r.body).toMatchObject({ nom: 'Site de la Ville', portees: ['actes:executoires'], actif: true, nbAppels: 0 });
    const liste = (await as(admin).get(K())).body;
    expect(JSON.stringify(liste)).not.toContain(r.body.cle.split('_')[2]);           // jamais le secret
    expect(liste.items[0].prefixe).toMatch(/^vd_[0-9a-f]{8}_…$/); expect(liste.portees.map((p) => p.code)).toEqual(['actes:executoires', 'actes:adoptes', 'actes:encours']);
    const ligne = await env.db.get('SELECT secret_hash FROM api_keys WHERE id = $1', [r.body.id]);
    expect(ligne.secret_hash).toMatch(/^[0-9a-f]{64}$/); expect(ligne.secret_hash).not.toContain(r.body.cle.split('_')[2]);
    expect(JSON.stringify(await env.db.all("SELECT after FROM audit_log WHERE action LIKE 'cle_api.%'"))).not.toContain(r.body.cle.split('_')[2]);
  });

  it('modification, révocation, renouvellement (bascule en douceur possible)', async () => {
    const c = await creerCle(['actes:executoires']);
    expect((await avec(c.cle).get(X('/cle'))).status).toBe(200);
    expect((await as(admin).put(K(`/${c.id}`), { portees: ['actes:executoires', 'actes:adoptes'] })).body.portees).toEqual(['actes:executoires', 'actes:adoptes']);
    expect((await as(admin).put(K(`/${c.id}`), { actif: false })).body.actif).toBe(false);
    expect((await avec(c.cle).get(X('/cle'))).status).toBe(401);                       // désactivée
    await as(admin).put(K(`/${c.id}`), { actif: true });
    const nouvelle = (await as(admin).post(K(`/${c.id}/renouvellement`), { finAncienneLe: new Date(Date.now() + 3600000).toISOString() })).body;
    expect(nouvelle.cle).not.toBe(c.cle); expect(nouvelle.portees).toEqual(['actes:executoires', 'actes:adoptes']);
    expect((await avec(c.cle).get(X('/cle'))).status).toBe(200);                       // l'ancienne vit encore un moment
    expect((await avec(nouvelle.cle).get(X('/cle'))).status).toBe(200);
    expect((await as(admin).del(K(`/${nouvelle.id}`))).status).toBe(200);
    expect((await avec(nouvelle.cle).get(X('/cle'))).status).toBe(401);                // révoquée : immédiat
    expect((await as(admin).del(K(`/${nouvelle.id}`))).status).toBe(404);
    expect((await as(admin).put(K(`/${nouvelle.id}`), { nom: 'xx' })).status).toBe(409);
    const sec = (await as(admin).post(K(`/${c.id}/renouvellement`), {})).body;           // sans date : l'ancienne est révoquée tout de suite
    expect((await avec(c.cle).get(X('/cle'))).status).toBe(401); expect((await avec(sec.cle).get(X('/cle'))).status).toBe(200);
  });
});

describe('authentification et sécurité (EXT-05)', () => {
  it('sans clé, clé fausse ou de forme invalide : 401 ; un jeton d’agent n’ouvre pas l’API externe ; X-API-Key accepté', async () => {
    expect((await env.http().get(X('/actes'))).status).toBe(401);
    expect((await avec('vd_00000000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').get(X('/actes'))).status).toBe(401);
    expect((await avec('n-importe-quoi').get(X('/actes'))).status).toBe(401);
    expect((await as(dupont).get(X('/actes'))).status).toBe(401);
    const c = await creerCle(['actes:executoires']);
    const par = await env.http().get(X('/cle')).set('X-API-Key', c.cle);
    expect(par.status).toBe(200); expect(par.body).toMatchObject({ portees: ['actes:executoires'], categoriesAccessibles: ['executoires'] });
    const mauvais = c.cle.slice(0, -1) + (c.cle.endsWith('a') ? 'b' : 'a');
    expect((await avec(mauvais).get(X('/cle'))).status).toBe(401);
    expect((await env.http().get(X('/actes')).set('Origin', 'https://autre.example').set('Authorization', `Bearer ${c.cle}`)).headers['access-control-allow-origin']).toBeUndefined(); // pas de CORS
  });

  it('expiration, IP autorisées, limite d’appels par minute, compteur d’usage', async () => {
    const exp = await creerCle(['actes:executoires'], { expireLe: new Date(Date.now() + 3600000).toISOString() });
    expect((await avec(exp.cle).get(X('/cle'))).status).toBe(200);
    await env.db.run("UPDATE api_keys SET expire_le = now() - interval '1 minute' WHERE id = $1", [exp.id]);
    expect((await avec(exp.cle).get(X('/cle'))).status).toBe(401);
    expect((await as(admin).post(K(), { nom: 'passé', portees: ['actes:encours'], expireLe: '2020-01-01T00:00:00.000Z' })).status).toBe(400);

    const ip = await creerCle(['actes:executoires'], { ips: ['10.9.8.7', '192.168.4.0/24'] });
    expect((await avec(ip.cle).get(X('/cle'))).status).toBe(403);                     // 127.0.0.1 n'est pas autorisée
    await as(admin).put(K(`/${ip.id}`), { ips: ['127.0.0.1', '::1'] });
    expect((await avec(ip.cle).get(X('/cle'))).status).toBe(200);
    expect(ipAutorisee('192.168.4.77', ['192.168.4.0/24'])).toBe(true); expect(ipAutorisee('192.168.5.1', ['192.168.4.0/24'])).toBe(false);
    expect(ipAutorisee('::ffff:10.9.8.7', ['10.9.8.7'])).toBe(true); expect(ipAutorisee('1.2.3.4', [])).toBe(true);

    const lim = await creerCle(['actes:executoires'], { limiteMinute: 3 });
    for (let i = 0; i < 3; i++) expect((await avec(lim.cle).get(X('/cle'))).status).toBe(200);
    const trop = await avec(lim.cle).get(X('/cle'));
    expect(trop.status).toBe(429); expect(trop.headers['retry-after']).toBeTruthy();
    await new Promise((r) => setTimeout(r, 200));
    const u = (await as(admin).get(K())).body.items.find((x) => x.id === lim.id);
    expect(u.nbAppels).toBe(3); expect(u.dernierUsage).toBeTruthy();
  });

  it('une clé n’ouvre que son organisme', async () => {
    const autre = (await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS', type: 'ccas' })).body;
    const c = (await as(admin).post(`/api/v1/organismes/${autre.id}/cles-api`, { nom: 'CCAS', portees: ['actes:executoires', 'actes:adoptes', 'actes:encours'] })).body;
    expect((await avec(c.cle).get(X('/actes'))).body).toMatchObject({ total: 0, items: [] });       // aucun acte de la Ville
    expect((await avec(c.cle).get(X(`/actes/${ids.exe}`))).status).toBe(404);
  });
});

describe('droits : exécutoires / adoptés / en cours (EXT-02, EXT-03)', () => {
  let exe; let adop; let cours; let tout;
  beforeAll(async () => {
    exe = (await creerCle(['actes:executoires'])).cle; adop = (await creerCle(['actes:adoptes'])).cle; cours = (await creerCle(['actes:encours'])).cle; tout = (await creerCle(['actes:executoires', 'actes:adoptes', 'actes:encours'])).cle;
  });
  const titres = (r) => r.body.items.map((i) => i.titre).sort();

  it('chaque portée ne voit que sa catégorie ; ni rejetés, ni abandonnés, ni huis clos, quelle que soit la clé', async () => {
    expect(titres(await avec(exe).get(X('/actes')))).toEqual(['Convention exécutoire de 2025', 'Subvention exécutoire']);
    expect(titres(await avec(adop).get(X('/actes')))).toEqual(['Délibération adoptée']);
    expect(titres(await avec(cours).get(X('/actes')))).toEqual(['Projet en rédaction']);
    const t = await avec(tout).get(X('/actes'));
    expect(titres(t)).toEqual(['Convention exécutoire de 2025', 'Délibération adoptée', 'Projet en rédaction', 'Subvention exécutoire']);
    for (const cache of ['Huis clos exécutoire', 'Délibération rejetée', 'Acte abandonné']) expect(titres(t)).not.toContain(cache);
    expect(t.body.items.find((i) => i.titre === 'Subvention exécutoire')).toMatchObject({ categorie: 'executoire', statut: 'executoire', type: 'Délibération' });
    expect(t.body.items.find((i) => i.titre === 'Projet en rédaction').categorie).toBe('encours');
    expect((await avec(exe).get(X('/actes?categorie=encours'))).status).toBe(403);   // catégorie demandée hors droits
    expect((await avec(tout).get(X('/actes?categorie=adoptes'))).body.total).toBe(1);
  });

  it('détail : texte adopté, PDF et annexes publiables pour un exécutoire ; métadonnées seulement pour un acte en cours ; 404 sans droit', async () => {
    const d = (await avec(exe).get(X(`/actes/${ids.exe}`))).body;
    expect(d).toMatchObject({ id: ids.exe, categorie: 'executoire', mention: null });
    expect(d.dateAr).toBeTruthy(); expect(d.transmisLe).toBeTruthy();                 // revenu du contrôle de légalité : date d'AR
    expect(d.expose).toMatch(/Texte expose/); expect(d.deliberations[0]).toMatchObject({ visas: expect.stringMatching(/Texte visas/), dispositif: expect.stringMatching(/Texte dispositif/) });
    expect(d.annexes.map((a) => a.titre)).toEqual(['Convention signée']);            // l'annexe non publiable n'existe pas pour l'extérieur
    const pdf = await env.http().get(d.deliberations[0].pdf).set('Authorization', `Bearer ${exe}`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200); expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const an = await env.http().get(d.annexes[0].url).set('Authorization', `Bearer ${exe}`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(an.status).toBe(200); expect(an.body.subarray(0, 4).toString()).toBe('%PDF');
    expect((await avec(exe).get(X(`/actes/${ids.exe}/annexes/${ids.annexePrivee}`))).status).toBe(404);

    const a = (await avec(adop).get(X(`/actes/${ids.adop}`))).body;
    expect(a.mention).toMatch(/pas encore exécutoire/); expect(a.dispositif ?? a.deliberations[0].dispositif).toBeTruthy();
    const c = (await avec(cours).get(X(`/actes/${ids.cours}`))).body;
    expect(c).toMatchObject({ titre: 'Projet en rédaction', categorie: 'encours' });
    expect(c.expose).toBeUndefined(); expect(c.deliberations).toBeUndefined(); expect(c.annexes).toBeUndefined(); expect(c.liens).toBeUndefined();   // jamais le contenu d'un acte en rédaction
    expect((await avec(cours).get(X(`/actes/${ids.cours}/pdf`))).status).toBe(403);
    expect((await avec(exe).get(X(`/actes/${ids.cours}`))).status).toBe(404);          // hors droits : on ne révèle même pas l'existence
    expect((await avec(exe).get(X(`/actes/${ids.adop}`))).status).toBe(404);
    for (const cache of [ids.huis, ids.rej, ids.aband]) expect((await avec(tout).get(X(`/actes/${cache}`))).status).toBe(404);
    expect(JSON.stringify(d)).not.toMatch(/dupont|redacteur|circuit|commentaire/i);   // rien sur les agents ni le circuit
  });

  it('filtres, pagination, synchronisation incrémentale (modifieDepuis) et registre', async () => {
    expect((await avec(tout).get(X('/actes?q=Convention'))).body.total).toBe(1);
    expect((await avec(tout).get(X('/actes?q=inconnu'))).body.total).toBe(0);
    expect((await avec(tout).get(X('/actes?limit=2&offset=1'))).body).toMatchObject({ total: 4, limit: 2, offset: 1 });
    expect((await avec(tout).get(X('/actes?type=deliberation'))).body.total).toBe(4);
    expect((await avec(tout).get(X('/actes?matiere=7.5'))).body.total).toBe(4);
    const depuis = (await env.db.get("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS t")).t; // horloge de la base (la sienne fait foi)
    expect((await avec(tout).get(X(`/actes?modifieDepuis=${encodeURIComponent(depuis)}`))).body.total).toBe(0);
    await env.db.run('UPDATE actes SET titre = $2 WHERE id = $1', [ids.exe2, 'Convention exécutoire modifiée']);
    const sync = (await avec(tout).get(X(`/actes?modifieDepuis=${encodeURIComponent(depuis)}`))).body;
    expect(sync.items.map((i) => i.titre)).toEqual(['Convention exécutoire modifiée']);
    expect((await avec(tout).get(X('/actes?limit=500'))).status).toBe(400);
    const an = new Date().getFullYear();
    expect((await avec(exe).get(X(`/registre?annee=${an}`))).status).toBe(200);
    expect((await avec(adop).get(X(`/registre?annee=${an}`))).status).toBe(403);       // le registre exige actes:executoires
    expect((await avec(exe).get(X('/registre'))).status).toBe(400);
  });
});
