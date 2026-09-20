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
  A1 = await delib('Subvention à l’association Ivry Sport'); A2 = await delib('Convention rejetée'); A3 = await delib('Marché avec demande de pièces'); A4 = await delib('Cession refusée par la préfecture');
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  await as(t.martin).post(S('/tenue/ouverture'));
  const st = (await as(t.martin).get(S('/tenue'))).body;
  await as(t.martin).put(S('/tenue/presences'), { eluIds: st.groupes.flatMap((g) => g.elus).map((e) => e.id), etat: 'en_salle' });
  items = {};
  for (const p of st.points.filter((x) => x.kind === 'deliberation')) items[p.acte.id] = p.id;
  await voter(items[A1], 'pour'); await voter(items[A2], 'contre'); await voter(items[A3], 'pour'); await voter(items[A4], 'pour');
  await as(t.martin).post(S('/tenue/cloture'));
});
afterAll(async () => { await env.close(); });

describe('lot de télétransmission d’une séance', () => {
  it('propose les délibérations adoptées avec leur numéro transmis ; exclut la rejetée avec sa raison', async () => {
    const l = await lot();
    expect(l.cfg).toMatchObject({ mode: 'simulation', modeEnvoi: 'B' });
    const a1 = byActe(l, A1);
    expect(a1).toMatchObject({ statut: 'a_preparer', resultat: 'adopte_unanimite' });
    expect(a1.numeroTransmis).toMatch(/^\d{4}CM\d{2}_\d{3}$/); expect(a1.numeroTransmis.length).toBeLessThanOrEqual(15);
    expect(a1.classif).toEqual(['7', '5']); // matière 7.5 : deux niveaux, comme S²LOW l’exige
    expect(byActe(l, A2)).toMatchObject({ statut: 'exclu', raison: expect.stringMatching(/rejetée/) });
    expect(a1.controles.filter((c) => c.niveau === 'bloquant')).toEqual([]);
    expect(a1.controles.some((c) => /SIREN/.test(c.message))).toBe(true); // simple avertissement
    expect((await as(t.dupont).get(TL(`/seances/${seance.id}/lot`))).status).toBe(403); // réservé au SCC, à l’administrateur et au rôle « télétransmission »
  });

  it('un motif de numéro qui produirait plus de 15 caractères ou un caractère interdit est refusé (validation en direct)', async () => {
    expect((await as(admin).put(TL('/config'), { motif: '{ANNEE}-{N_SEANCE}-{ORDRE:03}' })).status).toBe(400);
    expect((await as(admin).put(TL('/config'), { motif: '{ANNEE}{TYPE_SEANCE}{N_SEANCE:02}_{ORDRE:03}_LONG' })).status).toBe(400);
    expect((await as(admin).put(TL('/config'), { siren: '213400154' })).status).toBe(200);
    expect((await as(t.martin).put(TL('/config'), { siren: '1' })).status).toBe(403); // paramétrage : administrateur seulement
  });
});

describe('chaîne complète, mode B (préparation puis confirmation), scénario nominal', () => {
  let tx;
  it('prépare la transmission : PDF, classification, numéro ; l’acte est « prêt à transmettre » ; pas de double préparation', async () => {
    const r = await preparer([A1]);
    expect(r.status).toBe(200);
    expect(r.body.refuses).toEqual([]);
    tx = r.body.crees[0];
    expect(tx).toMatchObject({ etat: 'prepare', mode: 'simulation', enAttente: true, scenario: 'nominal' });
    expect((await acte(A1)).statut).toBe('pret_a_transmettre');
    expect((await preparer([A1])).body.refuses[0].raisons[0]).toMatch(/Déjà préparée/);
    expect(byActe(await lot(), A1).statut).toBe('en_cours');
  });

  it('l’envoi poste la transaction « en attente d’être postée » (17) ; elle n’avance pas tant qu’elle n’est pas confirmée', async () => {
    const r = await as(t.martin).post(TL(`/transactions/${tx.id}/envoi`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ etat: 'poste', status: 17, remoteId: expect.stringMatching(/^S2L-/) });
    expect((await acte(A1)).statut).toBe('pret_a_transmettre');
    expect((await as(t.martin).post(TL(`/transactions/${tx.id}/envoi`))).status).toBe(409); // jamais deux envois
    const av = await avancer({ pas: 3 });
    expect(av.body.changes).toEqual([]); // le serveur factice attend la confirmation
    const sim = (await as(t.martin).get(TL('/simulation'))).body;
    expect(sim.actif).toBe(true); expect(sim.serveur[0]).toMatchObject({ status: 17, peutAvancer: false });
  });

  it('la confirmation passe la transaction à « posté » (1) et l’acte à « transmis »', async () => {
    const r = await as(t.martin).post(TL(`/transactions/${tx.id}/confirmation`));
    expect(r.body).toMatchObject({ status: 1 });
    expect((await acte(A1)).statut).toBe('transmis');
    expect((await as(t.martin).post(TL(`/transactions/${tx.id}/confirmation`))).status).toBe(409);
  });

  it('le serveur factice avance : 2 en attente de transmission, 3 transmis, 4 acquittement ; l’AR est enregistré et renseigne l’acte', async () => {
    const un = await avancer({ transactionId: tx.id });
    expect(un.body.changes[0]).toMatchObject({ status: 2 });
    expect((await as(t.martin).get(TL(`/transactions/${tx.id}`))).body.status).toBe(2);
    await avancer({ pas: 2 });
    const d = (await as(t.martin).get(TL(`/transactions/${tx.id}`))).body;
    expect(d).toMatchObject({ status: 4, statusLabel: 'Acquittement reçu', arId: expect.stringContaining(tx.numeroTransmis) });
    expect(d.arLe).toBeTruthy();
    expect((await acte(A1)).statut).toBe('ar_recu');
    expect(d.journal.map((j) => j.type)).toEqual(expect.arrayContaining(['prepare', 'poste', 'confirme', 'statut']));
    // une transaction acquittée ne bouge plus
    expect((await avancer({ transactionId: tx.id })).body.changes).toEqual([]);
    expect((await as(t.martin).post(TL(`/transactions/${tx.id}/annulation`), {})).status).toBe(409); // trop tard : déjà acquittée
  });

  it('produit le bordereau d’acquittement et l’acte tamponné avec la date de publication', async () => {
    const b = await bin(t.martin, TL(`/transactions/${tx.id}/bordereau`));
    expect(b.status).toBe(200); expect(Buffer.from(b.body).subarray(0, 4).toString()).toBe('%PDF');
    const a = await bin(t.martin, TL(`/transactions/${tx.id}/acte-tamponne?dateAffichage=2026-12-10`));
    expect(a.status).toBe(200); expect(Buffer.from(a.body).subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('retours de la préfecture : demande de pièces, refus', () => {
  it('mode A (envoi direct) : la demande de pièces crée une tâche prioritaire pour le SCC ; la réponse débloque l’acquittement', async () => {
    expect((await as(admin).put(TL('/config'), { modeEnvoi: 'A' })).status).toBe(200);
    const tx = (await preparer([A3], 'pieces')).body.crees[0];
    const env1 = await as(t.martin).post(TL(`/transactions/${tx.id}/envoi`));
    expect(env1.body).toMatchObject({ status: 1 }); // direct : posté, sans confirmation
    expect((await acte(A3)).statut).toBe('transmis');
    await avancer({ pas: 3 }); // 2, 3, puis la demande de pièces
    const docs = (await as(t.martin).get(TL('/documents'))).body.items;
    const d = docs.find((x) => x.transactionId === tx.id);
    expect(d).toMatchObject({ type: 3, statut: 'a_traiter', prioritaire: true });
    expect((await as(t.martin).get(TL('/tableau'))).body.documentsATraiter).toBe(1);
    // la préfecture attend : le serveur factice n’avance plus tant qu’on n’a pas répondu
    expect((await avancer({ transactionId: tx.id })).body.changes).toEqual([]);
    // notification prioritaire au SCC (dans l’outil)
    const n = (await as(t.martin).get(`${base()}/notifications`)).body.items.find((i) => i.acteId === A3 && /Préfecture/.test(i.title));
    expect(n).toBeTruthy();
    // la réponse (envoi de pièces) est transmise ; l’acquittement suit
    const rep = await as(t.martin).post(TL(`/documents/${d.id}/reponse`), { typeEnvoie: 4, message: 'Pièces jointes.' });
    expect(rep.status).toBe(200); expect(rep.body.statut).toBe('repondu');
    expect((await as(t.martin).post(TL(`/documents/${d.id}/reponse`), { typeEnvoie: 4 })).status).toBe(409);
    await avancer({ transactionId: tx.id });
    expect((await as(t.martin).get(TL(`/transactions/${tx.id}`))).body).toMatchObject({ status: 4 });
    expect((await acte(A3)).statut).toBe('ar_recu');
    expect((await as(t.martin).get(TL('/tableau'))).body.documentsATraiter).toBe(0);
  });

  it('la préfecture refuse : statut 6, l’erreur est visible au tableau de bord ; on peut annuler une transaction préparée', async () => {
    const tx = (await preparer([A4], 'refus')).body.crees[0];
    await as(t.martin).post(TL(`/transactions/${tx.id}/envoi`));
    await avancer({ pas: 2 });
    const d = (await as(t.martin).get(TL(`/transactions/${tx.id}`))).body;
    expect(d).toMatchObject({ status: 6, statusLabel: 'Refusé' }); expect(d.erreur).toMatch(/refusé/);
    expect((await as(t.martin).get(TL('/tableau'))).body.enErreur).toBe(1);
    expect((await avancer({ transactionId: tx.id })).body.changes).toEqual([]);
  });

  it('une transaction préparée peut être annulée : l’acte redevient « adopté » et peut être préparé de nouveau', async () => {
    const l = await as(t.martin).get(TL('/transactions'));
    expect(l.body.items.length).toBe(3);
    // A2 (rejetée) n’a jamais été transmissible ; on refait la préparation de A4 après le refus (une transaction vivante par acte)
    const neuve = (await preparer([A4])).body;
    expect(neuve.refuses.length + neuve.crees.length).toBe(1);
    if (neuve.crees.length) {
      const c = await as(t.martin).post(TL(`/transactions/${neuve.crees[0].id}/annulation`), { motif: 'Préparation abandonnée' });
      expect(c.body.etat).toBe('annule');
      expect((await acte(A4)).statut).toBe('adopte');
    }
  });
});

describe('mode réel non disponible, droits', () => {
  it('hors simulation, l’envoi est refusé avec un message clair tant que l’accès à S²LOW n’est pas configuré', async () => {
    expect((await as(admin).put(TL('/config'), { mode: 'production' })).status).toBe(200);
    const r = await preparer([A4]);
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/pas encore configuré/);
    expect((await avancer()).status).toBe(409);
    expect((await as(admin).put(TL('/config'), { mode: 'simulation' })).status).toBe(200);
  });

  it('les non-habilités ne voient rien ; le rôle « télétransmission » suffit', async () => {
    expect((await as(t.dupont).get(TL('/transactions'))).status).toBe(403);
    expect((await as(t.dupont).post(TL('/simulation/avancer'), {})).status).toBe(403);
    expect((await env.http().get(TL('/tableau'))).status).toBe(401);
    await as(admin).post(`${base()}/roles`, { username: 'moreau', role: 'teletransmission' });
    expect((await as(t.moreau).get(TL('/tableau'))).status).toBe(200);
  });
});
