const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let elus; let items;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const bin = (tok, u) => env.http().get(u).set(bearer(tok)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (p = '') => `${base()}/seances/${seance.id}${p}`;
const TL = (p = '') => `${base()}/teletransmission${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const acte = async (id) => (await as(t.dupont).get(A(id))).body;

async function delib(titre) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  await as(t.martin).post(`${S('/odj/affectations')}`, { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  return a.id;
}

/** Vote de tous les élus présents : « pour » ou « contre » pour tous. */
async function voter(itemId, choix) {
  await as(t.martin).put(S(`/tenue/courant`), { itemId });
  const st = (await as(t.martin).get(S('/tenue'))).body;
  const votes = st.groupes.flatMap((g) => g.elus).map((e) => ({ eluId: e.id, choix }));
  await as(t.martin).put(S(`/tenue/points/${itemId}/votes`), { votes });
  const r = await as(t.martin).post(S(`/tenue/points/${itemId}/cloture`), { issue: 'vote' });
  expect(r.status).toBe(200);
}
const lot = async () => (await as(t.martin).get(TL(`/seances/${seance.id}/lot`))).body;
const byActe = (l, id) => l.items.find((x) => x.acteId === id);
const preparer = (ids, scenario) => as(t.martin).post(TL(`/seances/${seance.id}/preparation`), { itemIds: ids.map((id) => byItem(id)), ...(scenario ? { scenario } : {}) });
const byItem = (acteId) => items[acteId];
const avancer = (body = {}) => as(t.martin).post(TL('/simulation/avancer'), body);

let A1; let A2; let A3; let A4;
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
  elus = [];
  for (const [nom, prenom] of [['Durif', 'Paul'], ['Lambert', 'Jeanne'], ['Morel', 'Yann']]) elus.push((await as(admin).post(`${base()}/elus`, { nom, prenom, role: 'Conseiller municipal' })).body);
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(3) })).body;
  A1 = await delib('Subvention Ivry Sport'); A2 = await delib('Convention de partenariat'); A3 = await delib('Marché de fournitures'); A4 = await delib('Cession de terrain');
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  await as(t.martin).post(S('/tenue/ouverture'));
  const st = (await as(t.martin).get(S('/tenue'))).body;
  await as(t.martin).put(S('/tenue/presences'), { eluIds: st.groupes.flatMap((g) => g.elus).map((e) => e.id), etat: 'en_salle' });
  items = {};
  for (const p of st.points.filter((x) => x.kind === 'deliberation')) items[p.acte.id] = p.id;
  for (const a of [A1, A2, A3, A4]) await voter(items[a], 'pour');
  await as(t.martin).post(S('/tenue/cloture'));
});
afterAll(async () => { await env.close(); });



const config = (b) => as(admin).put(TL('/config'), b);
const tx = async (id) => (await as(t.martin).get(TL(`/transactions/${id}`))).body;
const texte = async (acteId) => { const x = (await as(t.dupont).get(`${A(acteId)}/textes`)).body.items.find((i) => i.kind === 'dispositif'); return x; };
const modifier = (tok, acteId, x, md) => as(tok).put(`${A(acteId)}/textes/${x.id}`, { markdown: md, baseVersion: x.version });

describe('modification de la délibération par le SCC pendant le contrôle de légalité (TLT-32)', () => {
  it('le SCC modifie le texte d’une délibération adoptée ; le rédacteur, non ; désactivable', async () => {
    let x = await texte(A1);
    expect((await modifier(t.dupont, A1, x, 'Coquille corrigée par le rédacteur.')).status).toBe(403);
    const r = await modifier(t.martin, A1, x, 'Article 1 : Une subvention est attribuée (coquille corrigée).');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await as(t.martin).get(`${A(A1)}/textes/${x.id}`)).body.canEdit).toBe(true);
    expect((await config({ modificationTexte: false })).status).toBe(200);
    x = await texte(A1);
    expect((await modifier(t.martin, A1, x, 'Encore une correction.')).status).toBe(403);
    await config({ modificationTexte: true });
  });

  it('une transmission préparée n’est pas envoyée si le texte a changé depuis : annuler, préparer de nouveau', async () => {
    const p = await preparer([A2]);
    expect(p.status, JSON.stringify(p.body)).toBe(200); const id = p.body.crees[0].id;
    const x = await texte(A2);
    expect((await modifier(t.martin, A2, x, 'Article 1 : texte corrigé après la préparation.')).status).toBe(200);
    const e = await as(t.martin).post(TL(`/transactions/${id}/envoi`));
    expect(e.status).toBe(409); expect(e.body.error).toMatch(/modifié depuis la préparation/);
    expect((await as(t.martin).post(TL(`/transactions/${id}/annulation`), {})).status).toBe(200);
    const p2 = await preparer([A2]); expect(p2.status, JSON.stringify(p2.body)).toBe(200); expect(p2.body.crees).toHaveLength(1);
    expect((await as(t.martin).post(TL(`/transactions/${p2.body.crees[0].id}/envoi`))).status).toBe(200);
    await as(t.martin).post(TL(`/transactions/${p2.body.crees[0].id}/confirmation`));
    // transmis : plus de modification
    const y = await texte(A2);
    expect((await modifier(t.martin, A2, y, 'Trop tard.')).status).toBe(403);
  });
});

describe('envoi et confirmation en masse (TLT-31)', () => {
  it('envoie plusieurs transmissions d’un coup ; une erreur n’arrête pas les autres ; confirmation en masse', async () => {
    const p = await preparer([A1, A3]); expect(p.body.crees).toHaveLength(2);
    const ids = p.body.crees.map((c) => c.id);
    const r = await as(t.martin).post(TL('/transactions/envoi-lot'), { ids: [...ids, 999999] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ envoyees: 2, refusees: 1 });
    expect(r.body.items.filter((i) => i.ok).map((i) => i.etat)).toEqual(['en_attente_confirmation', 'en_attente_confirmation']);
    expect(r.body.items.find((i) => !i.ok)).toMatchObject({ id: 999999 });
    // déjà postées : refusées avec la raison, sans effet
    const encore = await as(t.martin).post(TL('/transactions/envoi-lot'), { ids });
    expect(encore.body.refusees).toBe(2); expect(encore.body.items[0].erreur).toMatch(/déjà été postée/);
    const c = await as(t.martin).post(TL('/transactions/confirmation-lot'), { ids });
    expect(c.body).toMatchObject({ envoyees: 2, refusees: 0 });
    for (const id of ids) expect(await tx(id)).toMatchObject({ status: 1 });
    for (const a of [A1, A3]) expect((await acte(a)).statut).toBe('transmis');
    expect((await as(t.dupont).post(TL('/transactions/envoi-lot'), { ids })).status).toBe(403);
  });
});

describe('workflow d’envoi paramétrable (TLT-33)', () => {
  it('valide le paramétrage : envoi automatique et double validation incompatibles, au moins un rôle', async () => {
    expect((await config({ envoiAuto: true, doubleValidation: true })).status).toBe(400);
    expect((await config({ rolesEnvoi: [] })).status).toBe(400);
    expect((await config({ modeEnvoi: 'A', confirmationAuto: true })).status).toBe(400);
    const c = (await as(admin).get(TL('/config'))).body;
    expect(c).toMatchObject({ rolesEnvoi: ['org_admin', 'scc', 'teletransmission'], envoiAuto: false, confirmationAuto: false, preparationAuto: false, modificationTexte: true });
  });

  it('préparation automatique à la clôture, puis rôles autorisés à envoyer : le SCC exclu ne peut ni envoyer ni confirmer', async () => {
    // préparation automatique (le circuit l’enclenche à la clôture de la séance ; on rejoue l’événement)
    const ctx = await env.c.access.loadContext('martin');
    expect(await env.c.tlt.preparationAuto({ organismeId: ville.id, seanceId: seance.id, ctx })).toBeNull(); // désactivée par défaut
    expect((await config({ preparationAuto: true })).status).toBe(200);
    const auto = await env.c.tlt.preparationAuto({ organismeId: ville.id, seanceId: seance.id, ctx });
    expect(auto.crees).toHaveLength(1); const id = auto.crees[0].id;
    await config({ preparationAuto: false });
    const audit = await env.db.get("SELECT actor, on_behalf_of FROM audit_log WHERE action = 'tlt.preparation_auto'");
    expect(audit).toMatchObject({ actor: 'system', on_behalf_of: 'martin' });

    expect((await config({ rolesEnvoi: ['org_admin'] })).status).toBe(200);
    const r = await as(t.martin).post(TL('/transactions/envoi-lot'), { ids: [id] });
    expect(r.body.items[0].erreur).toMatch(/rôle ne permet pas/);
    expect((await as(t.martin).post(TL(`/transactions/${id}/envoi`))).status).toBe(403);
    await config({ rolesEnvoi: ['org_admin', 'scc', 'teletransmission'] });

    // « Préparer et envoyer » avec confirmation automatique : la transmission est postée d’un seul geste, le numéro annulé est réutilisé
    expect((await as(t.martin).post(TL(`/transactions/${id}/annulation`), {})).status).toBe(200);
    expect((await config({ confirmationAuto: true })).status).toBe(200);
    const p = await as(t.martin).post(TL(`/seances/${seance.id}/preparation`), { itemIds: [byItem(A4)], envoyer: true });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.envois).toMatchObject({ envoyees: 1, refusees: 0 });
    expect(await tx(p.body.crees[0].id)).toMatchObject({ status: 1, etat: 'poste' });
    expect((await acte(A4)).statut).toBe('transmis');
    await config({ confirmationAuto: false });
  });
});
