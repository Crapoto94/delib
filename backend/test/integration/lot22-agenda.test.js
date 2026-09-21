const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const ics = require('../../src/shared/ics');

let env; let admin; let ville; let t; let typeDelib; let matiere; let rubriques; let instance; let seance; let brouillon; let encours;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const A = (id) => `${base()}/actes/${id}`;
const S = (p = '') => `${base()}/seances/${seance.id}${p}`;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const chemin = (url) => new URL(url).pathname;

async function dossier(titre, { valider = false, envoyer = false } = {}) {
  const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre })).body;
  await as(t.dupont).put(A(a.id), { matiereId: matiere.id, rubriqueId: rubriques[0].id, incidenceFinanciere: false, rapporteurId: 1, seanceViseeId: seance.id });
  for (const x of (await as(t.dupont).get(`${A(a.id)}/textes`)).body.items) await as(t.dupont).put(`${A(a.id)}/textes/${x.id}`, { markdown: `Texte ${x.kind}.`, baseVersion: x.version });
  if (envoyer || valider) await as(t.dupont).post(`${A(a.id)}/envoi`);
  return a.id;
}

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = { boot: admin };
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['martin', 'pw-martin']]) t[u] = await loginAs(env, u, p);
  const refs = (k) => as(admin).get(`${base()}/referentiels/${k}`).then((r) => r.body.items);
  matiere = (await refs('matiere')).find((x) => x.code === '7.5'); rubriques = await refs('rubrique');
  typeDelib = (await refs('type_acte')).find((x) => x.code === 'deliberation');
  const tit = (fonction, username, extra = {}) => as(admin).post(`${base()}/titulaires`, { fonction, username, ...extra });
  await tit('chef_service', 'durand', { directionCode: 'A1', serviceCode: 'A1a' }); await tit('directeur', 'leroy', { directionCode: 'A1' }); await tit('dgs', 'boot');
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  instance = (await as(admin).get(`${base()}/instances`)).body.items[0];
  seance = (await as(t.martin).post(`${base()}/seances`, { instanceId: instance.id, dateSeance: inDays(120), lieu: 'Salle du Conseil' })).body;
});
afterAll(async () => { await env.close(); });

describe('générateur iCalendar (RFC 5545)', () => {
  it('échappe, replie à 75 octets sans couper un caractère, termine par CRLF', () => {
    expect(ics.echappe('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = ics.replie(`SUMMARY:${'é'.repeat(120)}`);
    for (const l of long.split('\r\n')) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(120)}`);
    const cal = ics.calendrier({ nom: 'Test', evenements: [ics.evenement({ uid: 'x@y', debut: '2026-11-04T18:30:00Z', resume: 'Séance', statut: 'CANCELLED', sequence: 3 })] });
    expect(cal.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true); expect(cal.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(cal).toMatch(/DTSTART:20261104T183000Z/); expect(cal).toMatch(/STATUS:CANCELLED/); expect(cal).toMatch(/SEQUENCE:3/);
  });
});

describe('lien de calendrier dynamique pour Outlook (SEA-17)', () => {
  let lien; let tokenPath;
  it('chacun crée son lien secret ; il se réaffiche ; le flux se lit sans connexion', async () => {
    expect((await as(t.dupont).get(`${base()}/calendrier/lien`)).body).toEqual({ actif: false });
    lien = (await as(t.dupont).post(`${base()}/calendrier/lien`, {})).body;
    expect(lien.actif).toBe(true); expect(lien.url).toMatch(/\/api\/v1\/calendrier\/[A-Za-z0-9_-]{32}\.ics$/); expect(lien.webcal).toMatch(/^webcal:\/\//);
    expect((await as(t.dupont).get(`${base()}/calendrier/lien`)).body.url).toBe(lien.url);
    tokenPath = chemin(lien.url);
    const r = await env.http().get(tokenPath);                                                   // aucun jeton : la clé EST l'authentification
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/text\/calendar/);
    expect(r.text).toMatch(/^BEGIN:VCALENDAR\r\n/); expect(r.text).toContain(`UID:seance-${seance.id}@vibedelib`); expect(r.text).toMatch(/LOCATION:Salle du Conseil/);
    expect(r.text).toMatch(/REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  });

  it('un agent voit les séances ; l’administration et le SCC voient aussi les jalons ; jamais de donnée de dossier', async () => {
    await dossier('Dossier confidentiel du budget');
    const agent = (await env.http().get(tokenPath)).text;
    expect(agent).not.toContain('jalon-redaction'); expect(agent).not.toContain('confidentiel');
    const lienScc = (await as(t.martin).post(`${base()}/calendrier/lien`, {})).body;
    const scc = (await env.http().get(chemin(lienScc.url))).text;
    expect(scc).toContain(`UID:jalon-redaction-${seance.id}@vibedelib`); expect(scc).toMatch(/SUMMARY:Clôture des dépôts/); expect(scc).not.toContain('confidentiel');
    for (const l of scc.split('\r\n')) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
  });

  it('se met à jour seul : déplacement, annulation ; ETag pour un rechargement léger', async () => {
    const r1 = await env.http().get(tokenPath); const etag = r1.headers.etag;
    expect((await env.http().get(tokenPath).set('If-None-Match', etag)).status).toBe(304);
    await as(t.martin).put(S(), { lieu: 'Hôtel de Ville — salle des mariages' });
    const r2 = await env.http().get(tokenPath);
    expect(r2.text).toMatch(/LOCATION:Hôtel de Ville/); expect(r2.headers.etag).not.toBe(etag);
    await env.db.run("UPDATE seances SET statut = 'annulee' WHERE id = $1", [seance.id]);
    const r3 = (await env.http().get(tokenPath)).text;
    expect(r3).toMatch(/STATUS:CANCELLED/); expect(r3).toMatch(/SUMMARY:ANNULÉE — /);
    await env.db.run("UPDATE seances SET statut = 'planifiee' WHERE id = $1", [seance.id]);
  });

  it('régénérer invalide l’ancien lien ; révoquer coupe le flux ; une clé inconnue donne 404', async () => {
    const neuf = (await as(t.dupont).post(`${base()}/calendrier/lien`, {})).body;
    expect(neuf.url).not.toBe(lien.url);
    expect((await env.http().get(tokenPath)).status).toBe(404);
    expect((await env.http().get(chemin(neuf.url))).status).toBe(200);
    expect((await as(t.dupont).del(`${base()}/calendrier/lien`)).body).toEqual({ actif: false });
    expect((await env.http().get(chemin(neuf.url))).status).toBe(404);
    expect((await env.http().get('/api/v1/calendrier/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ics')).status).toBe(404);
    expect((await env.http().get('/api/v1/calendrier/court')).status).toBe(400);
    const audit = await env.db.all("SELECT after FROM audit_log WHERE action LIKE 'calendrier.%'");
    expect(JSON.stringify(audit)).not.toMatch(/[A-Za-z0-9_-]{32}/);                                  // jamais la clé dans le journal
  });
});

describe('relancer les services d’une séance (SEA-16)', () => {
  it('l’aperçu regroupe par direction les dossiers non terminés ; réservé à l’administration et au SCC', async () => {
    brouillon = await dossier('Convention en retard');
    encours = await dossier('Subvention en circuit', { envoyer: true });
    await env.db.run("UPDATE seances SET date_limite_redaction = now() - interval '2 days' WHERE id = $1", [seance.id]);
    expect((await as(t.dupont).get(S('/relance'))).status).toBe(403);
    const ap = (await as(t.martin).get(S('/relance?cible=retard'))).body;
    expect(ap.total).toBeGreaterThanOrEqual(1); expect(ap.delaiHeures).toBe(24);
    const tous = ap.directions.flatMap((d) => d.dossiers);
    const b = tous.find((d) => d.acteId === brouillon);
    expect(b).toMatchObject({ enRetard: true, aRedacteur: true, destinataires: ['dupont'], recemmentRelance: false });
    expect((await as(t.martin).get(S('/relance?cible=tous'))).body.total).toBeGreaterThanOrEqual(ap.total);
  });

  it('relance : le rédacteur d’un brouillon est prévenu ; pas deux fois en 24 h sauf « relancer quand même »', async () => {
    const r = await as(t.martin).post(S('/relance'), { cible: 'retard', message: 'Merci de terminer avant vendredi.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.relances).toBeGreaterThanOrEqual(1);
    const ligne = r.body.items.find((x) => x.acteId === brouillon);
    expect(ligne).toMatchObject({ relance: true, destinataires: ['dupont'] });
    const notif = (await as(t.dupont).get(`${base()}/notifications?limit=10`)).body.items.find((n) => /^Relance/.test(n.title));
    expect(notif).toBeTruthy(); expect(notif.body).toMatch(/Merci de terminer avant vendredi/);
    const bis = await as(t.martin).post(S('/relance'), { cible: 'retard' });
    expect(bis.body.items.find((x) => x.acteId === brouillon)).toMatchObject({ relance: false, raison: expect.stringMatching(/Déjà relancé/) });
    expect((await as(t.martin).get(S('/relance?cible=retard'))).body.dejaRelances).toBeGreaterThanOrEqual(1);
    const force = await as(t.martin).post(S('/relance'), { cible: 'retard', forcer: true });
    expect(force.body.items.find((x) => x.acteId === brouillon).relance).toBe(true);
    expect(await env.db.get("SELECT count(*)::int AS n FROM seance_relances WHERE acte_id = $1", [brouillon])).toEqual({ n: 2 });
  });

  it('« tous les dossiers non terminés » prévient aussi le détenteur de l’étape ; on peut restreindre à des directions', async () => {
    const r = await as(t.martin).post(S('/relance'), { cible: 'tous', forcer: true });
    const c = r.body.items.find((x) => x.acteId === encours);
    expect(c.relance).toBe(true); expect(c.destinataires.length).toBeGreaterThan(0);
    expect((await as(t.martin).post(S('/relance'), { cible: 'tous', directions: ['ZZZ'], forcer: true })).status).toBe(409); // aucune direction correspondante
    expect((await as(t.dupont).post(S('/relance'), { cible: 'tous' })).status).toBe(403);
    const audit = await env.db.get("SELECT after FROM audit_log WHERE action = 'seance.relance' ORDER BY id DESC LIMIT 1");
    expect(audit.after).toMatchObject({ cible: 'tous' });
  });
});

describe('synthèse de la liste des séances (SEA-15)', () => {
  it('indicateurs de carte et bandeau, réservés à l’administration et au SCC', async () => {
    expect((await as(t.dupont).get(`${base()}/seances-synthese?ids=${seance.id}`)).status).toBe(403);
    expect((await as(t.martin).get(`${base()}/seances-synthese?ids=abc`)).status).toBe(400);
    const r = (await as(t.martin).get(`${base()}/seances-synthese?ids=${seance.id},999999`)).body;
    const s = r.items.find((x) => x.seanceId === seance.id);
    expect(s).toMatchObject({ dossiers: expect.any(Number), aTerminer: expect.any(Number), tauxRealisation: expect.any(Number) });
    expect(s.etape).toMatchObject({ cle: expect.any(String), label: expect.any(String) });
    expect(s.jours).toBeGreaterThan(100);
    expect(r.items.find((x) => x.seanceId === 999999).indisponible).toBe(true);
    expect(r.bandeau).toMatchObject({ actesEnInstruction: expect.any(Number), transmissionsSansAr: 0, transmissionsAEnvoyer: 0 });
  });
});
