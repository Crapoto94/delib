const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let acteIds; let items; let elus; let groupe;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (p = '') => `${base()}/seances/${seance.id}${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const etat = async () => (await as(t.martin).get(S('/tenue'))).body;
const dispositif = async (acteId) => {
  const tx = (await as(admin).get(`${A(acteId)}/textes`)).body.items.find((x) => x.kind === 'dispositif');
  return { id: tx.id, ...(await as(admin).get(`${A(acteId)}/textes/${tx.id}?mode=propre`)).body };
};

async function delib(titre) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: x.kind === 'dispositif' ? 'Article 1 : une subvention de 3 000 € est accordée.' : `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  await as(t.martin).post(S('/odj/affectations'), { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  return a.id;
}
const courant = (itemId) => as(t.martin).put(S('/tenue/courant'), { itemId });
const deposer = (itemId, extra = {}) => as(t.martin).post(S(`/tenue/points/${itemId}/amendements`), { cible: 'dispositif', textePropose: 'Article 1 : une subvention de 2 000 € est accordée.', auteurEluId: elus[0].id, motif: 'Réduire le montant', ...extra });
const votesA = (amendId, choix, ids) => as(t.martin).put(S(`/tenue/amendements/${amendId}/votes`), { votes: ids.map((eluId) => ({ eluId, choix })) });
const cloA = (amendId, issue = 'vote') => as(t.martin).post(S(`/tenue/amendements/${amendId}/cloture`), { issue });

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
  groupe = (await as(admin).post(`${base()}/groupes-politiques`, { nom: 'Majorité', ordre: 1 })).body;
  elus = [];
  for (const [nom, prenom] of [['Durif', 'Paul'], ['Lambert', 'Jeanne'], ['Morel', 'Yann']]) elus.push((await as(admin).post(`${base()}/elus`, { nom, prenom, role: 'Conseiller municipal', groupeId: groupe.id })).body);
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(3) })).body;
  acteIds = [await delib('Subvention à l’association Ivry Sport'), await delib('Convention avec le théâtre')];
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  await as(t.martin).post(S('/tenue/ouverture'));
  const st = await etat();
  await as(t.martin).put(S('/tenue/presences'), { eluIds: st.groupes.flatMap((g) => g.elus).map((e) => e.id), etat: 'en_salle' });
  items = {}; for (const p of st.points.filter((x) => x.kind === 'deliberation')) items[p.acte.id] = p.id;
});
afterAll(async () => { await env.close(); });

describe('dépôt d’un amendement (LIVE-14)', () => {
  it('numérotés dans le point, auteur élu / groupe / libre ; contrôles ; réservé au secrétariat', async () => {
    const it = items[acteIds[0]];
    const cur = await as(t.martin).get(S(`/tenue/points/${it}/amendements/texte?cible=dispositif`));
    expect(cur.body.markdown).toMatch(/3 000/);
    expect((await deposer(it, { textePropose: 'Article 1 : une subvention de 3 000 € est accordée.' })).status).toBe(400); // identique
    expect((await deposer(it, { auteurEluId: undefined })).status).toBe(400);                                                // sans auteur
    expect((await deposer(it, { cible: 'annexe' })).status).toBe(400);
    expect((await as(t.dupont).post(S(`/tenue/points/${it}/amendements`), { cible: 'dispositif', textePropose: 'x', auteurLibelle: 'Moi' })).status).toBe(403);
    const a1 = await deposer(it);
    expect(a1.status).toBe(200);
    expect(a1.body.amendements).toEqual([expect.objectContaining({ numero: 1, auteur: 'Paul Durif', cible: 'dispositif', statut: 'depose' })]);
    await deposer(it, { textePropose: 'Article 1 : aucune subvention n’est accordée.', auteurEluId: undefined, auteurGroupeId: groupe.id });
    const a3 = (await deposer(it, { textePropose: 'Article 1 : subvention de 3 000 € ; article 2 : rapport d’emploi.', auteurEluId: undefined, auteurLibelle: 'Un habitant' })).body.amendements;
    expect(a3.map((a) => [a.numero, a.auteur])).toEqual([[1, 'Paul Durif'], [2, 'Groupe Majorité'], [3, 'Un habitant']]);
    expect(env.db && (await env.db.get('SELECT count(*)::int AS n FROM seance_journal WHERE type = \'amendement_depose\'')).n).toBe(3);
  });
});

describe('vote des amendements avant le texte (VOT-06)', () => {
  const ids = async () => (await etat()).groupes.flatMap((g) => g.elus).map((e) => e.id);
  const pt = () => items[acteIds[0]];
  const am = async (n) => (await etat()).amendements.find((a) => a.itemId === pt() && a.numero === n);

  it('le point doit être en cours ; il ne peut pas être voté tant qu’un amendement reste à traiter', async () => {
    const a1 = await am(1);
    expect((await votesA(a1.id, 'pour', await ids())).status).toBe(409);            // point pas encore ouvert
    expect((await courant(pt())).status).toBe(200);
    const c = await as(t.martin).post(S(`/tenue/points/${pt()}/cloture`), { issue: 'vote' });
    expect(c.status).toBe(409); expect(c.body.error).toMatch(/amendement/);
  });

  it('adopté : le texte est modifié avec suivi au nom de l’amendement, l’état antérieur est conservé', async () => {
    const a1 = await am(1);
    expect((await votesA(a1.id, 'pour', [elus[0].id, elus[1].id])).status).toBe(200);
    const inc = await cloA(a1.id); expect(inc.status).toBe(409); expect(inc.body.error).toMatch(/doivent encore voter/); // un élu n'a pas voté
    await votesA(a1.id, 'pour', await ids());
    const live = (await am(1)).decompteLive; expect(live).toMatchObject({ contre: 0 }); expect(live.pour).toBeGreaterThanOrEqual(3);
    const ok = await cloA(a1.id); expect(ok.body.error, 'cloture').toBeUndefined();
    const apres = ok.body.amendements.find((a) => a.id === a1.id);
    expect(apres).toMatchObject({ statut: 'adopte', resultat: 'adopte_unanimite', decompte: { contre: 0 } });
    expect((await dispositif(acteIds[0])).markdown).toMatch(/2 000/);
    const row = await env.db.get('SELECT texte_avant, version_apres FROM seance_amendements WHERE id = $1', [a1.id]);
    expect(row.texte_avant).toMatch(/3 000/); expect(row.version_apres).toBeGreaterThan(1);
    const v = await env.db.get("SELECT author, reason FROM text_versions v JOIN tracked_texts x ON x.id = v.text_id WHERE x.acte_id = $1 AND x.kind = 'dispositif' ORDER BY v.version_no DESC LIMIT 1", [acteIds[0]]);
    expect(v).toEqual({ author: `amendement-${a1.id}`, reason: 'Amendement n°1' });
    expect((await cloA(a1.id)).status).toBe(409);                              // déjà clos
  });

  it('rejeté : le texte ne change pas ; retiré : idem ; contre majoritaire', async () => {
    const avant = (await dispositif(acteIds[0])).markdown;
    const a2 = await am(2);
    await votesA(a2.id, 'contre', await ids());
    const r = await cloA(a2.id);
    expect(r.body.amendements.find((a) => a.id === a2.id)).toMatchObject({ statut: 'rejete', resultat: 'rejete' });
    expect((await dispositif(acteIds[0])).markdown).toBe(avant);
    const a3 = await am(3);
    const ret = await cloA(a3.id, 'retire');
    expect(ret.body.amendements.find((a) => a.id === a3.id).statut).toBe('retire');
    expect((await dispositif(acteIds[0])).markdown).toBe(avant);
  });

  it('absents : ne votent pas ; le point se vote ensuite normalement sur le texte amendé ; procès-verbal', async () => {
    const st = await etat();
    expect(st.amendements.filter((a) => a.itemId === pt()).map((a) => a.statut)).toEqual(['adopte', 'rejete', 'retire']);
    await as(t.martin).put(S(`/tenue/points/${pt()}/votes`), { votes: (await ids()).map((eluId) => ({ eluId, choix: 'pour' })) });
    const c = await as(t.martin).post(S(`/tenue/points/${pt()}/cloture`), { issue: 'vote' });
    expect(c.status).toBe(200);
    expect((await as(admin).get(`${A(acteIds[0])}`)).body.statut).toBe('adopte');
    const pv = await env.http().get(S('/proces-verbal')).set(bearer(t.martin)).buffer(true).parse((res, cb) => { const ch = []; res.on('data', (x) => ch.push(x)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(pv.status).toBe(200); expect(pv.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('autre point sans amendement inchangé ; un point non délibération ne reçoit pas d’amendement', async () => {
    const it2 = items[acteIds[1]];
    await courant(it2);
    expect((await etat()).amendements.filter((a) => a.itemId === it2)).toEqual([]);
    expect((await as(t.martin).post(S('/tenue/points/999999/amendements'), { cible: 'dispositif', textePropose: 'x', auteurLibelle: 'Z' })).status).toBe(404);
  });
});

describe('amendements dans l’espace des élus (ELU-41)', () => {
  it('le texte proposé est poussé aux élus dès son dépôt ; le sort n’est montré que si l’organisme affiche les résultats ; jamais de décompte', async () => {
    const v = await env.c.tenue.directPublic(ville.id, seance.id, 0, 0, { resultats: true });
    const du = v.amendements.filter((a) => a.itemId === items[acteIds[0]]);
    expect(du.map((a) => [a.numero, a.statut])).toEqual([[1, 'adopte'], [2, 'rejete'], [3, 'retire']]);
    expect(du[0]).toMatchObject({ auteur: 'Paul Durif', cible: 'dispositif' }); expect(du[0].texte).toMatch(/2 000/);
    const masque = await env.c.tenue.directPublic(ville.id, seance.id, 0, 0, { resultats: false });
    expect(masque.amendements.filter((a) => a.itemId === items[acteIds[0]]).map((a) => a.statut)).toEqual(['traite', 'traite', 'retire']);
    expect(JSON.stringify(v.amendements)).not.toMatch(/pour|contre|votants|absents/);
    // un nouvel amendement déposé sur l'autre point est visible « à voter » tout de suite
    await as(t.martin).put(S('/tenue/courant'), { itemId: items[acteIds[1]] });
    await deposer(items[acteIds[1]], { textePropose: 'Article 1 : autre texte proposé.' });
    const apres = await env.c.tenue.directPublic(ville.id, seance.id, 0, 0, { resultats: false });
    expect(apres.amendements.find((a) => a.itemId === items[acteIds[1]])).toMatchObject({ statut: 'a_voter', numero: 1 });
    expect(apres.version).toBeGreaterThan(v.version);
  });
});
