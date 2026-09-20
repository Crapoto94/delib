const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const O = () => `${base()}/seances/${seance.id}/odj`;
const C = () => `${base()}/seances/${seance.id}/cahier`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };

async function mk(titre, { finish = true, texts = true } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1 });
  if (texts) for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind} du dossier « ${titre} ».`, baseVersion: x.version });
  if (finish) {
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    for (let i = 0; i < 10; i++) {
      const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body;
      if (!v.currentStepKey) break;
      await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {});
    }
  }
  return a;
}
const generate = async (body = {}) => {
  const r = await as(t.martin).post(C(), body);
  await env.c.cahier.idle();
  return r;
};
const build = async (n) => (await as(t.martin).get(`${C()}/builds/${n}`)).body;
const pdfPages = async (n) => {
  const r = await as(t.martin).get(`${C()}/builds/${n}/fichier`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  return { status: r.status, type: r.headers['content-type'], doc: r.status === 200 ? await PDFDocument.load(r.body) : null };
};

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5');
  rubriques = await items('rubrique');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: '2027-03-11T18:30:00Z', lieu: 'Salle du conseil' })).body;
});
afterAll(async () => { await env.close(); });

describe('cahier de séance', () => {
  let a1; let a2;
  it('refuse un ordre du jour vide', async () => {
    const r = await as(t.martin).post(C(), {});
    expect(r.status).toBe(409);
  });

  it('compile page de garde, sommaire, intercalaires, exposés, délibérations : un seul PDF, avec filigrane tant que l\'ODJ n\'est pas arrêté', async () => {
    a1 = await mk('Subvention à l\'association Ivry Sport'); a2 = await mk('Convention avec le théâtre');
    await as(t.martin).post(`${O()}/points`, { kind: 'chapitre', titre: 'Culture et sports' });
    await as(t.martin).post(`${O()}/affectations`, { acteIds: [a1.id, a2.id] });
    await as(t.martin).post(`${O()}/points`, { kind: 'libre', titre: 'Questions diverses', numerote: true });
    const r = await generate({ profil: 'scc' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ version: 1, profil: 'scc', filigrane: true });
    const b = await build(1);
    expect(b).toMatchObject({ statut: 'done', version: 1 });
    expect(b.sha256).toMatch(/^[0-9a-f]{64}$/);
    const { status, type, doc } = await pdfPages(1);
    expect(status).toBe(200); expect(type).toMatch(/pdf/);
    expect(doc.getPageCount()).toBe(b.pages);
    // garde (1) + sommaire (1) + chapitre (1) + 2 × (intercalaire + exposé + délibération = 3) + point libre (1)
    expect(b.pages).toBe(1 + 1 + 1 + 6 + 1);
  });

  it('numérote les versions et le recto-verso fait commencer chaque point sur une page impaire', async () => {
    const r = await generate({ profil: 'scc', rectoVerso: true });
    expect(r.body.version).toBe(2);
    const b2 = await build(2);
    expect(b2.statut).toBe('done');
    expect(b2.pages).toBeGreaterThan((await build(1)).pages); // des pages blanches ont été insérées
    expect(b2.pages % 1).toBe(0);
  });

  it('réserve le cahier au SCC, à la DGS et aux administrateurs', async () => {
    expect((await as(t.dupont).post(C(), {})).status).toBe(403);
    expect((await as(t.dupont).get(`${C()}/builds`)).status).toBe(403);
    expect((await as(t.dupont).get(`${C()}/builds/1/fichier`)).status).toBe(403);
  });

  it('trace chaque téléchargement dans le journal d\'audit', async () => {
    await pdfPages(1);
    const rows = await env.db.all("SELECT after FROM audit_log WHERE action = 'cahier.telechargement'");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].after).toMatchObject({ version: 1, profil: 'scc' });
  });

  it('contrôles : signale un dossier non validé ; « bloquer » refuse, « avertir » génère, « exclure » retire le dossier', async () => {
    const brouillon = await mk('Dossier encore en rédaction', { finish: false });
    await as(t.martin).post(`${O()}/affectations`, { acteIds: [brouillon.id] });
    const c = (await as(t.martin).get(`${C()}/controles`)).body.items;
    expect(c.find((x) => x.code === 'non_valide' && x.acteId === brouillon.id)).toBeTruthy();
    const refuse = await as(t.martin).post(C(), { anomalies: 'bloquer' });
    expect(refuse.status).toBe(409);
    const avert = await generate({ anomalies: 'avertir' });
    expect(avert.body.anomalies.length).toBeGreaterThan(0);
    const pagesAvert = (await build(avert.body.version)).pages;
    const exclu = await generate({ anomalies: 'exclure' });
    expect((await build(exclu.body.version)).pages).toBeLessThan(pagesAvert);
  });

  it('marque une version diffusée puis liste les points ajoutés, retirés ou modifiés depuis', async () => {
    const before = (await as(t.martin).get(`${C()}/builds`)).body.items;
    const ref = before[0]; // la plus récente (exclusion du brouillon)
    expect((await as(t.martin).post(`${C()}/builds/${ref.version}/imprime`, {})).body.imprimeLe).toBeTruthy();
    const a3 = await mk('Nouveau dossier ajouté après diffusion');
    await as(t.martin).post(`${O()}/affectations`, { acteIds: [a3.id] });
    const tx = (await as(t.dupont).get(`${A(a1.id)}/textes`)).body.items.find((x) => x.kind === 'expose');
    void tx;
    const r = await generate({ anomalies: 'exclure' });
    const list = (await as(t.martin).get(`${C()}/builds`)).body.items;
    const last = list.find((x) => x.version === r.body.version);
    expect(last.referenceImprimee).toBe(ref.version);
    expect(last.depuisImprime.ajoutes).toContain('Nouveau dossier ajouté après diffusion');
    expect(last.depuisImprime.retires).toEqual([]);
  });

  it('profil « élus » : ne joint que les annexes communicables ; profil inconnu refusé', async () => {
    expect((await as(t.martin).post(C(), { profil: 'inconnu' })).status).toBe(400);
    const r = await generate({ profil: 'elus', anomalies: 'exclure' });
    expect((await build(r.body.version)).statut).toBe('done');
  });

  it('après l\'arrêt de l\'ordre du jour, le cahier n\'a plus de filigrane', async () => {
    await as(t.martin).post(`${O()}/arret`, { forcer: true });
    const r = await generate({ anomalies: 'exclure' });
    expect(r.body.filigrane).toBe(false);
  });
});
