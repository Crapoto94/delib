const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let A1; let items;
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
const parcours = async () => { const r = await as(t.martin).get(S('/parcours')); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body; };
const etat = (p, cle) => p.etapes.find((e) => e.cle === cle);

async function creerDossier(titre, { valider = true } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  if (!valider) return a.id;
  await as(t.dupont).post(`${A(a.id)}/envoi`);
  for (let i = 0; i < 10; i++) { const v = (await as(t.dupont).get(`${A(a.id)}/circuit`)).body; if (!v.currentStepKey) break; await as(t[WHO[v.currentStepKey]]).post(`${A(a.id)}/validation`, {}); }
  return a.id;
}

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
  for (const [nom, prenom] of [['Durif', 'Paul'], ['Lambert', 'Jeanne']]) await as(admin).post(`${base()}/elus`, { nom, prenom, role: 'Conseiller municipal' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(120) })).body;
});
afterAll(async () => { await env.close(); });

describe('workflow de la séance (SEA-13) : étapes déduites des faits', () => {
  it('droits et forme : six étapes dans l’ordre, réservé à l’administration et au SCC', async () => {
    expect((await as(t.dupont).get(S('/parcours'))).status).toBe(403);
    const p = await parcours();
    expect(p.etapes.map((e) => e.label)).toEqual(['Rédaction', 'Préparation', 'Convocation', 'Séance', 'Après la séance', 'Clôture']);
    expect(p.courante).toBe('redaction'); expect(etat(p, 'redaction').retient[0]).toMatch(/aucun dossier/);
    expect(p.etapes.slice(1).every((e) => e.etat === 'a_venir')).toBe(true);
    expect((await as(t.martin).get(`${base()}/seances/999999/parcours`)).status).toBe(404);
  });

  it('Rédaction : retenue tant que des dossiers ne sont pas validés ; puis Préparation attend l’ordre du jour', async () => {
    A1 = await creerDossier('Subvention Ivry Sport');
    const brouillon = await creerDossier('Convention en rédaction', { valider: false });
    let p = await parcours();
    expect(p.courante).toBe('redaction'); expect(etat(p, 'redaction').retient.join(' ')).toMatch(/1 dossier pas encore validé/);
    await env.db.run("UPDATE actes SET statut = 'abandonne' WHERE id = $1", [brouillon]);
    await as(t.martin).post(S('/odj/affectations'), { acteIds: [A1], motif: 'Ajout à l’ordre du jour' });
    p = await parcours();
    expect(etat(p, 'redaction').etat).toBe('fait');
    expect(p.courante).toBe('preparation'); expect(etat(p, 'preparation').retient).toEqual(["l'ordre du jour n'est pas arrêté"]);
  });

  it('Préparation → Convocation → Séance : la tenue rend fait ce qui la précède', async () => {
    await as(t.martin).post(S('/odj/arret'), { forcer: true });
    let p = await parcours();
    expect(p.courante).toBe('preparation'); expect(etat(p, 'preparation').retient).toEqual(["le cahier de séance n'est pas construit"]);
    await as(t.martin).post(S('/tenue/ouverture'));
    p = await parcours();
    expect(p.courante).toBe('seance'); expect(etat(p, 'seance').retient[0]).toMatch(/en cours/);
    expect(etat(p, 'preparation').etat).toBe('fait'); expect(etat(p, 'convocation').etat).toBe('fait');
  });

  it('Après la séance : délibérations à préparer, à envoyer, sans AR ; puis Clôture', async () => {
    const st = (await as(t.martin).get(S('/tenue'))).body;
    await as(t.martin).put(S('/tenue/presences'), { eluIds: st.groupes.flatMap((g) => g.elus).map((e) => e.id), etat: 'en_salle' });
    items = {}; for (const pt of st.points.filter((x) => x.kind === 'deliberation')) items[pt.acte.id] = pt.id;
    await as(t.martin).put(S('/tenue/courant'), { itemId: items[A1] });
    const votes = (await as(t.martin).get(S('/tenue'))).body.groupes.flatMap((g) => g.elus).map((e) => ({ eluId: e.id, choix: 'pour' }));
    await as(t.martin).put(S(`/tenue/points/${items[A1]}/votes`), { votes });
    const cl = await as(t.martin).post(S(`/tenue/points/${items[A1]}/cloture`), { issue: 'vote' }); expect(cl.status, JSON.stringify(cl.body)).toBe(200);
    await as(t.martin).post(S('/tenue/cloture'));
    let p = await parcours();
    expect(etat(p, 'seance').etat).toBe('fait'); expect(p.courante).toBe('post');
    expect(etat(p, 'post').retient[0]).toMatch(/1 délibération à préparer/);
    const prep = (await as(t.martin).post(TL(`/seances/${seance.id}/preparation`), { itemIds: [items[A1]] })).body;
    p = await parcours(); expect(etat(p, 'post').retient[0]).toMatch(/1 transmission préparée à envoyer/);
    await as(t.martin).post(TL(`/transactions/${prep.crees[0].id}/envoi`)); await as(t.martin).post(TL(`/transactions/${prep.crees[0].id}/confirmation`));
    p = await parcours(); expect(etat(p, 'post').retient[0]).toMatch(/sans accusé de réception/);
    await as(t.martin).post(TL('/simulation/avancer'), { pas: 10 });
    p = await parcours();
    expect(etat(p, 'post').etat).toBe('fait'); expect(etat(p, 'cloture').etat).toBe('fait');
    expect(p.terminee).toBe(true); expect(p.courante).toBeNull();
  });

  it('une séance annulée n’a pas de parcours', async () => {
    const autre = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(20) })).body;
    await env.db.run("UPDATE seances SET statut = 'annulee' WHERE id = $1", [autre.id]);
    const p = (await as(t.martin).get(`${base()}/seances/${autre.id}/parcours`)).body;
    expect(p.annulee).toBe(true); expect(p.etapes.every((e) => e.etat === 'a_venir')).toBe(true);
  });
});

const bin = (tok, u) => env.http().get(u).set(bearer(tok)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });

describe('bibliothèque des actes de la collectivité (REC-30) : consulter sans droit sur le dossier', () => {
  it('tout agent recherche et consulte une délibération adoptée, séance close : texte, exposé, annexes publiables', async () => {
    const r = await as(t.leroy).get(`${base()}/bibliotheque?q=${encodeURIComponent('Subvention')}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items.map((i) => i.acteId)).toContain(A1);
    expect(r.body.items.find((i) => i.acteId === A1)).toMatchObject({ resultat: 'adopte_unanimite', titre: 'Subvention Ivry Sport' });
    expect((await as(t.leroy).get(`${base()}/bibliotheque?q=zzzintrouvable`)).body.total).toBe(0);
    expect((await as(t.leroy).get(`${base()}/bibliotheque?annee=1999`)).body.total).toBe(0);
    const f = (await as(t.leroy).get(`${base()}/bibliotheque/actes/${A1}`)).body;
    expect(f).toMatchObject({ acteId: A1, resultatLabel: 'Adoptée à l’unanimité' }); expect(f.expose).toMatch(/Texte expose/); expect(f.dispositif).toMatch(/Texte dispositif/);
    expect(f.documents.map((d) => d.cible)).toEqual(['expose', 'deliberation', 'extrait']);
  });

  it('recherche avancée : rapporteur, direction, thématique et période', async () => {
    const ids = async (q) => (await as(t.leroy).get(`${base()}/bibliotheque?${q}`)).body;
    expect((await ids('rapporteurId=1')).items.map((i) => i.acteId)).toContain(A1);
    expect((await ids('rapporteurId=999999')).total).toBe(0);
    expect((await ids(`matiereId=${matiere.id}`)).items.map((i) => i.acteId)).toContain(A1);
    const dir = (await env.db.get('SELECT direction_code FROM actes WHERE id = $1', [A1])).direction_code;
    expect((await ids(`directionCode=${dir}`)).items.map((i) => i.acteId)).toContain(A1);
    const jour = inDays(120).slice(0, 10);
    expect((await ids(`du=${jour}&au=${jour}`)).items.map((i) => i.acteId)).toContain(A1);
    expect((await ids(`du=${inDays(200).slice(0, 10)}`)).total).toBe(0);
  });

  it('exposé des motifs, délibération et extrait du registre s’affichent en PDF', async () => {
    for (const cible of ['expose', 'deliberation', 'extrait']) {
      const r = await bin(t.leroy, `${base()}/bibliotheque/actes/${A1}/pdf?cible=${cible}`);
      expect(r.status, cible).toBe(200); expect(r.headers['content-type']).toMatch(/pdf/); expect(r.body.slice(0, 4).toString()).toBe('%PDF');
    }
    expect((await as(t.leroy).get(`${base()}/bibliotheque/actes/${A1}/pdf?cible=nimporte`)).status).toBe(400);
  });

  it('jamais un acte non adopté, confidentiel ou à huis clos', async () => {
    const brouillon = await creerDossier('Projet non adopté', { valider: false });
    expect((await as(t.leroy).get(`${base()}/bibliotheque/actes/${brouillon}`)).status).toBe(404);
    expect((await as(t.leroy).get(`${base()}/bibliotheque?q=${encodeURIComponent('Projet non adopté')}`)).body.total).toBe(0);
    await env.db.run("UPDATE actes SET confidentialite = 'huis_clos' WHERE id = $1", [A1]);
    expect((await as(t.leroy).get(`${base()}/bibliotheque/actes/${A1}`)).status).toBe(404);
    expect((await as(t.leroy).get(`${base()}/bibliotheque?q=Subvention`)).body.items.map((i) => i.acteId)).not.toContain(A1);
    await env.db.run("UPDATE actes SET confidentialite = 'normale' WHERE id = $1", [A1]);
  });
});

describe('le trajet de mes actes (REC-31) : les dossiers où j’ai eu un rôle, avec leur circuit', () => {
  it('liste mes actes avec mes rôles, tous statuts, filtrable', async () => {
    const r = (await as(t.dupont).get(`${base()}/mes-actes`)).body;
    const a = r.items.find((i) => i.acteId === A1);
    expect(a).toMatchObject({ statut: expect.any(String), resultat: 'adopte_unanimite' }); expect(a.roles.map((x) => x.code)).toContain('redacteur');
    expect(r.items.some((i) => i.statut === 'abandonne')).toBe(true); // les dossiers non aboutis y figurent aussi
    expect((await as(t.dupont).get(`${base()}/mes-actes?role=commentateur`)).body.items.some((i) => i.acteId === A1)).toBe(false);
    expect((await as(t.durand).get(`${base()}/mes-actes?role=valideur`)).body.items.some((i) => i.acteId === A1)).toBe(true);
    expect((await as(t.dupont).get(`${base()}/mes-actes?q=Subvention`)).body.total).toBe(1);
  });

  it('fiche de trajet : circuit complet, vote, transmission et AR, chronologie', async () => {
    const tj = (await as(t.dupont).get(`${base()}/mes-actes/${A1}`)).body;
    expect(tj.acte.id).toBe(A1);
    expect(tj.circuit.length).toBeGreaterThanOrEqual(3); expect(tj.circuit.every((c) => c.label)).toBe(true);
    expect(tj.vote[0]).toMatchObject({ resultat: 'adopte_unanimite' }); expect(tj.transmissions[0].arId).toBeTruthy();
    expect(tj.modifications.versions).toBeGreaterThan(0); expect(tj.modifications.auteurs).toContain('dupont');
    const types = tj.chronologie.map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining(['creation', 'etape', 'validation', 'vote', 'transmission', 'ar']));
    expect(tj.chronologie.map((c) => new Date(c.le).getTime())).toEqual([...tj.chronologie.map((c) => new Date(c.le).getTime())].sort((x, y) => x - y));
  });

  it('les deux dispositifs sont indépendants : pas de rôle, pas de trajet ; la bibliothèque n’ouvre pas les trajets', async () => {
    const autre = await creerDossier('Dossier de Petit', { valider: false }); // créé par dupont : « petit » n’y a aucun rôle
    expect((await as(t.petit).get(`${base()}/mes-actes/${autre}`)).status).toBe(404);
    expect((await as(t.petit).get(`${base()}/mes-actes`)).body.items.some((i) => i.acteId === autre)).toBe(false);
  });
});

describe('AR de la préfecture : tampon, ARActe XML, extrait du registre conforme, GED (TLT-34 à 36)', () => {
  const { PDFDocument } = require('pdf-lib');
  const { apposerTampon } = require('../../src/shared/pdfstamp');
  let tx;
  it('le tampon est posé sur chaque page', async () => {
    const d = await PDFDocument.create(); d.addPage([595, 842]); d.addPage([595, 842]);
    const src = Buffer.from(await d.save());
    const out = await apposerTampon(src, { arId: '094-219400413-20260702-DEL20260702_17E-DE', dateTransmission: '2026-07-10T10:00:00Z', dateReception: '2026-07-10T11:00:00Z' });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2); expect(out.length).toBeGreaterThan(src.length);
  });

  it('l’ARActe XML est conservé dès l’AR, consultable (champs lus) et téléchargeable', async () => {
    tx = (await as(t.martin).get(TL('/transactions'))).body.items.find((x) => x.acteId === A1);
    expect(tx.arId).toBeTruthy();
    const ar = (await as(t.martin).get(TL(`/transactions/${tx.id}/ar`))).body;
    expect(ar).toMatchObject({ idActe: tx.arId, simulation: true }); expect(ar.dateReception).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(ar.numero).toBeTruthy();
    const xml = await env.http().get(TL(`/transactions/${tx.id}/ar.xml`)).set(bearer(t.martin));
    expect(xml.status).toBe(200); expect(xml.headers['content-type']).toMatch(/xml/); expect(xml.text).toMatch(/<actes:ARActe[^>]+IDActe=/);
    expect((await as(t.dupont).get(TL(`/transactions/${tx.id}/ar`))).status).toBe(403);
    const detail = (await as(t.martin).get(TL(`/transactions/${tx.id}`))).body;
    expect(detail.journal.map((j) => j.type)).toContain('ar_xml');
  });

  it('l’extrait du registre est en trois parties (garde, présence, délibération), tamponné une fois l’AR reçu', async () => {
    const r = await bin(t.martin, TL(`/transactions/${tx.id}/extrait`));
    expect(r.status).toBe(200); expect(r.body.slice(0, 4).toString()).toBe('%PDF');
    const pages = (await PDFDocument.load(r.body)).getPageCount(); expect(pages).toBeGreaterThanOrEqual(3);
    const sys = { username: 'martin', isPlatformAdmin: true, kind: 'system', organismes: [], roles: [] };
    const ex = await env.c.pv.extrait(sys, ville.id, seance.id, items[A1]);
    expect(ex).toMatchObject({ tamponne: true }); expect(ex.pages).toBe(pages);
    expect((await env.c.pv.extrait(sys, ville.id, seance.id, items[A1], { tampon: false })).tamponne).toBe(false);
  });

  it('l’ARActe et l’extrait tamponné rejoignent les documents à archiver en GED', async () => {
    const sys = { username: 'ged-auto', isPlatformAdmin: true, kind: 'system', organismes: [], roles: [] };
    const { docs } = await env.c.ged.documentsSeance(sys, ville.id, seance.id);
    const cles = docs.map((x) => x.key);
    expect(cles).toEqual(expect.arrayContaining([`t${tx.id}:ar-xml`, `t${tx.id}:extrait-ar`, `t${tx.id}:bordereau`, `t${tx.id}:acte`]));
    const xmlDoc = docs.find((x) => x.key === `t${tx.id}:ar-xml`);
    expect(xmlDoc.mime).toBe('application/xml'); expect((await xmlDoc.produire()).toString('utf8')).toMatch(/ARActe/);
  });
});

describe('date d’affichage saisie par le SCC (TLT-34)', () => {
  const texte = async (buf) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0, isEvalSupported: false }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) out += `${(await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ')} `;
    return out.replace(/\s+/g, ' ');
  };
  it('renseigne « publié par voie d’affichage le … » de l’extrait ; par défaut la date de l’AR', async () => {
    const tx = (await as(t.martin).get(TL('/transactions'))).body.items.find((x) => x.acteId === A1);
    const fr = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });
    let pdf = (await bin(t.martin, TL(`/transactions/${tx.id}/extrait`))).body;
    expect(await texte(pdf)).toMatch(new RegExp(`PUBLIÉ PAR VOIE D'AFFICHAGE LE ${fr(tx.arLe)}`));

    expect((await as(t.dupont).put(TL(`/transactions/${tx.id}/affichage`), { date: '2030-01-15' })).status).toBe(403);
    expect((await as(t.martin).put(TL(`/transactions/${tx.id}/affichage`), { date: '2000-01-01' })).status).toBe(400); // avant l’AR
    const ok = await as(t.martin).put(TL(`/transactions/${tx.id}/affichage`), { date: '2030-01-15' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200); expect(String(ok.body.dateAffichage).slice(0, 10)).toBe('2030-01-15');
    pdf = (await bin(t.martin, TL(`/transactions/${tx.id}/extrait`))).body;
    expect(await texte(pdf)).toMatch(/PUBLIÉ PAR VOIE D'AFFICHAGE LE 15\/01\/2030/);

    // l’extrait déposé en GED change d’empreinte : il sera mis à jour
    const sys = { username: 'ged-auto', isPlatformAdmin: true, kind: 'system', organismes: [], roles: [] };
    const { docs } = await env.c.ged.documentsSeance(sys, ville.id, seance.id);
    expect(docs.find((d) => d.key === `t${tx.id}:extrait-ar`)).toBeTruthy();
    // effacer la date reprend celle de l’AR
    expect((await as(t.martin).put(TL(`/transactions/${tx.id}/affichage`), { date: null })).status).toBe(200);
    expect(await texte((await bin(t.martin, TL(`/transactions/${tx.id}/extrait`))).body)).toMatch(new RegExp(`PUBLIÉ PAR VOIE D'AFFICHAGE LE ${fr(tx.arLe)}`));
  });
});
