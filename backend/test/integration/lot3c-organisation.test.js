const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { createTitulaires } = require('../../src/modules/titulaires/titulaires.service');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubrique;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const O = () => `${base()}/organisation`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin', financier: 'moreau' };

async function acte(titre = 'Dossier de test') {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubrique.id, incidenceFinanciere: false, rapporteurId: 1 });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  return a;
}
const circuit = async (id) => (await as(t.dupont).get(`${A(id)}/circuit`)).body;
const step = (v, key) => v.path.find((p) => p.key === key);
const submit = async (id) => (await as(t.dupont).post(`${A(id)}/envoi`)).body;
const validate = (user, id) => as(t[user]).post(`${A(id)}/validation`, {});

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit'], ['martin', 'pw-martin'], ['nouveau', 'pw-nouveau'], ['moreau', 'pw-moreau']]) t[u] = await loginAs(env, u, p);
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5'); rubrique = (await items('rubrique')).find((x) => x.libelle === 'FINANCES');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  const groups = (await as(admin).get(`${base()}/groupes`)).body.items;
  const setMembers = (code, usernames) => as(admin).put(`${base()}/groupes/${groups.find((g) => g.code === code).id}/membres`, { usernames });
  await setMembers('financier', ['moreau']); await setMembers('juridique', ['nouveau']); await setMembers('scc', ['martin']);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' });
  await tit('dgs', 'boot');
});
afterAll(async () => { await env.close(); });

describe('DGA : postes, rattachement des directions, DGS directe', () => {
  let posteRh; let posteSocial;
  it('un DGA encadre plusieurs directions ; un poste sans directions se supprime, un poste qui en encadre non', async () => {
    posteRh = (await as(admin).post(`${O()}/postes-dga`, { libelle: 'DGA Ressources', username: 'petit' })).body;
    posteSocial = (await as(admin).post(`${O()}/postes-dga`, { libelle: 'DGA Population', vacant: true })).body;
    expect(posteRh).toMatchObject({ libelle: 'DGA Ressources', username: 'petit', vacant: false, directions: [] });
    expect(posteSocial).toMatchObject({ vacant: true, username: null });
    expect((await as(admin).post(`${O()}/postes-dga`, { libelle: 'DGA Ressources', username: 'x' })).status).toBe(409);
    expect((await as(admin).post(`${O()}/postes-dga`, { libelle: 'Sans titulaire' })).status).toBe(400);
    expect((await as(admin).post(`${O()}/postes-dga`, { libelle: 'Incohérent', username: 'petit', vacant: true })).status).toBe(400);
    expect((await as(t.dupont).post(`${O()}/postes-dga`, { libelle: 'Interdit', username: 'petit' })).status).toBe(403);
    for (const code of ['A1', 'A2']) expect((await as(admin).put(`${O()}/directions/${code}/rattachement`, { rattachement: 'dga', dgaPosteId: posteRh.id })).status).toBe(200);
    const postes = (await as(admin).get(`${O()}/postes-dga`)).body.items;
    expect(postes.find((p) => p.id === posteRh.id).directions).toEqual(['A1', 'A2']);
    expect((await as(admin).del(`${O()}/postes-dga/${posteRh.id}`)).status).toBe(409);
    expect((await as(admin).del(`${O()}/postes-dga/${posteSocial.id}`)).status).toBe(204);
    expect((await as(admin).put(`${O()}/directions/A3/rattachement`, { rattachement: 'dga' })).status).toBe(400);
    expect((await as(admin).put(`${O()}/directions/A3/rattachement`, { rattachement: 'dga', dgaPosteId: 999999 })).status).toBe(400);
  });

  it('l\'étape DGA d\'un dossier est tenue par le titulaire du poste qui encadre sa direction, avant la DGS', async () => {
    const a = await acte('Dossier de la direction A1');
    const v = await submit(a.id);
    expect(step(v, 'dga')).toMatchObject({ holders: ['petit'] });
    const keys = v.path.filter((p) => p.state !== 'skipped').map((p) => p.key);
    expect(keys.indexOf('dga')).toBeLessThan(keys.indexOf('dgs')); // un DGA répond toujours à la DGS
  });

  it('une direction rattachée directement à la DGS n\'a pas d\'étape DGA (contournée et signalée)', async () => {
    await as(admin).put(`${O()}/directions/A1/rattachement`, { rattachement: 'dgs' });
    const a = await acte('Dossier rattaché à la DGS');
    const v = await submit(a.id);
    expect(step(v, 'dga')).toMatchObject({ state: 'skipped', reason: 'dgs_direct' });
    expect(v.path.filter((p) => p.state !== 'skipped').map((p) => p.key)).not.toContain('dga');
    await as(admin).put(`${O()}/directions/A1/rattachement`, { rattachement: 'dga', dgaPosteId: posteRh.id });
  });

  it('un poste de DGA vacant fait contourner l\'étape, qui redevient active quand le poste est pourvu', async () => {
    await as(admin).put(`${O()}/postes-dga/${posteRh.id}`, { libelle: 'DGA Ressources', vacant: true });
    const a = await acte('Dossier avec DGA vacant');
    const v = await submit(a.id);
    expect(step(v, 'dga')).toMatchObject({ state: 'skipped', reason: 'vacant' });
    await as(admin).put(`${O()}/postes-dga/${posteRh.id}`, { libelle: 'DGA Ressources', username: 'petit' });
    const b = await acte('Dossier avec DGA pourvu');
    expect(step(await submit(b.id), 'dga')).toMatchObject({ holders: ['petit'] });
  });

  it('un DGA voit les dossiers des directions qu\'il encadre', async () => {
    const a = await acte('Dossier visible du DGA');
    await as(t.dupont).post(`${A(a.id)}/envoi`);
    expect((await as(t.petit).get(A(a.id))).status).toBe(200);
  });
});

describe('postes vacants', () => {
  it('un responsable de direction déclaré vacant est contourné automatiquement ; un poste ne peut être à la fois vacant et pourvu', async () => {
    const dir = (await as(admin).get(`${base()}/titulaires?fonction=directeur`)).body.items.find((x) => x.directionCode === 'A1');
    expect((await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', vacant: true, username: 'leroy', directionCode: 'A1' })).status).toBe(400);
    expect((await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', directionCode: 'A1' })).status).toBe(400); // ni agent ni vacant
    await as(admin).del(`${base()}/titulaires/${dir.id}`);
    const vac = await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', vacant: true, directionCode: 'A1' });
    expect(vac.status).toBe(201);
    expect(vac.body).toMatchObject({ vacant: true, username: null });
    const a = await acte('Dossier avec directeur vacant');
    const v = await submit(a.id);
    expect(step(v, 'directeur')).toMatchObject({ state: 'skipped', reason: 'vacant' });
    expect(v.currentStepKey).toBe('chef_service');
    await validate('durand', a.id);
    expect((await circuit(a.id)).currentStepKey).not.toBe('directeur'); // le directeur vacant est passé
    await as(admin).del(`${base()}/titulaires/${vac.body.id}`);
    await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'leroy', directionCode: 'A1' });
  });

  it('la DGS ne peut pas être déclarée vacante', async () => {
    expect((await as(admin).post(`${base()}/titulaires`, { fonction: 'dgs', vacant: true })).status).toBe(400);
  });
});

describe('règles de résolution en mémoire (service du nom de la direction, vacance RH)', () => {
  const tit = createTitulaires({ db: null, audit: null, access: null });
  const data = (rows = [], rts = [], postes = []) => ({ rows, postes: new Map(postes.map((p) => [p.id, p])), rts: new Map(rts.map((r) => [r.direction_code, r])) });
  const row = (fonction, perimetre, over = {}) => ({ fonction, perimetre, direction_code: 'D1', service_code: null, username: 'x', suppleant: null, vacant: false, ...over });

  it('le chef d\'un service qui porte le nom de sa direction (ou sans service) est le directeur', () => {
    const d = data([row('directeur', 'direction', { username: 'dir' }), row('chef_service', 'service', { service_code: 'S1', username: 'chef' })]);
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'D1', serviceCode: 'S1', serviceSameAsDirection: true })).toMatchObject({ holders: ['dir'], via: 'directeur' });
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'D1' })).toMatchObject({ holders: ['dir'], via: 'directeur' });
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'D1', serviceCode: 'S1' })).toMatchObject({ holders: ['chef'], via: null });
  });

  it('un directeur vacant rend vacant le chef de service du même nom ; la vacance RH ne joue que si personne n\'est désigné', () => {
    const vac = data([row('directeur', 'direction', { username: null, vacant: true })]);
    expect(tit.resolveIn(vac, 'chef_service', { directionCode: 'D1', serviceCode: 'S1', serviceSameAsDirection: true }).vacant).toBe(true);
    const rhv = (d, s) => ({ direction: d === 'D1', service: s === 'S9' });
    expect(tit.resolveIn(data(), 'directeur', { directionCode: 'D1' }, rhv)).toMatchObject({ vacant: true, via: 'rh' });
    expect(tit.resolveIn(data([row('directeur', 'direction', { username: 'dir' })]), 'directeur', { directionCode: 'D1' }, rhv)).toMatchObject({ vacant: false, holders: ['dir'] });
    expect(tit.resolveIn(data(), 'chef_service', { directionCode: 'D1', serviceCode: 'S9' }, rhv)).toMatchObject({ vacant: true, via: 'rh' });
    expect(tit.resolveIn(data(), 'chef_service', { directionCode: 'D1', serviceCode: 'S1' }, rhv)).toMatchObject({ vacant: false, holders: [] });
    expect(tit.resolveIn(data(), 'dgs', {}, rhv)).toMatchObject({ vacant: false, holders: [] }); // jamais de vacance présumée pour la DGS
  });

  it('sans DGS désigné, le DGS est le directeur de la Direction générale de l’organigramme RH ; un DGS désigné reste prioritaire (D76)', () => {
    const dg = (rows) => ({ ...data(rows), dg: 'DG' });
    const dirDG = row('directeur', 'direction', { direction_code: 'DG', username: 'hbourdelet' });
    expect(tit.resolveIn(dg([dirDG]), 'dgs', {})).toMatchObject({ holders: ['hbourdelet'], via: 'direction_generale', vacant: false });
    expect(tit.resolveIn(dg([dirDG, row('dgs', 'organisme', { username: 'demo.dgs' })]), 'dgs', {})).toMatchObject({ holders: ['demo.dgs'], via: null });
    expect(tit.resolveIn(dg([]), 'dgs', {})).toMatchObject({ holders: [], vacant: false }); // direction générale sans titulaire : à renseigner, jamais contournée
  });
});

describe('validation implicite d\'une personne qui valide plusieurs étapes de suite', () => {
  it('chef de service ET directeur : une seule validation, l\'étape suivante est implicite et tracée', async () => {
    const chef = (await as(admin).get(`${base()}/titulaires?fonction=chef_service`)).body.items[0];
    const dir = (await as(admin).get(`${base()}/titulaires?fonction=directeur`)).body.items.find((x) => x.directionCode === 'A1');
    await as(admin).del(`${base()}/titulaires/${chef.id}`); await as(admin).del(`${base()}/titulaires/${dir.id}`);
    await as(admin).post(`${base()}/titulaires`, { fonction: 'chef_service', username: 'leroy', directionCode: 'A1', serviceCode: 'A1a' });
    await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'leroy', directionCode: 'A1' });
    const a = await acte('Dossier validé une seule fois');
    const v = await submit(a.id);
    expect(v.currentStepKey).toBe('chef_service');
    expect((await validate('leroy', a.id)).status).toBe(200);
    const after = await circuit(a.id);
    expect(after.currentStepKey).not.toBe('directeur'); // déjà validée, implicitement
    const dirStep = step(after, 'directeur');
    expect(dirStep.state).toBe('done');
    expect(dirStep.instance).toMatchObject({ decision: 'auto', actedBy: 'leroy' });
    expect(after.events.some((e) => e.action === 'auto_validate' && e.to === 'directeur')).toBe(true);
  });

  it('le paramètre `circuit.dedupe = false` rétablit deux validations distinctes', async () => {
    await as(admin).put(`${base()}/settings/circuit.dedupe`, { value: false, scope: 'organisme' });
    const a = await acte('Dossier validé deux fois');
    await submit(a.id);
    await validate('leroy', a.id);
    expect((await circuit(a.id)).currentStepKey).toBe('directeur');
    await as(admin).del(`${base()}/settings/circuit.dedupe?scope=organisme`);
  });
});

describe('vue « organisation »', () => {
  it('donne, rôle par rôle, qui valide, ce qui est vacant et ce qui est à renseigner', async () => {
    const r = await as(admin).get(O());
    expect(r.status).toBe(200);
    expect(r.body.dgs).toMatchObject({ statut: 'personne', holders: ['boot'] });
    expect(r.body.postesDga.length).toBeGreaterThan(0);
    expect(r.body.resume).toMatchObject({ directions: expect.any(Number), manques: expect.any(Number), vacants: expect.any(Number) });
    expect((await as(t.dupont).get(O())).status).toBe(403);
  });
});

describe('étape de refus et CRUD des circuits', () => {
  let def; let draft;
  it('crée, duplique, modifie et supprime un circuit ; refuse de supprimer le dernier circuit publié ou un circuit utilisé', async () => {
    const list = (await as(admin).get(`${base()}/circuits`)).body.items;
    const std = list.find((c) => c.code === 'ivry-standard');
    expect((await as(admin).del(`${base()}/circuits/${std.id}`)).status).toBe(409); // dernier circuit publié
    def = (await as(admin).post(`${base()}/circuits`, { code: 'court', nom: 'Circuit court', fromTemplate: 'simple' })).body;
    expect(def.versions).toHaveLength(1);
    const dup = await as(admin).post(`${base()}/circuits/${def.id}/duplication`, { code: 'court-bis', nom: 'Copie du circuit court' });
    expect(dup.status).toBe(201);
    expect((await as(admin).post(`${base()}/circuits/${def.id}/duplication`, { code: 'court-bis', nom: 'Doublon' })).status).toBe(409);
    const maj = await as(admin).put(`${base()}/circuits/${dup.body.id}`, { nom: 'Copie renommée', directionCode: 'A1' });
    expect(maj.body).toMatchObject({ nom: 'Copie renommée', directionCode: 'A1' });
    expect((await as(admin).del(`${base()}/circuits/${dup.body.id}`)).status).toBe(204);
    expect((await as(admin).get(`${base()}/circuits/${dup.body.id}`)).status).toBe(404);
    expect((await as(t.dupont).post(`${base()}/circuits`, { code: 'interdit', nom: 'Interdit' })).status).toBe(403);
    // un circuit utilisé par un dossier ne se supprime pas
    const a = await acte('Dossier qui fixe le circuit');
    await submit(a.id);
    expect((await as(admin).del(`${base()}/circuits/${std.id}`)).status).toBe(409);
  });

  it('un brouillon se supprime, jamais une version publiée', async () => {
    const list = (await as(admin).get(`${base()}/circuits`)).body.items;
    const std = list.find((c) => c.code === 'ivry-standard');
    draft = (await as(admin).post(`${base()}/circuits/${std.id}/versions`, { comment: 'Brouillon de test' })).body;
    expect((await as(admin).del(`${base()}/circuits/${std.id}/versions/${draft.version}`)).status).toBe(204);
    const published = std.versions.find((v) => v.status === 'published');
    expect((await as(admin).del(`${base()}/circuits/${std.id}/versions/${published.version}`)).status).toBe(409);
  });

  it('valide l\'étape de refus : elle doit exister et se trouver en amont', async () => {
    const std = (await as(admin).get(`${base()}/circuits`)).body.items.find((c) => c.code === 'ivry-standard');
    const d = (await as(admin).post(`${base()}/circuits/${std.id}/versions`, { comment: 'Étapes de refus' })).body;
    const g = (await as(admin).get(`${base()}/circuits/${std.id}/versions/${d.version}`)).body.graph;
    const ctl = async (mut) => { const c = JSON.parse(JSON.stringify(g)); mut(c); await as(admin).put(`${base()}/circuits/${std.id}/versions/${d.version}`, c); return (await as(admin).post(`${base()}/circuits/${std.id}/versions/${d.version}/controle`, {})).body; };
    let r = await ctl((c) => { c.steps.find((s) => s.key === 'directeur').refusTo = 'inconnue'; });
    expect(r.errors.map((e) => e.code)).toContain('refus_cible_inconnue');
    r = await ctl((c) => { c.steps.find((s) => s.key === 'directeur').refusTo = 'dga'; });
    expect(r.errors.map((e) => e.code)).toContain('refus_cible_aval');
    r = await ctl((c) => { c.steps.find((s) => s.key === 'directeur').refusTo = 'directeur'; });
    expect(r.errors.map((e) => e.code)).toContain('refus_cible_invalide');
    r = await ctl((c) => { c.steps.find((s) => s.key === 'juridique').refusTo = 'chef_service'; });
    expect(r.ok).toBe(true);
    await as(admin).del(`${base()}/circuits/${std.id}/versions/${d.version}`);
  });

  it('un refus renvoie, sans autre précision, à l\'étape de refus de l\'étape courante — sinon à l\'étape précédente (−1)', async () => {
    const std = (await as(admin).get(`${base()}/circuits`)).body.items.find((c) => c.code === 'ivry-standard');
    const d = (await as(admin).post(`${base()}/circuits/${std.id}/versions`, { comment: 'Refus juridique -> chef de service' })).body;
    const g = (await as(admin).get(`${base()}/circuits/${std.id}/versions/${d.version}`)).body.graph;
    g.steps.find((s) => s.key === 'juridique').refusTo = 'chef_service';
    await as(admin).put(`${base()}/circuits/${std.id}/versions/${d.version}`, g);
    expect((await as(admin).post(`${base()}/circuits/${std.id}/versions/${d.version}/publication`, {})).status).toBe(200);
    // les titulaires reviennent à une situation normale
    for (const x of (await as(admin).get(`${base()}/titulaires`)).body.items.filter((x) => ['chef_service', 'directeur'].includes(x.fonction))) await as(admin).del(`${base()}/titulaires/${x.id}`);
    await as(admin).post(`${base()}/titulaires`, { fonction: 'chef_service', username: 'durand', directionCode: 'A1', serviceCode: 'A1a' });
    await as(admin).post(`${base()}/titulaires`, { fonction: 'directeur', username: 'leroy', directionCode: 'A1' });
    await as(admin).put(`${O()}/directions/A1/rattachement`, { rattachement: 'dgs' }); // pas d'étape DGA : parcours plus court
    const a = await acte('Dossier refusé au juridique');
    await submit(a.id);
    for (const u of ['durand', 'leroy']) await validate(u, a.id);
    let v = await circuit(a.id);
    if (v.currentStepKey === 'financier') await validate('moreau', a.id);
    v = await circuit(a.id);
    expect(v.currentStepKey).toBe('juridique');
    expect((await as(t.nouveau).get(`${A(a.id)}/circuit`)).body.refuseDefault).toBe('chef_service'); // vue de celui qui peut refuser
    const r = await as(t.nouveau).post(`${A(a.id)}/refus`, { motif: 'Base légale à revoir', resume: 'direct' });
    expect(r.status).toBe(200);
    expect(r.body.currentStepKey).toBe('chef_service'); // étape de refus définie, et non l'étape précédente (directeur)
    // une étape sans définition renvoie à l'étape précédente (−1)
    await validate('durand', a.id);
    v = await circuit(a.id);
    expect(v.currentStepKey).toBe('juridique'); // reprise directe chez celui qui a refusé
    await validate('nouveau', a.id);
    const b = await acte('Dossier refusé au DGS');
    await submit(b.id);
    for (const u of ['durand', 'leroy']) await validate(u, b.id);
    for (let i = 0; i < 4; i++) { const c = await circuit(b.id); if (c.currentStepKey === 'dgs') break; await validate(WHO[c.currentStepKey], b.id); }
    const before = await circuit(b.id);
    expect(before.currentStepKey).toBe('dgs');
    expect((await as(t.boot).post(`${A(b.id)}/refus`, { motif: 'Points à préciser', resume: 'direct' })).body.currentStepKey).toBe('juridique'); // −1
  });
});
