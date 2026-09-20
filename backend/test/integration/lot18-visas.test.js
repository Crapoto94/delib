const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { extraire, ordreVisas } = require('../../src/modules/ai/references');
const { normaliserCle, lireCsv } = require('../../src/modules/ai/visas.service');

let env; let admin; let dupont; let durand; let ville; let typeDelib; let matiere; let instance; let seance; let acte;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const V = (p = '') => `${base()}/visas${p}`;
const A = (id, p = '') => `${base()}/actes/${id}${p}`;
const jour = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

async function nouvelActe(titre, textes) {
  const a = (await as(dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(dupont).put(A(a.id), { matiereId: matiere.id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(dupont).get(A(a.id, '/textes'))).body.items) if (textes[x.kind] !== undefined) await as(dupont).put(A(a.id, `/textes/${x.id}`), { markdown: textes[x.kind], baseVersion: x.version });
  return a;
}
const rapport = async (id) => { const r = await as(dupont).get(A(id, '/ia/references')); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body; };
const constat = (r, cle) => r.constats.find((c) => c.cle === cle);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  durand = await loginAs(env, 'durand', 'pw-durand');
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  const items = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await items('matiere')).find((x) => x.code === '7.5');
  typeDelib = (await items('type_acte')).find((x) => x.code === 'deliberation');
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(admin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(10) })).body;
  acte = await nouvelActe('Subvention à une association', {
    visas: [
      "Vu le code général des collectivités territoriales, notamment ses articles L. 2121-29 et L. 2122-22 ;",
      "Vu l'article L. 2311-7 du code général des collectivités territoriales ;",
      'Vu le code de la commande publique ;',
      'Vu la loi n° 2015-991 du 7 août 2015 portant nouvelle organisation territoriale ;',
      "Vu le décret n° 2016-360 du 25 mars 2016 relatif aux marchés publics ;",
      "Vu l'arrêté du 12 mars 2024 relatif aux barèmes ;",
      'Vu la délibération n° 2026-9-999 du conseil municipal ;',
    ].join('\n'),
    expose: 'Le quartier accueille un festival. Une subvention de 18 000 euros est demandée.',
    dispositif: 'Article 1 : Une subvention est attribuée.',
  });
});
afterAll(async () => { await env.close(); });

describe('extraction des références (IA-30) et ordre des visas (IA-35) : règles pures', () => {
  const md = "Vu le code général des collectivités territoriales, notamment ses articles L. 2121-29 et L. 2122-22 ;\nVu l'article R.2121‑1 du CGCT ;\nVu la loi n° 2015-991 du 7 août 2015 ;\nVu le décret n° 2016-360 du 25 mars 2016 ;\nVu l'arrêté du 12 mars 2024 ;\nVu la délibération n° 2026-4-012 du conseil municipal du 3 avril 2026 ;\nVu la délibération du conseil municipal du 5 février 2025 ;\nVu le code de l'urbanisme ;\nConsidérant le code du bidule ;";
  const refs = extraire({ id: 1, kind: 'visas', markdown: md });
  const cles = refs.map((r) => r.cle);

  it('reconnaît articles de code (listes comprises), lois, décrets, arrêtés, délibérations et codes cités seuls', () => {
    expect(cles).toEqual(expect.arrayContaining(['cgct:L2121-29', 'cgct:L2122-22', 'cgct:R2121-1', 'loi:2015-991', 'decret:2016-360', 'arrete:du:2024-03-12', 'delib:2026-4-012', 'delib:du:2025-02-05', 'urbanisme', 'cgct']));
    expect(cles.some((c) => /bidule/.test(c))).toBe(false); // un « code » inconnu et sans article n'est pas une référence exploitable
    expect(refs.find((r) => r.cle === 'loi:2015-991').libelle).toBe('Loi n° 2015-991 du 7 août 2015');
    expect(refs.find((r) => r.cle === 'cgct:L2121-29').extrait).toMatch(/^Vu le code général/);
  });
  it('signale un visa hors de l\'ordre conventionnel (lois et codes, décrets, arrêtés, délibérations)', () => {
    expect(ordreVisas(refs).map((r) => r.cle)).toEqual(['urbanisme']);
  });
  it('normalise les clés de la bibliothèque et lit un CSV', () => {
    expect(normaliserCle('CGCT:l2121-29')).toBe('cgct:L2121-29'); expect(normaliserCle('LOI:2015-991')).toBe('loi:2015-991'); expect(normaliserCle('CCP')).toBe('ccp');
    expect(() => normaliserCle('cgct:zzz')).toThrow(); expect(() => normaliserCle('loi:')).toThrow();
    expect(lireCsv('cle;intitule\n"loi:1";"Loi ; avec point-virgule"\n')).toEqual([{ cle: 'loi:1', intitule: 'Loi ; avec point-virgule' }]);
  });
});

describe('bibliothèque de visas (IA-38)', () => {
  it('lisible par les agents, écrite seulement par l\'administrateur ou le SCC ; fournie vide', async () => {
    expect((await as(dupont).get(V())).body.items).toEqual([]);
    expect((await as(dupont).post(V(), { cle: 'ccp', intitule: 'Code de la commande publique' })).status).toBe(403);
    expect((await as(admin).post(V(), { cle: 'CCP', intitule: 'Code de la commande publique', verifieLe: jour(-1) })).status).toBe(201);
    expect((await as(admin).post(V(), { cle: 'ccp', intitule: 'doublon' })).status).toBe(409);
    expect((await as(admin).post(V(), { cle: 'cgct:zzz', intitule: 'x' })).status).toBe(400);
    expect((await as(admin).post(V(), { cle: 'loi:1', intitule: 'x', dateDebut: '2026-05-01', dateFin: '2026-01-01' })).status).toBe(400);
  });

  it('import JSON et CSV : crée, met à jour par clé, rapporte les lignes en erreur', async () => {
    const json = [
      { cle: 'cgct:L2121-29', intitule: 'Article L. 2121-29 du CGCT', verifieLe: jour(-30), source: 'Légifrance' },
      { cle: 'cgct:L2122-22', intitule: 'Article L. 2122-22 du CGCT', statut: 'modifie', verifieLe: jour(-30) },
      { cle: 'loi:2015-991', intitule: 'Loi NOTRe', verifieLe: jour(-800) },
      { cle: 'decret:2016-360', intitule: 'Décret marchés publics', statut: 'abroge', verifieLe: jour(-30) },
      { cle: 'pas une clé', intitule: 'x' },
    ];
    const r = (await as(admin).post(V('/import'), { format: 'json', contenu: JSON.stringify(json) })).body;
    expect(r.crees).toBe(4); expect(r.erreurs).toHaveLength(1); expect(r.erreurs[0].ligne).toBe(5);
    const csv = 'cle;type;intitule;statut;date_fin;verifie_le;source\ncgct:L2311-7;code;Article L. 2311-7 du CGCT;en_vigueur;;' + jour(-5) + ';Légifrance\ncgct:L2121-29;code;Article L. 2121-29 du CGCT (mis à jour);en_vigueur;;' + jour(-2) + ';JO\n';
    const c = (await as(admin).post(V('/import'), { format: 'csv', contenu: csv })).body;
    expect(c.crees).toBe(1); expect(c.maj).toBe(1); expect(c.erreurs).toEqual([]);
    const l = (await as(dupont).get(V('?q=2121-29'))).body.items;
    expect(l).toHaveLength(1); expect(l[0].intitule).toMatch(/mis à jour/); expect(l[0].code).toBe('cgct'); expect(l[0].article).toBe('L2121-29');
    expect((await as(dupont).get(V('?statut=abroge'))).body.items.map((x) => x.cle)).toEqual(['decret:2016-360']);
  });
});

describe('rapport de vérification d\'un dossier (IA-31, IA-36)', () => {
  it('juge chaque référence : à jour, à revoir (modifié, jamais vérifié depuis 12 mois), obsolète (abrogé), introuvable', async () => {
    const r = await rapport(acte.id);
    const etat = (cle) => r.references.find((x) => x.cle === cle)?.etat;
    expect(etat('cgct:L2121-29')).toBe('a_jour');
    expect(etat('cgct:L2311-7')).toBe('a_jour');
    expect(etat('cgct:L2122-22')).toBe('a_revoir'); expect(constat(r, 'cgct:L2122-22').message).toMatch(/modifié/);
    expect(etat('loi:2015-991')).toBe('a_revoir'); expect(constat(r, 'loi:2015-991').message).toMatch(/depuis plus de 12 mois/);
    expect(etat('decret:2016-360')).toBe('obsolete'); expect(constat(r, 'decret:2016-360')).toMatchObject({ gravite: 'bloquant' });
    expect(etat('arrete:du:2024-03-12')).toBe('introuvable'); expect(constat(r, 'arrete:du:2024-03-12').message).toMatch(/juridique/);
    expect(etat('delib:2026-9-999')).toBe('introuvable');
    expect(etat('ccp')).toBe('a_jour');
    expect(etat('cgct')).toBe('a_jour'); // code cité seul : connu dès que la bibliothèque contient un de ses articles
    expect(constat(r, 'cgct:L2121-29')).toBeUndefined();
    expect(r.constats[0].gravite).toBe('bloquant'); // les plus graves d'abord
    expect(r.resume.bloquant).toBe(1);
    expect(r.constats.find((c) => c.etat === 'ordre')).toBeUndefined(); // ordre respecté : code du CCP en dernier mais de même rang que les lois
  });

  it('juge à la date de la séance visée, pas à celle du jour', async () => {
    const e = (await as(admin).get(V('?q=L2311-7'))).body.items[0];
    await as(admin).put(V(`/${e.id}`), { dateFin: jour(3) }); // encore en vigueur aujourd'hui, plus à la séance (dans 10 jours)
    const r = await rapport(acte.id);
    expect(r.dateReference).toBe(jour(10));
    expect(r.references.find((x) => x.cle === 'cgct:L2311-7').etat).toBe('obsolete');
    expect(constat(r, 'cgct:L2311-7').message).toMatch(/hors de sa période de validité/);
    await as(admin).put(V(`/${e.id}`), { dateFin: null });
  });

  it('« Vérifié aujourd\'hui » remet la référence à jour', async () => {
    const e = (await as(admin).get(V('?q=2015-991'))).body.items[0];
    expect((await as(dupont).post(V(`/${e.id}/verification`), {})).status).toBe(403);
    const v = (await as(admin).post(V(`/${e.id}/verification`), {})).body;
    expect(v.verifiePar).toBeTruthy(); expect(v.verifieLe).toBe(jour(0));
    expect(constat(await rapport(acte.id), 'loi:2015-991')).toBeUndefined();
  });

  it('délibération antérieure : introuvable, ou adoptée dans l\'organisme', async () => {
    const autre = await nouvelActe('Délibération antérieure', {});
    await env.db.run("UPDATE actes SET statut = 'adopte' WHERE id = $1", [autre.id]);
    const it = await env.db.get("INSERT INTO seance_items (organisme_id, seance_id, position, kind, acte_id, numero, created_by) VALUES ($1,$2,1,'deliberation',$3,'2026-9-999','admin') RETURNING id", [ville.id, seance.id, autre.id]);
    await env.db.run("INSERT INTO seance_points (item_id, seance_id, resultat) VALUES ($1,$2,'adopte_unanimite')", [it.id, seance.id]);
    const r = await rapport(acte.id);
    expect(r.references.find((x) => x.cle === 'delib:2026-9-999').etat).toBe('a_jour');
    expect(constat(r, 'delib:2026-9-999')).toBeUndefined();
    await env.db.run("UPDATE seance_points SET resultat = 'rejete_preponderante' WHERE item_id = $1", [it.id]);
    await env.db.run("UPDATE actes SET statut = 'rejete' WHERE id = $1", [autre.id]);
    expect(constat(await rapport(acte.id), 'delib:2026-9-999').message).toMatch(/n'a pas été adoptée/);
  });

  it('sans bibliothèque, dit qu\'elle est vide au lieu d\'accuser chaque référence', async () => {
    const orphelin = await nouvelActe('Dossier isolé', { visas: "Vu l'article L. 2121-29 du code général des collectivités territoriales ;" });
    // une autre collectivité n'a pas de bibliothèque : on la simule en vidant la nôtre le temps du test
    const sauve = await env.db.all('SELECT * FROM visa_library WHERE organisme_id = $1', [ville.id]);
    await env.db.run('DELETE FROM visa_library WHERE organisme_id = $1', [ville.id]);
    try {
      const r = await rapport(orphelin.id);
      expect(r.bibliotheque.entrees).toBe(0);
      expect(r.constats).toHaveLength(1); expect(r.constats[0]).toMatchObject({ gravite: 'info', etat: 'non_verifiable' });
      expect(r.references[0].etat).toBe('non_verifiable');
    } finally {
      for (const e of sauve) await env.db.run('INSERT INTO visa_library (organisme_id, cle, type, code, article, intitule, statut, date_debut, date_fin, verifie_le, verifie_par, source, note, matieres, types_acte, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        [e.organisme_id, e.cle, e.type, e.code, e.article, e.intitule, e.statut, e.date_debut, e.date_fin, e.verifie_le, e.verifie_par, e.source, e.note, e.matieres, e.types_acte, e.created_by]);
    }
  });
});

describe('listes de contrôle (IA-32)', () => {
  it('visa attendu absent et mention attendue absente, selon le type d\'acte, la matière et le seuil de montant', async () => {
    expect((await as(dupont).post(V('/controles'), { nom: 'x', regle: 'visa', cle: 'ccp' })).status).toBe(403);
    expect((await as(admin).post(V('/controles'), { nom: 'Sans clé', regle: 'visa' })).status).toBe(400);
    const c1 = (await as(admin).post(V('/controles'), { nom: 'Subventions : visa du CGCT L1611-4', regle: 'visa', cle: 'cgct:L1611-4', matiereId: matiere.id, gravite: 'bloquant', message: 'Une subvention doit viser l\'article L. 1611-4 du CGCT.' })).body;
    const c2 = (await as(admin).post(V('/controles'), { nom: 'Convention au-delà du seuil', regle: 'mention', motif: 'convention', montantMin: 23000, gravite: 'a_revoir' })).body;
    const c3 = (await as(admin).post(V('/controles'), { nom: 'Signature', regle: 'mention', motif: 'autorisation de signer|autorise le maire', estRegex: true, typeActeId: typeDelib.id })).body;
    const autreType = (await as(admin).post(V('/controles'), { nom: 'Hors sujet', regle: 'mention', motif: 'zzz', typeActeId: typeDelib.id + 9999 })).body;
    expect((await as(admin).post(V('/controles'), { nom: 'Mauvaise regex', regle: 'mention', motif: '(', estRegex: true })).status).toBe(400);
    let r = await rapport(acte.id);
    expect(constat(r, 'cgct:L1611-4')).toMatchObject({ gravite: 'bloquant', etat: 'manquant' }); expect(constat(r, 'cgct:L1611-4').message).toMatch(/L\. 1611-4/);
    expect(r.constats.some((c) => c.etat === 'mention_absente' && /convention/.test(c.message))).toBe(false); // montant 0 / sous le seuil : la règle ne s'applique pas
    expect(r.constats.filter((c) => c.etat === 'mention_absente').map((c) => c.message).join('|')).toMatch(/autorisation de signer\|autorise le maire/);
    expect(r.constats.some((c) => /zzz/.test(c.message))).toBe(false); // autre type d'acte

    await as(dupont).put(A(acte.id), { incidenceFinanciere: true, montant: 30000 });
    r = await rapport(acte.id);
    expect(r.constats.some((c) => c.etat === 'mention_absente' && /« convention »/.test(c.message))).toBe(true); // seuil atteint

    // la règle est satisfaite dès que le visa est présent et que la mention figure
    const t = (await as(dupont).get(A(acte.id, '/textes'))).body.items;
    const visas = t.find((x) => x.kind === 'visas'); const disp = t.find((x) => x.kind === 'dispositif');
    const vv = (await as(dupont).get(A(acte.id, `/textes/${visas.id}?mode=propre`))).body;
    await as(dupont).put(A(acte.id, `/textes/${visas.id}`), { markdown: `${vv.markdown}\nVu l'article L. 1611-4 du code général des collectivités territoriales ;`, baseVersion: vv.version });
    const dd = (await as(dupont).get(A(acte.id, `/textes/${disp.id}?mode=propre`))).body;
    await as(dupont).put(A(acte.id, `/textes/${disp.id}`), { markdown: `${dd.markdown}\nArticle 2 : Le Maire est autorisé à signer la convention.`, baseVersion: dd.version });
    await as(dupont).put(A(acte.id, `/textes/${disp.id}`), { markdown: `${(await as(dupont).get(A(acte.id, `/textes/${disp.id}?mode=propre`))).body.markdown}\nLe Conseil autorise le Maire à signer.`, baseVersion: (await as(dupont).get(A(acte.id, `/textes/${disp.id}?mode=propre`))).body.version });
    r = await rapport(acte.id);
    expect(constat(r, 'cgct:L1611-4')?.etat).not.toBe('manquant');
    expect(r.constats.some((c) => c.etat === 'mention_absente')).toBe(false);

    // désactivation et suppression
    expect((await as(admin).put(V(`/controles/${c1.id}`), { actif: false })).body.actif).toBe(false);
    expect((await as(dupont).get(V('/controles'))).body.items.map((x) => x.id)).toEqual(expect.arrayContaining([c1.id, c2.id, c3.id, autreType.id]));
    for (const c of [c1, c2, c3, autreType]) expect((await as(admin).del(V(`/controles/${c.id}`))).status).toBe(200);
  });

  it('le seuil ne s\'applique pas quand le montant de la fiche est inconnu', async () => {
    const sans = await nouvelActe('Sans montant', { visas: 'Vu le code de la commande publique ;', dispositif: 'Article 1 : ok.' });
    await as(admin).post(V('/controles'), { nom: 'Seuil', regle: 'mention', motif: 'introuvable-expr', montantMin: 1000 });
    expect((await rapport(sans.id)).constats.some((c) => c.etat === 'mention_absente')).toBe(false);
  });
});

describe('dépôt dans les propositions et contrôle complet (IA-36)', () => {
  it('POST /ia/references dépose les constats en alertes (sans IA), remplacées à chaque vérification, jamais appliquées', async () => {
    env.ai.state.handler = () => { throw new Error('le modèle ne doit pas être appelé'); };
    const r1 = await as(dupont).post(A(acte.id, '/ia/references'), {});
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.items.length).toBeGreaterThan(0);
    expect(r1.body.items.every((i) => i.kind === 'alerte' && i.categorie === 'visa' && i.analyse === 'references')).toBe(true);
    const bloquant = r1.body.items.find((i) => i.gravite === 'bloquant');
    expect(bloquant.find).toMatch(/2016-360/); expect(bloquant.reason).toMatch(/abrogé/);
    // une nouvelle vérification remplace les alertes en attente
    await as(dupont).post(A(acte.id, '/ia/references'), {});
    const enAttente = (await as(dupont).get(A(acte.id, '/ia/propositions'))).body.items.filter((i) => i.analyse === 'references' && i.status === 'pending');
    expect(enAttente).toHaveLength(r1.body.items.length);
    // une alerte s'écarte, elle ne modifie pas le texte
    const courante = enAttente.find((i) => i.gravite === 'bloquant');
    expect((await as(dupont).post(A(acte.id, `/ia/propositions/${courante.id}/decision`), { decision: 'accept' })).body.status).toBe('rejected');
    // qui ne peut pas modifier le dossier ne peut pas déposer
    expect((await as(durand).post(A(acte.id, '/ia/references'), {})).status).toBeGreaterThanOrEqual(403);
  });

  it('le contrôle complet inclut les références, même quand l\'IA ne répond rien', async () => {
    env.ai.state.handler = () => '{"propositions":[],"alertes":[]}';
    const j = (await as(dupont).post(A(acte.id, '/ia/analyse'), { type: 'complet' })).body;
    await env.c.aiQueue.drain();
    const items = (await as(dupont).get(A(acte.id, '/ia/propositions'))).body.items.filter((i) => i.analyse === 'complet');
    expect(items.some((i) => i.categorie === 'visa' && /abrogé/.test(i.reason))).toBe(true);
    expect(j.id ?? true).toBeTruthy();
  });
});

describe('veille (IA-38) : un texte abrogé ou modifié prévient les rédacteurs concernés', () => {
  it('notifie le rédacteur des actes en cours qui citent le texte ; liste les actes concernés', async () => {
    const e = (await as(admin).get(V('?q=L2121-29'))).body.items[0];
    const avant = (await as(dupont).get(`${base()}/notifications`)).body.items.filter((n) => n.title.startsWith('Texte abrogé')).length;
    const maj = (await as(admin).put(V(`/${e.id}`), { statut: 'abroge' })).body;
    expect(maj.veille.actesConcernes).toBeGreaterThanOrEqual(1);
    const notifs = (await as(dupont).get(`${base()}/notifications`)).body.items.filter((n) => n.title.startsWith('Texte abrogé'));
    expect(notifs.length).toBeGreaterThan(avant);
    expect(notifs[0].body).toMatch(/Vérifier les références/);
    const c = (await as(admin).get(V(`/${e.id}/actes-concernes`))).body.items;
    expect(c.map((x) => x.acteId)).toContain(acte.id);
    expect((await as(dupont).get(V(`/${e.id}/actes-concernes`))).status).toBe(403);
    // un acte terminé n'est plus concerné
    await env.db.run("UPDATE actes SET statut = 'executoire' WHERE id = $1", [acte.id]);
    expect((await as(admin).get(V(`/${e.id}/actes-concernes`))).body.items.map((x) => x.acteId)).not.toContain(acte.id);
    await env.db.run("UPDATE actes SET statut = 'brouillon' WHERE id = $1", [acte.id]);
    // le même statut à nouveau ne prévient personne
    expect((await as(admin).put(V(`/${e.id}`), { intitule: 'Article L. 2121-29 du CGCT' })).body.veille).toBeNull();
  });

  it('suppression d\'une entrée', async () => {
    const e = (await as(admin).get(V('?q=ccp'))).body.items[0];
    expect((await as(dupont).del(V(`/${e.id}`))).status).toBe(403);
    expect((await as(admin).del(V(`/${e.id}`))).status).toBe(200);
    expect((await as(admin).del(V(`/${e.id}`))).status).toBe(404);
  });
});
