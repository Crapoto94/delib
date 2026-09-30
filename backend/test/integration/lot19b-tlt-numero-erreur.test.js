/**
 * Régression : une transmission dont l'envoi a échoué (etat 'erreur', jamais postée à S²LOW) garde le
 * même numéro transmis. La préparer de nouveau levait une violation d'unicité (erreur interne 500) au
 * lieu de réussir. Voir migrations/0084_tlt_numero_erreur_reutilisable.sql.
 */
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let items;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (p = '') => `${base()}/seances/${seance.id}${p}`;
const TL = (p = '') => `${base()}/teletransmission${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const byItem = (acteId) => items[acteId];
const lot = async () => (await as(t.martin).get(TL(`/seances/${seance.id}/lot`))).body;
const preparer = (ids) => as(t.martin).post(TL(`/seances/${seance.id}/preparation`), { itemIds: ids.map((id) => byItem(id)) });

async function delib(titre) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  await as(t.martin).post(S('/odj/affectations'), { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  return a.id;
}

async function voter(itemId) {
  await as(t.martin).put(S('/tenue/courant'), { itemId });
  const st = (await as(t.martin).get(S('/tenue'))).body;
  const votes = st.groupes.flatMap((g) => g.elus).map((e) => ({ eluId: e.id, choix: 'pour' }));
  await as(t.martin).put(S(`/tenue/points/${itemId}/votes`), { votes });
  expect((await as(t.martin).post(S(`/tenue/points/${itemId}/cloture`), { issue: 'vote' })).status).toBe(200);
}

let A1; let A2;
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
  for (const [nom, prenom] of [['Durif', 'Paul'], ['Lambert', 'Jeanne'], ['Morel', 'Yann']]) await as(admin).post(`${base()}/elus`, { nom, prenom, role: 'Conseiller municipal' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(3) })).body;
  A1 = await delib('Subvention Ivry Sport'); A2 = await delib('Convention de partenariat');
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  await as(t.martin).post(S('/tenue/ouverture'));
  const st = (await as(t.martin).get(S('/tenue'))).body;
  await as(t.martin).put(S('/tenue/presences'), { eluIds: st.groupes.flatMap((g) => g.elus).map((e) => e.id), etat: 'en_salle' });
  items = {};
  for (const p of st.points.filter((x) => x.kind === 'deliberation')) items[p.acte.id] = p.id;
  for (const a of [A1, A2]) await voter(items[a]);
  await as(t.martin).post(S('/tenue/cloture'));
});
afterAll(async () => { await env.close(); });

describe('numéro transmis réutilisable après un envoi en erreur (0084)', () => {
  it('re-préparer un acte dont l’envoi a échoué ne provoque plus d’erreur interne', async () => {
    const p = await preparer([A1]);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const id = p.body.crees[0].id;
    const numero = (await env.db.get('SELECT numero_transmis FROM tlt_transactions WHERE id = $1', [id])).numero_transmis;

    // Envoi refusé par S²LOW : la transaction passe en « erreur », jamais postée (remote_id NULL).
    await env.db.run("UPDATE tlt_transactions SET etat = 'erreur', error = 'refus simulé', remote_id = NULL WHERE id = $1", [id]);

    // L’acte redevient « à préparer » (aucune transaction vivante).
    expect((await lot()).items.find((x) => x.acteId === A1).statut).toBe('a_preparer');

    // La nouvelle préparation réutilise le même numéro : elle doit aboutir (avant correctif : 500 « duplicate key »).
    const p2 = await preparer([A1]);
    expect(p2.status, JSON.stringify(p2.body)).toBe(200);
    expect(p2.body.crees).toHaveLength(1);
    const numero2 = (await env.db.get('SELECT numero_transmis FROM tlt_transactions WHERE id = $1', [p2.body.crees[0].id])).numero_transmis;
    expect(numero2).toBe(numero);
  });

  it('un numéro détenu par une transaction vivante reste refusé avec un message clair', async () => {
    const p = await preparer([A2]);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    // A2 a déjà une préparation vivante : le lot la voit « en_cours », on ne peut pas la re-préparer.
    expect((await lot()).items.find((x) => x.acteId === A2).statut).toBe('en_cours');
    const again = await preparer([A2]);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.refuses[0].raisons.join(' ')).toMatch(/Déjà préparée ou transmise/);
  });
});
