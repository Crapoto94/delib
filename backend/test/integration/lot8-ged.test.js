const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { sur } = require('../../src/modules/ged/ged.service');
const { createAlfresco, API } = require('../../src/adapters/alfresco');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let acteIds; let items;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
});
const bin = (tok, u) => env.http().get(u).set(bearer(tok)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (p = '') => `${base()}/seances/${seance.id}${p}`;
const G = (p = '') => `${base()}/ged${p}`;
const WHO = { chef_service: 'durand', directeur: 'leroy', juridique: 'nouveau', dga: 'petit', dgs: 'boot', scc: 'martin' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function delib(titre) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  await as(t.martin).post(S('/odj/affectations'), { acteIds: [a.id], motif: 'Ajout à l’ordre du jour' });
  return a.id;
}
async function voter(itemId, choix) {
  await as(t.martin).put(S('/tenue/courant'), { itemId });
  const st = (await as(t.martin).get(S('/tenue'))).body;
  await as(t.martin).put(S(`/tenue/points/${itemId}/votes`), { votes: st.groupes.flatMap((g) => g.elus).map((e) => ({ eluId: e.id, choix })) });
  expect((await as(t.martin).post(S(`/tenue/points/${itemId}/cloture`), { issue: 'vote' })).status).toBe(200);
}
/** Erratum sur un texte d'un acte déjà adopté (l'API n'édite plus un acte adopté) : version du texte et date de l'acte avancent. */
async function corriger(acteId, kind, markdown) {
  await env.db.run('UPDATE tracked_texts SET markdown = $3, version_no = version_no + 1 WHERE acte_id = $1 AND kind = $2', [acteId, kind, markdown]);
  await env.db.run('UPDATE actes SET updated_at = now() WHERE id = $1', [acteId]);
}
const explorer = async (nodeId) => (await as(admin).get(G(`/explorateur${nodeId ? `?nodeId=${nodeId}` : ''}`))).body.items;
async function descendre(chemin) { let cur = null; for (const nom of chemin) { const e = (await explorer(cur)).find((x) => x.nom === nom); if (!e) return null; cur = e.id; } return cur; }

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
  acteIds = [await delib('Subvention à l’association Ivry Sport'), await delib('Convention : théâtre / saison 2027')];
  const ctx = await env.c.access.loadContext('dupont'); const d = await PDFDocument.create(); d.addPage([595, 842]).drawText('Annexe', { x: 50, y: 700, size: 14 }); const buf = Buffer.from(await d.save());
  await env.c.annexes.add(ctx, ville.id, acteIds[0], { titre: 'Plan de financement', communicable: true }, { buffer: buf, originalname: 'plan.pdf', size: buf.length, mimetype: 'application/pdf' });
  await as(t.martin).post(S('/odj/arret'), { forcer: true });
  await as(t.martin).post(S('/tenue/ouverture'));
  const st = (await as(t.martin).get(S('/tenue'))).body;
  await as(t.martin).put(S('/tenue/presences'), { eluIds: st.groupes.flatMap((g) => g.elus).map((e) => e.id), etat: 'en_salle' });
  items = {}; for (const p of st.points.filter((x) => x.kind === 'deliberation')) items[p.acte.id] = p.id;
  await voter(items[acteIds[0]], 'pour'); await voter(items[acteIds[1]], 'contre');
  await as(t.martin).post(S('/tenue/cloture'));
});
afterAll(async () => { await env.close(); });

describe('paramétrage et test de connexion', () => {
  it('le mot de passe est chiffré au repos et jamais renvoyé ; réservé à l’administrateur', async () => {
    expect((await as(admin).get(G('/config'))).body).toMatchObject({ actif: false, mode: 'simulation', motDePasseDefini: false });
    const r = await as(admin).put(G('/config'), { mode: 'simulation', url: 'https://alfresco.ivry.local', utilisateur: 'svc-vibedelib', motDePasse: 'Secret-tres-long-2026', racine: '/Sites/archives/documentLibrary', actif: true, autoArchivage: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ actif: true, utilisateur: 'svc-vibedelib', motDePasseDefini: true });
    expect(JSON.stringify(r.body)).not.toMatch(/Secret-tres-long/);
    const raw = await env.db.get('SELECT mot_de_passe_chiffre FROM ged_config WHERE organisme_id = $1', [ville.id]);
    expect(raw.mot_de_passe_chiffre).not.toContain('Secret-tres-long');
    expect(JSON.stringify(await env.db.all("SELECT after FROM audit_log WHERE action = 'ged.config'"))).not.toMatch(/Secret-tres-long/);
    // mot de passe vide : l’ancien est conservé
    expect((await as(admin).put(G('/config'), { motDePasse: '' })).body.motDePasseDefini).toBe(true);
    expect((await as(t.dupont).get(G('/config'))).status).toBe(403);
    expect((await as(t.martin).put(G('/config'), { actif: false })).status).toBe(403);
    expect((await as(admin).put(G('/config'), { mode: 'alfresco', url: '', actif: true })).status).toBe(400); // Alfresco actif sans URL
  });

  it('le bouton de test répond sans erreur : simulateur joignable, Alfresco injoignable expliqué', async () => {
    const ok = (await as(admin).post(G('/test'), {})).body;
    expect(ok).toMatchObject({ ok: true, mode: 'simulation' }); expect(ok.details.racine.nom).toBe('Company Home');
    const ko = await as(admin).post(G('/test'), { mode: 'alfresco', url: 'http://127.0.0.1:9', utilisateur: 'x', motDePasse: 'y' });
    expect(ko.status).toBe(200); expect(ko.body).toMatchObject({ ok: false, mode: 'alfresco' }); expect(ko.body.message).toMatch(/injoignable/i);
    const incomplet = (await as(admin).post(G('/test'), { mode: 'alfresco', url: 'http://127.0.0.1:9' })).body;
    expect(incomplet.ok).toBe(false); expect(incomplet.message).toMatch(/injoignable|Renseignez/); // les identifiants enregistrés complètent l’essai
  });
});

describe('plan de classement', () => {
  it('crée le plan numéroté (séances par année, registre), avec finalité et conservation, et ne recrée jamais l’existant', async () => {
    const r = await as(admin).post(G('/plan'));
    expect(r.status).toBe(201);
    expect(r.body.nouveaux).toBeGreaterThan(8);
    expect(r.body.dossiers).toEqual(expect.arrayContaining([expect.stringContaining('01 Séances'), expect.stringContaining('02 Registre des délibérations')]));
    expect(r.body.dossiers.some((d) => /05 Contrôle de légalité/.test(d))).toBe(true);
    expect((await as(admin).post(G('/plan'))).body.nouveaux).toBe(0); // idempotent
    const racine = (await explorer())[0];
    expect(racine.nom).toMatch(/^VibeDélib — /);
    const enfants = await explorer(racine.id);
    expect(enfants.map((e) => e.nom)).toEqual(['01 Séances', '02 Registre des délibérations']);
    expect(enfants[1].description).toMatch(/DÉFINITIVE/); // conservation portée par le dossier
    expect((await as(t.dupont).post(G('/plan'))).status).toBe(403);
  });

  it('les noms sont sûrs pour Alfresco : caractères interdits remplacés, longueur bornée', () => {
    expect(sur('Convention : théâtre / saison 2027 ?')).toBe('Convention - théâtre - saison 2027 -');
    expect(sur('  ...  ')).toBe('sans nom');
    expect(sur('x'.repeat(300)).length).toBeLessThanOrEqual(110);
  });
});

describe('archivage d’une séance', () => {
  let premier;
  it('dépose tous les documents dans le plan : exposé, projet, annexe, procès-verbal, liste, extrait du registre', async () => {
    const r = await as(t.martin).post(G(`/seances/${seance.id}/archivage`));
    expect(r.status).toBe(200);
    premier = r.body;
    expect(premier).toMatchObject({ erreurs: 0, nouvellesVersions: 0 }); expect(premier.deposes).toBe(8); // 2 exposés, 2 projets, 1 annexe, procès-verbal, liste, 1 extrait (la rejetée n’en a pas)
    const noms = premier.documents.map((d) => d.nom).join('|');
    for (const attendu of ['expose-des-motifs', 'projet-de-deliberation', 'annexe', 'proces-verbal', 'liste-des-deliberations', 'extrait-du-registre']) expect(noms).toContain(attendu);
    for (const d of premier.documents) expect(d.nom).not.toMatch(/[:*?"<>|]/);
    // un seul extrait : la délibération rejetée n’a pas d’extrait, mais son dossier est archivé
    expect(premier.documents.filter((d) => /extrait-du-registre/.test(d.nom)).length).toBe(1);
    expect(premier.documents.filter((d) => /projet-de-deliberation/.test(d.nom)).length).toBe(2);
  });

  it('les documents sont bien classés dans l’arborescence et lisibles depuis l’explorateur', async () => {
    const an = String(new Date(Date.now() + 3 * 86400000).getFullYear());
    const racine = (await explorer())[0].nom;
    const dossierSeance = (await explorer(await descendre([racine, '01 Séances', an]))).find((x) => /Conseil municipal/.test(x.nom));
    expect(dossierSeance).toBeTruthy();
    const dossiers = await descendre([racine, '01 Séances', an, dossierSeance.nom, '02 Dossiers des délibérations']);
    const points = await explorer(dossiers);
    expect(points.length).toBe(2);
    const fichiers = await explorer(points.find((p) => /Subvention/.test(p.nom)).id);
    expect(fichiers.map((f) => f.nom).join('|')).toMatch(/expose-des-motifs.*projet-de-deliberation.*annexe|annexe.*expose/s);
    const pdf = await bin(admin, G(`/noeuds/${fichiers[0].id}/contenu`));
    expect(pdf.status).toBe(200); expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
    const reg = await explorer(await descendre([racine, '02 Registre des délibérations', an]));
    expect(reg.length).toBe(1); expect(reg[0].nom).toMatch(/extrait-du-registre/);
    const liste = (await as(t.martin).get(G(`/documents?seanceId=${seance.id}`))).body.items;
    expect(liste.length).toBe(premier.deposes); expect(liste.every((d) => d.statut === 'ok' && d.version === '1.0')).toBe(true);
  });

  it('idempotent : un document inchangé n’est pas redéposé ; un document modifié devient une nouvelle version du même nœud', async () => {
    const r2 = (await as(t.martin).post(G(`/seances/${seance.id}/archivage`))).body;
    expect(r2).toMatchObject({ deposes: 0, nouvellesVersions: 0, erreurs: 0 }); expect(r2.inchanges).toBe(premier.deposes);
    await corriger(acteIds[0], 'dispositif', 'Article 1 : texte corrigé (erratum).');
    const r3 = (await as(t.martin).post(G(`/seances/${seance.id}/archivage`))).body;
    expect(r3.nouvellesVersions).toBeGreaterThanOrEqual(1); expect(r3.deposes).toBe(0);
    expect(r3.documents.find((d) => d.etat === 'nouvelle_version').version).toBe('2.0');
    const noeuds = (await as(t.martin).get(G(`/documents?seanceId=${seance.id}`))).body.items;
    expect(new Set(noeuds.map((n) => n.nodeId)).size).toBe(noeuds.length); // aucun doublon : même nœud, version suivante
    expect((await as(t.dupont).post(G(`/seances/${seance.id}/archivage`))).status).toBe(403);
  });

  it('un échec sur un document n’arrête pas les autres et reste rejouable', async () => {
    const orig = env.c.pv.extrait;
    env.c.pv.extrait = async () => { throw new Error('Rendu indisponible (essai)'); };
    await corriger(acteIds[0], 'expose', 'Exposé revu.');
    await env.db.run("UPDATE ged_documents SET sha256 = 'périmé' WHERE doc_key LIKE '%:extrait'");
    const r = (await as(t.martin).post(G(`/seances/${seance.id}/archivage`))).body;
    env.c.pv.extrait = orig;
    expect(r.erreurs).toBe(1); expect(r.documents.find((d) => d.etat === 'erreur').erreur).toMatch(/indisponible/);
    expect(r.nouvellesVersions).toBeGreaterThanOrEqual(1); // les autres documents ont bien été traités
    const rejeu = (await as(t.martin).post(G(`/seances/${seance.id}/archivage`))).body;
    expect(rejeu.erreurs).toBe(0);
  });

  it('archivage automatique à la clôture de la séance (paramètre), sans jamais bloquer la clôture', async () => {
    expect((await as(admin).put(G('/config'), { actif: true, autoArchivage: true })).status).toBe(200);
    expect((await as(admin).post(S('/tenue/deverrouillage'), { motif: 'Correction d’un texte' })).status).toBe(200);
    const a = acteIds[1];
    await corriger(a, 'dispositif', 'Article 1 : autre texte.');
    const avant = (await as(t.martin).get(G(`/documents?seanceId=${seance.id}`))).body.items.find((d) => /projet-de-deliberation/.test(d.nom) && d.acteId === a);
    expect((await as(t.martin).post(S('/tenue/cloture'))).status).toBe(200);
    let apres;
    for (let i = 0; i < 40; i++) { await sleep(150); apres = (await as(t.martin).get(G(`/documents?seanceId=${seance.id}`))).body.items.find((d) => d.id === avant.id); if (apres.version !== avant.version) break; }
    expect(apres.version).not.toBe(avant.version);
  });
});

describe('adaptateur Alfresco (API REST v1)', () => {
  /** Faux serveur Alfresco minimal : vérifie les appels émis (URL, méthode, corps). */
  function fauxAlfresco() {
    const noeuds = new Map([['-root-', { id: 'root-id', name: 'Company Home', isFolder: true }]]); const enfants = new Map(); const appels = []; let n = 0;
    const http = {
      async get(url, { params } = {}) {
        appels.push(['GET', url, params]);
        if (url === '/alfresco/api/discovery') return { status: 200, data: { entry: { repository: { edition: 'Community', version: { display: '23.2.0' } } } } };
        const m = /\/nodes\/([^/]+)$/.exec(url);
        if (m && params?.relativePath) { const c = (enfants.get(m[1] === '-root-' ? 'root-id' : m[1]) || []).find((x) => x.name === params.relativePath); return c ? { status: 200, data: { entry: c } } : { status: 404, data: {} }; }
        if (m) return m[1] === '-root-' || m[1] === 'root-id' ? { status: 200, data: { entry: noeuds.get('-root-') } } : { status: 404, data: {} };
        return { status: 404, data: {} };
      },
      async post(url, body, opts) {
        appels.push(['POST', url, body instanceof FormData ? Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name])) : body, opts?.params]);
        const parent = /\/nodes\/([^/]+)\/children$/.exec(url)[1]; const pid = parent === '-root-' ? 'root-id' : parent; const liste = enfants.get(pid) || []; enfants.set(pid, liste);
        const name = body instanceof FormData ? body.get('name') : body.name;
        if (liste.some((x) => x.name === name)) return { status: 409, data: {} };
        const e = { id: `n${++n}`, name, isFolder: !(body instanceof FormData), properties: { 'cm:versionLabel': '1.0' } }; liste.push(e);
        return { status: 201, data: { entry: e } };
      },
      async put(url, buffer, opts) { appels.push(['PUT', url, opts?.params]); return { status: 200, data: { entry: { properties: { 'cm:versionLabel': '2.0' } } } }; },
    };
    return { http, appels };
  }
  const cfg = { url: 'https://alfresco.test', utilisateur: 'svc', motDePasse: 'pw', racine: '-root-' };

  it('teste l’authentification, crée les dossiers manquants (jamais deux fois), dépose puis versionne un document', async () => {
    const { http, appels } = fauxAlfresco(); const ad = createAlfresco({ http });
    const test = await ad.testConnexion(cfg);
    expect(test).toMatchObject({ ok: true, details: { version: '23.2.0', edition: 'Community' } });
    const p1 = await ad.ensurePath(cfg, [{ nom: '01 Séances', description: 'x' }, { nom: '2026' }]);
    expect(p1.crees).toEqual(['01 Séances', '01 Séances / 2026']);
    expect((await ad.ensurePath(cfg, [{ nom: '01 Séances' }, { nom: '2026' }])).crees).toEqual([]);
    const post = appels.find((a) => a[0] === 'POST' && a[2]?.nodeType === 'cm:folder');
    expect(post[1]).toBe(`${API}/nodes/-root-/children`); expect(post[3]).toMatchObject({ autoRename: false });
    const d1 = await ad.deposer(cfg, p1.id, { nom: 'acte.pdf', buffer: Buffer.from('%PDF-1'), description: 'Acte' });
    expect(d1).toMatchObject({ nouveau: true, nouvelleVersion: false, versionLabel: '1.0' });
    const dep = appels.filter((a) => a[0] === 'POST').at(-1)[2]; expect(dep).toMatchObject({ name: 'acte.pdf', nodeType: 'cm:content', filedata: 'acte.pdf', 'cm:description': 'Acte' });
    const d2 = await ad.deposer(cfg, p1.id, { nom: 'acte.pdf', buffer: Buffer.from('%PDF-2') });
    expect(d2).toMatchObject({ nouveau: false, nouvelleVersion: true, versionLabel: '2.0' });
    expect(appels.some((a) => a[0] === 'PUT' && a[2]?.majorVersion === true)).toBe(true);
  });

  it('un refus d’authentification est expliqué (pas d’exception)', async () => {
    const http = { get: async () => ({ status: 401, data: {} }) };
    const r = await createAlfresco({ http }).testConnexion(cfg);
    expect(r).toMatchObject({ ok: false }); expect(r.message).toMatch(/Identifiants refusés/);
  });
});

describe('synchronisation avec la GED (GED-08)', () => {
  const sync = () => as(admin).get(G('/synchronisation'));
  const ligne = async () => (await sync()).body.seances.find((x) => x.seanceId === seance.id);

  it('état comparé, synchronisation locale → GED idempotente, vérification GED → local et redépôt des manquants', async () => {
    expect((await as(admin).put(G('/config'), { mode: 'simulation', actif: true, autoArchivage: false, racine: '', url: '', utilisateur: '' })).status).toBe(200);
    await env.db.run('DELETE FROM ged_documents WHERE seance_id = $1', [seance.id]);
    const avant = await ligne();
    expect(avant.documents).toBeGreaterThan(0); expect(avant).toMatchObject({ aArchiver: avant.documents, synchronises: 0 });

    const r = await as(admin).post(G('/synchronisation'), { seanceIds: [seance.id] });
    expect(r.status).toBe(200); expect(r.body.erreurs).toBe(0);
    expect(r.body.seances[0]).toMatchObject({ seanceId: seance.id }); expect(r.body.deposes + r.body.nouvellesVersions).toBeGreaterThan(0);
    expect(await ligne()).toMatchObject({ aArchiver: 0, aMettreAJour: 0, enErreur: 0, manquants: 0, synchronises: avant.documents, aFaire: 0 });
    const rejoue = await as(admin).post(G('/synchronisation'), { seanceIds: [seance.id] });
    expect(rejoue.body).toMatchObject({ seances: [], deposes: 0, nouvellesVersions: 0 }); // rien à faire : idempotent

    // vérification : tout est présent, puis un document disparaît de la GED
    const v1 = (await as(admin).post(G('/verification'))).body; expect(v1.manquants).toEqual([]);
    const un = await env.db.get('SELECT id, node_id, nom FROM ged_documents WHERE seance_id = $1 ORDER BY id LIMIT 1', [seance.id]);
    await env.db.run('DELETE FROM ged_sim_nodes WHERE id = $1', [un.node_id]);
    const v2 = (await as(admin).post(G('/verification'))).body;
    expect(v2.manquants.map((m) => m.nom)).toEqual([un.nom]);
    expect((await ligne()).manquants).toBe(1);

    const r3 = await as(admin).post(G('/synchronisation'), {});
    expect(r3.body.erreurs).toBe(0); expect(r3.body.deposes + r3.body.nouvellesVersions).toBe(1); // redéposé depuis VibeDélib
    expect(await ligne()).toMatchObject({ manquants: 0, aFaire: 0 });
  });

  it('un document modifié depuis son dépôt est signalé « à mettre à jour » ; réservé aux archivistes', async () => {
    const d = await env.db.get('SELECT id FROM ged_documents WHERE seance_id = $1 ORDER BY id LIMIT 1', [seance.id]);
    await env.db.run("UPDATE ged_documents SET sha256 = 'ancien' WHERE id = $1", [d.id]);
    expect((await ligne()).aMettreAJour).toBe(1);
    expect((await as(t.dupont).get(G('/synchronisation'))).status).toBe(403);
    expect((await as(t.dupont).post(G('/synchronisation'), {})).status).toBe(403);
    expect((await as(admin).post(G('/synchronisation'), {})).body.nouvellesVersions).toBe(1);
    expect((await ligne()).aFaire).toBe(0);
  });

  it('un cahier de séance terminé part en GED sans attendre la clôture (archivage automatique)', async () => {
    await as(admin).put(G('/config'), { autoArchivage: true });
    await env.db.run('DELETE FROM ged_documents WHERE seance_id = $1', [seance.id]);
    await env.c.bus.emit('cahier.built', { organismeId: ville.id, seanceId: seance.id });
    for (let i = 0; i < 40 && !(await env.db.get('SELECT 1 AS x FROM ged_documents WHERE seance_id = $1', [seance.id])); i++) await sleep(100);
    expect((await ligne()).synchronises).toBeGreaterThan(0);
    await as(admin).put(G('/config'), { autoArchivage: false });
  });
});
