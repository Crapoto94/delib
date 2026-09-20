const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let elus; let items; let acteIds;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const bin = (tok, u, extra = {}) => env.http().get(u).set(bearer(tok)).set(extra).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (p = '') => `${base()}/seances/${seance.id}${p}`;
const E = (p = '') => `${base()}/espace-elus${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const PW = 'Mot-de-passe-solide-2026';
const mails = (re) => env.mail.state.sent.filter((m) => re.test(m.subject));
const pdf = async () => { const d = await PDFDocument.create(); d.addPage([595, 842]).drawText('Annexe', { x: 50, y: 700, size: 14 }); return Buffer.from(await d.save()); };

async function delib(titre, { termine = true } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  if (termine) {
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
    await as(t.martin).post(S('/odj/affectations'), { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  }
  return a.id;
}

/** Élu : connexion complète (mot de passe puis code reçu par mail). */
async function connecter(email, { appareil, faireConfiance } = {}) {
  const r1 = await env.http().post('/api/v1/elus-auth/connexion').send({ email, motDePasse: PW, appareil });
  if (r1.body.session) return r1.body.session.token;
  expect(r1.status).toBe(200);
  const m = mails(/code de connexion/).at(-1);
  const code = /(\d{6})<\/b>/.exec(m.html)[1];
  const r2 = await env.http().post('/api/v1/elus-auth/code').send({ challenge: r1.body.challenge, code, appareil, faireConfiance });
  expect(r2.status).toBe(200);
  return r2.body.token;
}
const el = (tok) => ({ get: (u) => env.http().get(u).set(bearer(tok)), post: (u, b) => env.http().post(u).set(bearer(tok)).send(b), put: (u, b) => env.http().put(u).set(bearer(tok)).send(b), del: (u) => env.http().delete(u).set(bearer(tok)) });
const inviter = async (elu) => { const r = await as(t.martin).post(E(`/comptes/${elu.id}/invitation`)); expect(r.status).toBe(201); const m = mails(/accès à l’espace des élus/).at(-1); const tok = /#\/invitation\/([\w-]+)/.exec(m.html)[1]; return tok; };
const activer = async (elu) => { const tok = await inviter(elu); const r = await env.http().post(`/api/v1/elus-auth/invitation/${tok}`).send({ motDePasse: PW }); expect(r.status).toBe(200); return tok; };

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const refs = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await refs('matiere')).find((x) => x.code === '7.5'); rubriques = await refs('rubrique');
  typeDelib = (await refs('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  const gm = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Majorité', ordre: 1 })).body;
  const go = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Opposition', ordre: 2 })).body;
  elus = [];
  for (const [nom, prenom, email, g] of [['Durif', 'Paul', 'paul.durif@example.fr', gm], ['Lambert', 'Jeanne', 'jeanne.lambert@example.fr', gm], ['Rey', 'Omar', 'omar.rey@example.fr', go], ['Sansmail', 'Luc', null, gm]]) {
    elus.push((await as(admin).post(`${base()}/elus`, { nom, prenom, email: email ?? undefined, role: 'Conseiller municipal', groupeId: g.id })).body);
  }
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(20) })).body;
  acteIds = [await delib('Subvention à l’association Ivry Sport'), await delib('Convention avec le théâtre'), await delib('Point retiré plus tard')];
  await as(t.martin).post(S('/odj/points'), { kind: 'libre', titre: 'Communication des décisions du Maire', numerote: true });
  // une annexe communicable et une qui ne l’est pas
  const ctx = await env.c.access.loadContext('dupont'); const buf = await pdf();
  await env.c.annexes.add(ctx, ville.id, acteIds[0], { titre: 'Plan de financement', communicable: true }, { buffer: buf, originalname: 'plan.pdf', size: buf.length, mimetype: 'application/pdf' });
  await env.c.annexes.add(ctx, ville.id, acteIds[0], { titre: 'Note interne', communicable: false }, { buffer: buf, originalname: 'interne.pdf', size: buf.length, mimetype: 'application/pdf' });
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  items = (await as(t.martin).get(S('/odj'))).body.items;
});
afterAll(async () => { await env.close(); });

describe('comptes et authentification des élus', () => {
  it('le SCC invite un élu : lien personnel envoyé par mail, jamais visible du SCC ; réservé au SCC ; élu sans e-mail refusé', async () => {
    expect((await as(t.dupont).post(E(`/comptes/${elus[0].id}/invitation`))).status).toBe(403);
    expect((await as(t.martin).post(E(`/comptes/${elus[3].id}/invitation`))).status).toBe(409); // pas d’adresse e-mail
    const tok = await inviter(elus[0]);
    const l = (await as(t.martin).get(E('/comptes'))).body.items.find((x) => x.eluId === elus[0].id);
    expect(l).toMatchObject({ compte: 'invite', aUnEmail: true });
    expect(JSON.stringify(l)).not.toContain(tok);
    expect(mails(/accès à l’espace des élus/).at(-1).to).toBe('paul.durif@example.fr');
    // mot de passe robuste, lien à usage unique
    expect((await env.http().post(`/api/v1/elus-auth/invitation/${tok}`).send({ motDePasse: 'court' })).status).toBe(400);
    expect((await env.http().post(`/api/v1/elus-auth/invitation/${tok}`).send({ motDePasse: 'aaaaaaaaaaaaaaaa' })).status).toBe(400);
    expect((await env.http().post(`/api/v1/elus-auth/invitation/${tok}`).send({ motDePasse: PW })).status).toBe(200);
    expect((await env.http().post(`/api/v1/elus-auth/invitation/${tok}`).send({ motDePasse: PW })).status).toBe(400);
    expect((await as(t.martin).get(E('/comptes'))).body.items.find((x) => x.eluId === elus[0].id).compte).toBe('actif');
  });

  it('connexion en deux étapes : mot de passe puis code par mail ; erreurs génériques ; verrouillage après cinq échecs', async () => {
    await activer(elus[1]); await activer(elus[2]);
    const mauvais = await env.http().post('/api/v1/elus-auth/connexion').send({ email: 'paul.durif@example.fr', motDePasse: 'mauvais-mot-de-passe' });
    expect(mauvais.status).toBe(401); expect(mauvais.body.error).toBe('Identifiants incorrects');
    expect((await env.http().post('/api/v1/elus-auth/connexion').send({ email: 'inconnu@example.fr', motDePasse: PW })).body.error).toBe('Identifiants incorrects'); // même message : pas d’énumération
    const r1 = await env.http().post('/api/v1/elus-auth/connexion').send({ email: 'paul.durif@example.fr', motDePasse: PW });
    expect(r1.body).toMatchObject({ challenge: expect.any(String), expireDans: 600 }); expect(r1.body.token).toBeUndefined();
    const code = /(\d{6})<\/b>/.exec(mails(/code de connexion/).at(-1).html)[1];
    expect((await env.http().post('/api/v1/elus-auth/code').send({ challenge: r1.body.challenge, code: code === '000000' ? '111111' : '000000' })).status).toBe(401);
    const ok = await env.http().post('/api/v1/elus-auth/code').send({ challenge: r1.body.challenge, code });
    expect(ok.status).toBe(200); expect(ok.body.token).toBeTruthy();
    expect((await env.http().post('/api/v1/elus-auth/code').send({ challenge: r1.body.challenge, code })).status).toBe(401); // code à usage unique
    for (let i = 0; i < 5; i++) await env.http().post('/api/v1/elus-auth/connexion').send({ email: 'omar.rey@example.fr', motDePasse: 'nope-nope-nope-1' });
    expect((await env.http().post('/api/v1/elus-auth/connexion').send({ email: 'omar.rey@example.fr', motDePasse: PW })).status).toBe(429); // verrouillé même avec le bon mot de passe
    await env.db.run("UPDATE elu_comptes SET verrouille_jusqu = NULL, echecs = 0 WHERE elu_id = $1", [elus[2].id]);
  });

  it('un appareil de confiance évite le code ; un jeton d’élu n’ouvre jamais l’API des agents (et inversement)', async () => {
    const appareil = 'appareil-de-test-12345';
    const tok = await connecter('paul.durif@example.fr', { appareil, faireConfiance: true });
    const direct = await env.http().post('/api/v1/elus-auth/connexion').send({ email: 'paul.durif@example.fr', motDePasse: PW, appareil });
    expect(direct.body.session?.token).toBeTruthy(); // pas de nouveau code
    expect((await env.http().get('/api/v1/me').set(bearer(tok))).status).toBe(401); // jeton d’élu refusé par l’API agents
    expect((await el(tok).get(`${base()}/actes`)).status).toBe(401);
    expect((await env.http().get('/api/v1/elus/accueil').set(bearer(t.martin))).status).toBe(401); // jeton d’agent refusé par l’espace élus
    expect((await env.http().get('/api/v1/elus/accueil')).status).toBe(401);
    expect((await el(tok).post('/api/v1/elus-auth/deconnexion')).status).toBe(200);
    expect((await el(tok).get('/api/v1/elus/accueil')).status).toBe(401); // session révoquée
  });
});

describe('mise à disposition et contenu : documents finalisés seulement', () => {
  let tok; let tok2; let tok3;
  it('la séance n’apparaît qu’après l’envoi de la convocation, au même instant pour tous', async () => {
    tok = await connecter('paul.durif@example.fr'); tok2 = await connecter('jeanne.lambert@example.fr'); tok3 = await connecter('omar.rey@example.fr');
    expect((await el(tok).get('/api/v1/elus/accueil')).body.seances).toEqual([]);
    expect((await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).status).toBe(404);
    const r = await as(t.martin).post(`${base()}/seances/${seance.id}/convocation`, { eluIds: elus.slice(0, 3).map((e) => e.id) });
    expect(r.status).toBe(202); await env.c.convocations.idle();
    for (const k of [tok, tok2, tok3]) expect((await el(k).get('/api/v1/elus/accueil')).body.seances.map((s) => s.id)).toEqual([seance.id]);
    const a = (await el(tok).get('/api/v1/elus/accueil')).body;
    expect(a.prochaine).toMatchObject({ id: seance.id, documentsATelecharger: expect.any(Number) }); expect(a.prochaine.joursRestants).toBeGreaterThan(15);
  });

  it('l’ordre du jour donne, par point, l’exposé, le projet et les annexes COMMUNICABLES en PDF — rien d’interne', async () => {
    const s = (await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).body;
    const p1 = s.points.find((p) => p.titre.includes('Subvention'));
    expect(p1.documents.map((d) => d.type)).toEqual(['expose', 'projet', 'annexe']);
    expect(p1.documents.find((d) => d.type === 'annexe').titre).toBe('Plan de financement');
    expect(JSON.stringify(s)).not.toMatch(/Note interne/);
    expect(s.documents.map((d) => d.type)).toEqual(expect.arrayContaining(['convocation', 'odj']));
    const libre = s.points.find((p) => p.kind === 'libre');
    expect(libre.documents).toEqual([]);
    for (const k of ['redacteur', 'circuit', 'commentaires', 'notes', 'tenue', 'holders']) expect(JSON.stringify(s)).not.toContain(`"${k}"`);
  });

  it('un document est servi en PDF avec ETag = version (304 si inchangé) ; sans lecture journalisée par défaut', async () => {
    const s = (await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).body;
    const doc = s.points.find((p) => p.titre.includes('Subvention')).documents.find((d) => d.type === 'projet');
    const r = await bin(tok, `/api/v1/elus/documents/${encodeURIComponent(doc.key)}`);
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/pdf/); expect(r.headers.etag).toBe(`"${doc.version}"`);
    expect((await PDFDocument.load(r.body)).getPageCount()).toBeGreaterThan(0);
    const r304 = await bin(tok, `/api/v1/elus/documents/${encodeURIComponent(doc.key)}`, { 'If-None-Match': `"${doc.version}"` });
    expect(r304.status).toBe(304);
    expect((await env.db.all('SELECT * FROM elu_lectures WHERE elu_id = $1', [elus[0].id])).length).toBe(0); // le téléchargement en arrière-plan n’est pas une lecture
    expect((await bin(tok, '/api/v1/elus/documents/p:999999:projet')).status).toBe(404);
    expect((await bin(tok, '/api/v1/elus/documents/x:1')).status).toBe(404); expect((await bin(tok, '/api/v1/elus/documents/zzz')).status).toBe(400);
  });

  it('le manifeste liste tous les documents dans l’ordre de lecture, avec leur version : de quoi précharger en arrière-plan', async () => {
    const m = (await el(tok).get(`/api/v1/elus/seances/${seance.id}/manifeste`)).body;
    const types = m.documents.map((d) => d.type);
    expect(types.slice(0, 2)).toEqual(expect.arrayContaining(['convocation', 'odj']));
    expect(types.filter((x) => x === 'expose').length).toBe(3);
    expect(m.documents.every((d) => d.version && d.url.startsWith('/api/v1/elus/documents/'))).toBe(true);
    const ordre = m.documents.filter((d) => d.itemId).map((d) => d.priorite);
    expect(ordre).toEqual([...ordre].sort((a, b) => a - b)); // ordre de lecture
    expect((await el(tok).get(`/api/v1/elus/seances/${seance.id}/manifeste`)).body.documents.map((d) => d.version)).toEqual(m.documents.map((d) => d.version)); // versions stables
    // chaque document annoncé est bien téléchargeable
    for (const d of m.documents.slice(0, 4)) expect((await bin(tok, d.url)).status).toBe(200);
  });

  it('un texte modifié change la version du document (« modifié depuis ma dernière lecture ») ; les lectures sont journalisées', async () => {
    const before = (await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).body.points.find((p) => p.titre.includes('Convention')).documents;
    const projet = before.find((d) => d.type === 'projet');
    expect((await el(tok).post(`/api/v1/elus/seances/${seance.id}/lectures`, { items: [{ key: projet.key, version: projet.version, at: new Date().toISOString() }] })).body).toEqual({ enregistrees: 1 });
    const a = acteIds[1]; const txt = (await as(t.dupont).get(`${A(a)}/textes`)).body.items.find((x) => x.kind === 'dispositif');
    await env.c.textes.commit(await env.c.access.loadContext('admin'), ville.id, a, txt.id, { markdown: 'Article 1 : texte corrigé (erratum).', baseVersion: (await as(t.dupont).get(`${A(a)}/textes/${txt.id}`)).body.version }).catch(async () => {
      await as(admin).put(`${A(a)}/textes/${txt.id}`, { markdown: 'Article 1 : texte corrigé (erratum).', baseVersion: (await as(admin).get(`${A(a)}/textes/${txt.id}`)).body.version });
    });
    const after = (await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).body.points.find((p) => p.titre.includes('Convention')).documents.find((d) => d.type === 'projet');
    expect(after.version).not.toBe(projet.version);
    expect(after).toMatchObject({ modifie: true });
    // journal (preuve) côté SCC : métadonnées seulement
    const c = (await as(t.martin).get(E(`/seances/${seance.id}/consultations`))).body.items;
    expect(c.find((x) => x.eluId === elus[0].id)).toMatchObject({ documentsLus: 1, ouvertures: 1 });
    expect(c.find((x) => x.eluId === elus[2].id)).toMatchObject({ documentsLus: 0 });
    expect((await as(t.dupont).get(E(`/seances/${seance.id}/consultations`))).status).toBe(403);
  });

  it('un point retiré reste visible « retiré » mais sans document', async () => {
    const it = items.find((i) => i.acte?.id === acteIds[2]);
    await as(t.martin).del(`${S(`/odj/actes/${acteIds[2]}`)}?motif=${encodeURIComponent('Retiré à la demande du rapporteur')}`);
    const p = (await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).body.points.find((x) => x.id === it.id);
    expect(p).toMatchObject({ retire: true, documents: [] });
    expect((await bin(tok, `/api/v1/elus/documents/${encodeURIComponent(`p:${it.id}:projet`)}`)).status).toBe(404);
  });
});

describe('lu, favoris, notes personnelles', () => {
  let tok; let tok2; let tok3;
  it('marque un point lu / favori, propre à chaque élu', async () => {
    tok = await connecter('paul.durif@example.fr'); tok2 = await connecter('jeanne.lambert@example.fr'); tok3 = await connecter('omar.rey@example.fr');
    const it = items.find((i) => i.acte?.id === acteIds[0]);
    expect((await el(tok).put(`/api/v1/elus/points/${it.id}/etat`, { lu: true, favori: true })).body).toEqual({ lu: true, favori: true });
    const mine = (await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).body.points.find((p) => p.id === it.id);
    const other = (await el(tok2).get(`/api/v1/elus/seances/${seance.id}`)).body.points.find((p) => p.id === it.id);
    expect(mine).toMatchObject({ lu: true, favori: true }); expect(other).toMatchObject({ lu: false, favori: false });
  });

  it('les notes sont privées par défaut ; partage avec son groupe ou des élus nommés ; jamais visibles des autres ni des agents', async () => {
    const it = items.find((i) => i.acte?.id === acteIds[0]);
    const n1 = (await el(tok).post(`/api/v1/elus/seances/${seance.id}/notes`, { itemId: it.id, texte: 'À creuser : le plan de financement.' })).body;
    expect(n1.partage).toBe('prive');
    expect((await el(tok2).get(`/api/v1/elus/seances/${seance.id}/notes`)).body.items).toEqual([]);
    // partage avec le groupe (Majorité) : Jeanne le voit, Omar (Opposition) non
    await el(tok).post(`/api/v1/elus/seances/${seance.id}/notes`, { id: n1.id, itemId: it.id, texte: 'À creuser : le plan de financement.', partage: 'groupe' });
    const vue = (await el(tok2).get(`/api/v1/elus/seances/${seance.id}/notes`)).body.items[0];
    expect(vue).toMatchObject({ texte: 'À creuser : le plan de financement.', miennes: false, auteur: 'Paul DURIF' });
    expect((await el(tok3).get(`/api/v1/elus/seances/${seance.id}/notes`)).body.items).toEqual([]);
    // partage nominatif avec Omar
    await el(tok).post(`/api/v1/elus/seances/${seance.id}/notes`, { id: n1.id, itemId: it.id, texte: 'À creuser : le plan de financement.', partage: 'elus', avec: [elus[2].id] });
    expect((await el(tok3).get(`/api/v1/elus/seances/${seance.id}/notes`)).body.items.length).toBe(1);
    expect((await el(tok2).get(`/api/v1/elus/seances/${seance.id}/notes`)).body.items).toEqual([]);
    // on ne modifie ni ne supprime la note d’un autre
    expect((await el(tok3).del(`/api/v1/elus/notes/${n1.id}`)).status).toBe(404);
    expect((await el(tok).del(`/api/v1/elus/notes/${n1.id}`)).status).toBe(200);
    // aucune route d’agent ne donne accès aux notes des élus
    const agents = await env.http().get(`${base()}/espace-elus/notes`).set(bearer(t.martin));
    expect(agents.status).toBe(404);
  });
});

describe('suivi en direct : aucune note ni décompte de saisie', () => {
  it('l’élu suit le point en cours ; les notes du secrétariat ne sortent jamais', async () => {
    const tok = await connecter('paul.durif@example.fr');
    await as(t.martin).post(S('/tenue/ouverture'));
    await as(t.martin).put(S('/tenue/notes'), { notes: 'SECRET-NOTE-SECRETARIAT' });
    const it = items.find((i) => i.acte?.id === acteIds[0]);
    await as(t.martin).put(S('/tenue/courant'), { itemId: it.id });
    await as(t.martin).put(S(`/tenue/points/${it.id}/notes`), { notes: 'SECRET-NOTE-POINT' });
    const d = (await el(tok).get(`/api/v1/elus/seances/${seance.id}/direct`)).body;
    expect(d).toMatchObject({ statut: 'ouverte', courantId: it.id });
    expect(JSON.stringify(d)).not.toMatch(/SECRET|notes|decompte|pour|contre/);
    expect(JSON.stringify((await el(tok).get(`/api/v1/elus/seances/${seance.id}`)).body)).not.toMatch(/SECRET/);
    // une page en attente est réveillée dès que le point change
    const attente = el(tok).get(`/api/v1/elus/seances/${seance.id}/direct?since=${d.version}&wait=10`);
    await new Promise((r) => setTimeout(r, 300));
    const autre = items.find((i) => i.acte?.id === acteIds[1]);
    await as(t.martin).put(S('/tenue/courant'), { itemId: autre.id });
    const r = await attente;
    expect(r.body.courantId).toBe(autre.id);
  });
});

describe('désactivation', () => {
  it('désactiver un compte révoque ses sessions et interdit la connexion', async () => {
    const tok = await connecter('jeanne.lambert@example.fr');
    expect((await as(t.martin).put(E(`/comptes/${elus[1].id}/actif`), { actif: false })).status).toBe(200);
    expect((await el(tok).get('/api/v1/elus/accueil')).status).toBe(401);
    expect((await env.http().post('/api/v1/elus-auth/connexion').send({ email: 'jeanne.lambert@example.fr', motDePasse: PW })).status).toBe(401);
    expect((await as(t.martin).put(E(`/comptes/${elus[1].id}/actif`), { actif: true })).status).toBe(200);
    expect(await connecter('jeanne.lambert@example.fr')).toBeTruthy();
  });
});
