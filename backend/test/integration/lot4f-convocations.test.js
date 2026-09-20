const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let elus;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const C = (id = seance.id) => `${base()}/seances/${id}/convocation`;
const O = (id = seance.id) => `${base()}/seances/${id}/odj`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const pub = (tok, path = '') => env.http().get(`/api/v1/public/convocations/${tok}${path}`);
const sent = () => env.mail.state.sent.filter((m) => /Convocation|Rappel/.test(m.subject));
const tokenOf = (m) => /\/c\/([A-Za-z0-9_-]{20,})/.exec(m.html)[1];
const tokenFor = (nom) => tokenOf(sent().find((m) => m.html.includes(`Bonjour ${nom}`)));

async function done(titre, seanceId = seance.id) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seanceId });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  await as(t.martin).post(`${O(seanceId)}/affectations`, { acteIds: [a.id], motif: "Ajout à l’ordre du jour" }); // (motif obligatoire après l’arrêt)
  return a;
}
const envoyer = async (body = {}, id = seance.id) => { const r = await as(t.martin).post(C(id), body); await env.c.convocations.idle(); return r; };

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubriques = await items('rubrique');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dga', 'petit', { directionCode: 'A1' }); await tit('dgs', 'boot');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  const g = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Majorité', couleur: '#2563EB', ordre: 1 })).body;
  elus = [];
  for (const e of [{ nom: 'Durif', prenom: 'paul', email: 'paul.durif@example.fr' }, { nom: 'Lambert', prenom: 'Jeanne', email: 'jeanne.lambert@example.fr' }, { nom: 'Sansmail', prenom: 'Luc' }]) {
    elus.push((await as(admin).post(`${base()}/elus`, { ...e, role: 'Conseiller municipal', groupeId: g.id })).body);
  }
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(20) })).body;
  await done('Subvention à l\'association Ivry Sport'); await done('Convention avec le théâtre');
});
afterAll(async () => { await env.close(); });

describe('convocation : préparation et préconditions', () => {
  it('propose les élus de l\'instance et refuse d\'envoyer tant que l\'ordre du jour n\'est pas arrêté', async () => {
    const p = (await as(t.martin).get(`${C()}/preparation`)).body;
    expect(p.elus.map((e) => e.nom)).toEqual(expect.arrayContaining(['Jeanne LAMBERT', 'Paul DURIF']));
    expect(p.elus.find((e) => e.nom.includes('SANSMAIL')).aUnEmail).toBe(false);
    expect(p.odj).toMatchObject({ arrete: false, points: 2 });
    expect(p.delai).toMatchObject({ requis: 5, ok: true });
    const r = await as(t.martin).post(C(), { agents: ['durand'] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/arrêt/);
  });

  it('réserve la convocation au SCC, à la DGS et aux administrateurs', async () => {
    expect((await as(t.dupont).get(`${C()}/preparation`)).status).toBe(403);
    expect((await as(t.dupont).post(C(), { agents: ['durand'] })).status).toBe(403);
    expect((await env.http().get(`${C()}/preparation`)).status).toBe(401);
  });
});

describe('convocation : élus et agents de la Ville, un lien unique par convoqué', () => {
  let v1; let tokens;
  it('envoie à tous les élus et à des agents de la Ville : un mail et un lien personnel distinct pour chacun', async () => {
    await as(t.martin).post(`${O()}/arret`, { forcer: true });
    const r = await envoyer({ eluIds: elus.map((e) => e.id), agents: ['durand', 'leroy'], message: 'Merci de confirmer votre présence.' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ version: 1, modificatif: false, compteurs: { destinataires: 5 } });
    v1 = (await as(t.martin).get(`${C()}/versions/1`)).body;
    expect(v1.compteurs).toMatchObject({ destinataires: 5, envoyes: 4, echecs: 1 }); // l'élu sans adresse échoue, avec trace
    expect(sent()).toHaveLength(4);
    tokens = sent().map(tokenOf);
    expect(new Set(tokens).size).toBe(4); // chaque lien est unique
    expect(sent()[0].html).toMatch(/lien vous est personnel/);
    const d = (await as(t.martin).get(`${C()}/versions/1/destinataires`)).body.items;
    expect(d.find((x) => x.nom.includes('SANSMAIL')).envoi).toMatchObject({ statut: 'echec', erreur: "Pas d'adresse e-mail" });
    expect(d.filter((x) => x.kind === 'agent').map((x) => x.username).sort()).toEqual(['durand', 'leroy']);
    expect(new Set(d.map((x) => x.lien)).size).toBe(5);
  });

  it('un agent inconnu ou un élu étranger à l\'instance est refusé', async () => {
    expect((await as(t.martin).post(C(), { agents: ['personne.inconnu'] })).status).toBe(404);
    expect((await as(t.martin).post(C(), { eluIds: [999999] })).status).toBe(400);
    expect((await as(t.martin).post(C(), { eluIds: [], agents: [] })).status).toBe(400);
  });

  it('le lien personnel s\'ouvre sans connexion et enregistre l\'ouverture, quel que soit le nombre de fois', async () => {
    const tok = tokenFor('Jeanne LAMBERT');
    const r = await pub(tok);
    expect(r.status).toBe(200);
    expect(r.body.convoque.nom).toBe('Jeanne LAMBERT');
    expect(r.body.convocation).toMatchObject({ version: 1, message: 'Merci de confirmer votre présence.' });
    expect(r.body.ordreDuJour).toHaveLength(2);
    expect(r.body.lu).toMatchObject({ convocation: false, odj: false });
    await pub(tok);
    const d = (await as(t.martin).get(`${C()}/versions/1/destinataires`)).body.items.find((x) => x.nom === 'Jeanne LAMBERT');
    expect(d.ouvertures).toBe(2);
    expect(d.premiereOuvertureAt).toBeTruthy();
    expect((await pub('jeton-invalide-jeton-invalide-xx')).status).toBe(404);
  });

  it('distingue « a ouvert le lien », « a consulté la convocation » et « a consulté l\'ordre du jour »', async () => {
    const tok = tokenFor('Jeanne LAMBERT');
    const conv = await pub(tok, '/convocation.pdf').buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(conv.status).toBe(200);
    expect(conv.headers['content-type']).toMatch(/pdf/);
    expect((await PDFDocument.load(conv.body)).getPageCount()).toBeGreaterThanOrEqual(1);
    let d = (await as(t.martin).get(`${C()}/versions/1/destinataires`)).body.items.find((x) => x.nom === 'Jeanne LAMBERT');
    expect(d.convocationLue.fois).toBe(1); expect(d.odjLu.fois).toBe(0);
    expect((await pub(tok, '/ordre-du-jour.pdf')).status).toBe(200);
    d = (await as(t.martin).get(`${C()}/versions/1/destinataires`)).body.items.find((x) => x.nom === 'Jeanne LAMBERT');
    expect(d.odjLu.fois).toBe(1);
    // Paul n'a rien consulté
    const paul = (await as(t.martin).get(`${C()}/versions/1/destinataires`)).body.items.find((x) => x.nom === 'Paul DURIF');
    expect(paul).toMatchObject({ ouvertures: 0, convocationLue: { fois: 0 }, odjLu: { fois: 0 } });
  });

  it('accusé de lecture et réponse de présence depuis le lien personnel', async () => {
    const tok = tokenFor('Jeanne LAMBERT');
    expect((await env.http().post(`/api/v1/public/convocations/${tok}/accuse`).send({})).status).toBe(200);
    expect((await env.http().post(`/api/v1/public/convocations/${tok}/reponse`).send({ reponse: 'peut-etre' })).status).toBe(400);
    const r = await env.http().post(`/api/v1/public/convocations/${tok}/reponse`).send({ reponse: 'absent', commentaire: 'Déplacement' });
    expect(r.status).toBe(200);
    expect((await pub(tok)).body.reponse).toMatchObject({ reponse: 'absent', commentaire: 'Déplacement' });
  });
});

describe('convocation : journal et statistiques', () => {
  it('le journal retrace envois, échecs, ouvertures, consultations, accusés et réponses, sans adresse IP en clair', async () => {
    const j = (await as(t.martin).get(`${C()}/versions/1/journal?limit=200`)).body;
    const types = j.items.map((e) => e.type);
    for (const ty of ['envoi', 'echec', 'ouverture', 'convocation_lue', 'odj_lu', 'accuse', 'reponse']) expect(types).toContain(ty);
    expect(j.items.filter((e) => e.type === 'ouverture')).toHaveLength(3); // 2 ouvertures + celle qui a relu la réponse
    expect(j.items.find((e) => e.type === 'ouverture').empreinteIp).toMatch(/^[0-9a-f]{16}$/);
    const filtre = (await as(t.martin).get(`${C()}/versions/1/journal?type=reponse`)).body;
    expect(filtre.items).toHaveLength(1);
    expect(filtre.items[0]).toMatchObject({ nom: 'Jeanne LAMBERT', meta: { reponse: 'absent' } });
  });

  it('les statistiques donnent les totaux, taux, répartition élus / agents / groupes, chronologie et non-lecteurs', async () => {
    const s = (await as(t.martin).get(`${C()}/versions/1/statistiques`)).body;
    expect(s.totaux).toMatchObject({ total: 5, envoyes: 4, echecs: 1, ouverts: 1, convocationLue: 1, odjLu: 1, accuses: 1, absents: 1, presents: 0 });
    expect(s.taux).toMatchObject({ ouverture: 25, convocationLue: 25, odjLu: 25 });
    expect(s.parType.elu.total).toBe(3); expect(s.parType.agent.total).toBe(2);
    expect(s.parGroupe[0]).toMatchObject({ groupe: 'Majorité', total: 3 });
    expect(s.chronologie.length).toBeGreaterThan(0);
    expect(s.chronologie[0].ouvertures).toBe(3);
    expect(s.nonLecteurs).toHaveLength(3); // Paul et les deux agents ; l’élu sans adresse (échec d’envoi) n’en fait pas partie
    expect(s.nonLecteurs.map((x) => x.nom)).toContain('Paul DURIF');
    expect(s.nonLecteurs.filter((x) => x.kind === 'agent')).toHaveLength(2);
    expect(s.enEchec).toHaveLength(1);
  });

  it('exporte la preuve d\'envoi et de consultation en CSV', async () => {
    const r = await as(t.martin).get(`${C()}/versions/1/export.csv`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/csv/);
    expect(r.text).toContain('Jeanne LAMBERT');
    expect(r.text.split('\n').filter(Boolean)).toHaveLength(6);
  });

  it('relance ceux qui n\'ont pas consulté la convocation, avec le même lien personnel', async () => {
    const before = sent().length;
    const r = await as(t.martin).post(`${C()}/versions/1/relance`, {});
    expect(r.body.relances).toBe(3);
    await env.c.convocations.idle();
    expect(sent().length - before).toBe(3);
    expect(sent().slice(before).every((m) => /^Rappel/.test(m.subject))).toBe(true);
    const paulLink = tokenFor('Paul DURIF');
    expect(sent().slice(before).some((m) => m.html.includes(paulLink))).toBe(true);
    const d = (await as(t.martin).get(`${C()}/versions/1/destinataires`)).body.items.find((x) => x.nom === 'Paul DURIF');
    expect(d.relances).toBe(1);
    expect((await as(t.martin).get(`${C()}/versions/1/journal?type=relance`)).body.total).toBe(3);
  });
});

describe('convocation : modificatif et délai', () => {
  it('un ajout après l\'envoi donne un modificatif : nouvelle version, différences, nouveaux liens ; l\'ancien lien signale la version plus récente', async () => {
    const a3 = await done('Point ajouté après la convocation');
    void a3; // (l'affectation après arrêt a demandé un motif : voir ci-dessous)
    const r = await envoyer({ eluIds: [elus[0].id], agents: [] });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ version: 2, modificatif: true });
    const v2 = (await as(t.martin).get(`${C()}/versions/2`)).body;
    expect(v2.differences.ajoutes).toEqual(['Point ajouté après la convocation']);
    expect(v2.differences.retires).toEqual([]);
    const oldLink = tokenFor('Paul DURIF');
    const open = await pub(oldLink);
    expect(open.body.remplacee).toMatchObject({ version: 2 });
    expect((await as(t.martin).post(`${C()}/versions/1/relance`, {})).status).toBe(409); // seule la dernière version se relance
  });

  it('contrôle le délai légal : refus, urgence avec motif obligatoire, minimum même en urgence', async () => {
    const s3 = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(3) })).body;
    await done('Point pour séance proche', s3.id);
    await as(t.martin).post(`${O(s3.id)}/arret`, { forcer: true });
    const refus = await as(t.martin).post(C(s3.id), { agents: ['durand'] });
    expect(refus.status).toBe(423);
    expect(refus.body.error).toMatch(/délai/i);
    expect((await as(t.martin).post(C(s3.id), { agents: ['durand'], urgence: true })).status).toBe(400);
    const ok = await envoyer({ agents: ['durand'], urgence: true, urgenceMotif: 'Vote du budget à date impérative' }, s3.id);
    expect(ok.status).toBe(202);
    expect(ok.body).toMatchObject({ urgence: true });
    expect(ok.body.avertissement).toMatch(/urgence/);
    const s0 = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(1) })).body;
    await done('Point pour séance demain', s0.id);
    await as(t.martin).post(`${O(s0.id)}/arret`, { forcer: true });
    expect((await as(t.martin).post(C(s0.id), { agents: ['durand'], urgence: true, urgenceMotif: 'Urgence absolue' })).status).toBe(423);
  });
});
