const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let elus; let acteIds; let tok; let docKey; let docVersion; let autreDocKey; let gm; let go;
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
  gm = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Majorité', ordre: 1 })).body;
  go = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Opposition', ordre: 2 })).body;
  elus = [];
  for (const [nom, prenom, email, g] of [['Durif', 'Paul', 'paul.durif@example.fr', gm], ['Lambert', 'Jeanne', 'jeanne.lambert@example.fr', gm], ['Rey', 'Omar', 'omar.rey@example.fr', go], ['Morel', 'Yann', 'yann.morel@example.fr', go]]) {
    elus.push((await as(admin).post(`${base()}/elus`, { nom, prenom, email, role: 'Conseiller municipal', groupeId: g.id })).body);
  }
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(20) })).body;
  acteIds = [await delib('Subvention à l’association Ivry Sport'), await delib('Convention avec le théâtre')];
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  await env.c.settings.put(await env.c.access.loadContext('boot'), { scope: 'organisme', organismeId: ville.id, key: 'elus.mad_declencheur', val: 'arret' });
  tok = {};
  for (const [i, e] of elus.entries()) { await activer(e); tok[i] = await connecter(['paul.durif', 'jeanne.lambert', 'omar.rey', 'yann.morel'][i] + '@example.fr'); }
  const s = (await el(tok[0]).get(`/api/v1/elus/seances/${seance.id}`)).body;
  const docs = s.points.flatMap((p) => p.documents);
  docKey = docs[0].key; docVersion = docs[0].version; autreDocKey = docs[1].key;
});
afterAll(async () => { await env.close(); });

const AN = (p = '') => `/api/v1/elus${p}`;
const anS = (p = '') => AN(`/seances/${seance.id}/annotations${p}`);
const liste = async (i, q = '') => (await el(tok[i]).get(anS(q))).body.items;
const surlignage = (extra = {}) => ({ docKey, docVersion, page: 1, kind: 'surlignage', rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }], citation: 'la subvention est accordée', couleur: '#facc15', ...extra });

describe('création et confidentialité', () => {
  it('surlignage, note, dessin et signet ; validations ; document d’une autre séance refusé', async () => {
    const c = await el(tok[0]).post(anS(), surlignage());
    expect(c.status).toBe(201); expect(c.body).toMatchObject({ kind: 'surlignage', miennes: true, orpheline: false, citation: 'la subvention est accordée', destinataires: [] });
    expect((await el(tok[0]).post(anS(), { docKey, docVersion, page: 2, kind: 'note', rects: [{ x: 0.3, y: 0.3, w: 0, h: 0 }], contenu: 'Vérifier le montant', couleur: '#60a5fa' })).status).toBe(201);
    expect((await el(tok[0]).post(anS(), { docKey, docVersion, page: 1, kind: 'dessin', trace: [[[0.1, 0.1], [0.2, 0.15], [0.3, 0.1]]], couleur: '#ef4444' })).status).toBe(201);
    expect((await el(tok[0]).post(anS(), { docKey, docVersion, page: 3, kind: 'signet', rects: [{ x: 0.05, y: 0.05, w: 0, h: 0 }], contenu: 'À revoir en commission' })).status).toBe(201);
    expect((await el(tok[0]).post(anS(), { ...surlignage(), rects: [] })).status).toBe(400);
    expect((await el(tok[0]).post(anS(), { docKey, docVersion, page: 1, kind: 'note', rects: [{ x: 0, y: 0, w: 0, h: 0 }], contenu: '  ' })).status).toBe(400);
    expect((await el(tok[0]).post(anS(), surlignage({ rects: [{ x: 2, y: 0, w: 0.1, h: 0.1 }] }))).status).toBe(400); // hors de la page
    expect((await el(tok[0]).post(anS(), surlignage({ docKey: 'v:99999' }))).status).toBe(400);       // document d'une autre séance
    expect((await el(tok[0]).post('/api/v1/elus/seances/99999/annotations', surlignage())).status).toBe(404);
    expect((await liste(0)).map((a) => a.kind)).toEqual(expect.arrayContaining(['surlignage', 'note', 'dessin', 'signet']));
    expect((await liste(0, `?docKey=${autreDocKey}`))).toEqual([]);
  });

  it('privées par défaut ; contenu chiffré en base ; l’administration ne voit que des compteurs', async () => {
    expect(await liste(1)).toEqual([]); expect(await liste(2)).toEqual([]);
    const brut = await env.db.all('SELECT contenu_c, citation_c FROM elu_annotations');
    expect(JSON.stringify(brut)).not.toMatch(/Vérifier le montant|subvention est accordée|À revoir/);
    expect(brut.every((r) => !r.contenu_c || /^[\w+/=]+\.[\w+/=]+\.[\w+/=]*$/.test(r.contenu_c))).toBe(true);
    const meta = (await as(t.martin).get(`${base()}/espace-elus/seances/${seance.id}/annotations-meta`)).body;
    expect(meta).toMatchObject({ annotations: 4, elus: 1, partagees: 0 });
    expect(JSON.stringify(meta)).not.toMatch(/subvention|Vérifier/);
    expect((await as(t.dupont).get(`${base()}/espace-elus/seances/${seance.id}/annotations-meta`)).status).toBe(403);
    expect((await env.http().get(anS()).set(bearer(t.martin))).status).toBe(401);          // un jeton d'agent n'ouvre pas l'espace élus
    expect((await env.http().get(anS())).status).toBe(401);
    const audit = await env.db.all("SELECT after, action FROM audit_log WHERE action LIKE 'elu.annotation.%'");
    expect(JSON.stringify(audit)).not.toMatch(/Vérifier|subvention/);                       // jamais le contenu dans l'audit
  });
});

describe('partage (ELU-73)', () => {
  let a;
  beforeAll(async () => { a = (await liste(0)).find((x) => x.kind === 'note'); });

  it('avec mon groupe : les membres à cet instant, figés ; les autres groupes ne voient rien ; le destinataire répond mais ne modifie pas', async () => {
    const r = await el(tok[0]).post(AN(`/annotations/${a.id}/partage`), { mode: 'groupe' });
    expect(r.status).toBe(200); expect(r.body.destinataires.map((d) => d.eluId)).toEqual([elus[1].id]);
    const vue = (await liste(1)).find((x) => x.id === a.id);
    expect(vue).toMatchObject({ miennes: false, auteur: 'Paul DURIF', contenu: 'Vérifier le montant' }); expect(vue.destinataires).toBeUndefined();
    expect(await liste(2)).toEqual([]);
    // un nouveau membre du groupe après le partage ne voit rien (membres figés)
    const tard = (await as(admin).post(`${base()}/elus`, { nom: 'Tardif', prenom: 'Luc', email: 'luc.tardif@example.fr', role: 'Conseiller municipal', groupeId: gm.id })).body;
    await activer(tard); const tt = await connecter('luc.tardif@example.fr');
    expect((await el(tt).get(anS())).body.items).toEqual([]);
    // réponse : le destinataire répond, l'auteur la voit ; le destinataire ne modifie ni ne supprime
    const rep = await el(tok[1]).post(AN(`/annotations/${a.id}/reponses`), { contenu: 'Le montant est bon.' });
    expect(rep.status).toBe(201);
    expect((await liste(0)).find((x) => x.id === a.id).reponses).toMatchObject([{ auteur: 'Jeanne LAMBERT', contenu: 'Le montant est bon.', miennes: false }]);
    expect((await el(tok[1]).put(AN(`/annotations/${a.id}`), { contenu: 'piraté' })).status).toBe(404);
    expect((await el(tok[1]).del(AN(`/annotations/${a.id}`))).status).toBe(404);
    expect((await el(tok[1]).post(AN(`/annotations/${a.id}/partage`), { mode: 'groupe' })).status).toBe(404);
    expect((await el(tok[2]).post(AN(`/annotations/${a.id}/reponses`), { contenu: 'intrus' })).status).toBe(404);
  });

  it('révocation : pour un destinataire ou pour tous', async () => {
    await el(tok[0]).post(AN(`/annotations/${a.id}/partage`), { mode: 'elus', eluIds: [elus[2].id] });
    expect((await liste(2)).map((x) => x.id)).toEqual([a.id]);
    expect((await el(tok[0]).post(AN(`/annotations/${a.id}/partage`), { mode: 'revoquer', eluIds: [elus[2].id] })).body.destinataires.map((d) => d.eluId)).toEqual([elus[1].id]);
    expect(await liste(2)).toEqual([]);
    expect((await el(tok[0]).post(AN(`/annotations/${a.id}/partage`), { mode: 'revoquer' })).body.destinataires).toEqual([]);
    expect(await liste(1)).toEqual([]);
    expect((await el(tok[0]).post(AN(`/annotations/${a.id}/partage`), { mode: 'elus', eluIds: [] })).status).toBe(400);
    expect((await el(tok[0]).post(AN(`/annotations/${a.id}/partage`), { mode: 'elus', eluIds: [elus[0].id] })).status).toBe(400); // pas soi-même
  });

  it('pour tout un document ou tout le carnet de la séance ; un élu sans groupe doit nommer ses destinataires', async () => {
    const r = await el(tok[0]).post(anS('/partage'), { portee: 'document', docKey, mode: 'elus', eluIds: [elus[3].id] });
    expect(r.body.annotations).toBe(4);
    expect((await liste(3)).length).toBe(4);
    expect((await el(tok[0]).post(anS('/partage'), { portee: 'seance', mode: 'revoquer' })).status).toBe(200);
    expect(await liste(3)).toEqual([]);
    await env.db.run('UPDATE elus SET groupe_id = NULL WHERE id = $1', [elus[0].id]);
    const tk = await connecter('paul.durif@example.fr'); // le groupe est relu à chaque connexion
    expect((await el(tk).post(AN(`/annotations/${a.id}/partage`), { mode: 'groupe' })).status).toBe(409);
    await env.db.run('UPDATE elus SET groupe_id = $2 WHERE id = $1', [elus[0].id, gm.id]);
  });
});

describe('nouvelle version d’un document (ELU-74)', () => {
  it('ré-ancrage par le client, ou orpheline conservée avec sa citation', async () => {
    const a = (await liste(0)).find((x) => x.kind === 'surlignage');
    const r = await el(tok[0]).put(AN(`/annotations/${a.id}/ancrage`), { docVersion: 'v2', page: 4, rects: [{ x: 0.2, y: 0.4, w: 0.4, h: 0.03 }] });
    expect(r.body).toMatchObject({ orpheline: false, docVersion: 'v2' });
    expect((await liste(0)).find((x) => x.id === a.id)).toMatchObject({ page: 4, docVersion: 'v2', citation: 'la subvention est accordée' });
    await el(tok[0]).put(AN(`/annotations/${a.id}/ancrage`), { orpheline: true });
    expect((await liste(0)).find((x) => x.id === a.id)).toMatchObject({ orpheline: true, citation: 'la subvention est accordée' });
    expect((await el(tok[0]).put(AN(`/annotations/${a.id}/ancrage`), {})).status).toBe(400);
    expect((await el(tok[1]).put(AN(`/annotations/${a.id}/ancrage`), { orpheline: true })).status).toBe(404);
  });
});

describe('mon dossier annoté (ELU-75)', () => {
  it('PDF avec les annotations incorporées, filigrane nominatif ; désactivable', async () => {
    const pdf = (tk) => el(tk).get(AN(`/seances/${seance.id}/dossier-annote`)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const r = await pdf(tok[0]);
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/pdf/); expect(r.headers['cache-control']).toMatch(/no-store/);
    const avecNotes = (await PDFDocument.load(r.body)).getPageCount();
    const sans = await pdf(tok[2]);
    expect(sans.status).toBe(200);
    expect(avecNotes).toBeGreaterThan((await PDFDocument.load(sans.body)).getPageCount()); // la page « Mes notes » n'existe que pour qui a annoté
    await env.c.settings.put(await env.c.access.loadContext('boot'), { scope: 'organisme', organismeId: ville.id, key: 'elus.export_annote', val: false });
    expect((await el(tok[0]).get(AN(`/seances/${seance.id}/dossier-annote`))).status).toBe(403);
    await env.c.settings.remove(await env.c.access.loadContext('boot'), { scope: 'organisme', organismeId: ville.id, key: 'elus.export_annote' });
  });
});

describe('suppression et purge (ELU-76)', () => {
  it('l’élu supprime son annotation (partages et réponses avec) ; l’administrateur purge un élu', async () => {
    const a = (await liste(0)).find((x) => x.kind === 'note');
    await el(tok[0]).post(AN(`/annotations/${a.id}/partage`), { mode: 'groupe' });
    await el(tok[1]).post(AN(`/annotations/${a.id}/reponses`), { contenu: 'ok' });
    expect((await el(tok[0]).del(AN(`/annotations/${a.id}`))).status).toBe(200);
    expect(await env.db.get('SELECT count(*)::int AS n FROM elu_annotation_partages WHERE annotation_id = $1', [a.id])).toEqual({ n: 0 });
    expect(await env.db.get('SELECT count(*)::int AS n FROM elu_annotation_reponses WHERE annotation_id = $1', [a.id])).toEqual({ n: 0 });
    expect((await as(t.martin).del(`${base()}/espace-elus/comptes/${elus[0].id}/annotations`)).status).toBe(403); // réservé à l'administrateur
    const p = await as(admin).del(`${base()}/espace-elus/comptes/${elus[0].id}/annotations`);
    expect(p.status).toBe(200); expect(p.body.supprimees).toBeGreaterThan(0);
    expect(await liste(0)).toEqual([]);
  });
});
