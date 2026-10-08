const { PDFDocument, StandardFonts } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');
const { createArretesSite, lirePage, verifierUrl } = require('../../src/modules/arretes-site/arretes-site.service');

const PAGE = 'https://www.example-ville.fr/2214/arretes-pris-par-le-maire.htm';
const BASE = 'https://www.example-ville.fr/fileadmin/MEDIA/Opendata/Arretes';
const HTML = `<html><body>
  <a href="${BASE}/2026/09-septembre/AR202609_02_Plan_communal_de_sauvegarde.pdf">AR202609_02</a>
  <a href="${BASE}/2026/09-septembre/AR202609_02_Plan_communal_de_sauvegarde.pdf">doublon</a>
  <a href="${BASE}/2025/03-mars/AR202503_11_Fermeture_Ossuaire.PDF">AR202503_11</a>
  <a href="${BASE}/2022/12-decembre/AR202212_01.pdf">AR202212_01</a>
  <a href="https://www.example-ville.fr/fileadmin/MEDIA/Guide_du_stationnement.pdf">autre PDF</a>
  <a href="https://autre-site.org/fileadmin/MEDIA/Opendata/Arretes/2026/01-janvier/AR202601_01_Intrus.pdf">autre site</a>
</body></html>`;

const pdf = async (texte) => {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([400, 300]); p.drawText(texte, { x: 10, y: 150, size: 8, font: f });
  return Buffer.from(await d.save());
};
const reponse = (buf, ok = true) => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

let env; let admin; let ville; let svc;
beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  const pdfs = {
    [`${BASE}/2026/09-septembre/AR202609_02_Plan_communal_de_sauvegarde.pdf`]: await pdf('Accuse de reception 094-219400413-20260902-AR202609_02-AI'),
    [`${BASE}/2025/03-mars/AR202503_11_Fermeture_Ossuaire.PDF`]: await pdf('Arrete sans identifiant de prefecture'),
  };
  const http = async (u) => {
    if (u === PAGE) return reponse(Buffer.from(HTML));
    if (pdfs[u]) return reponse(pdfs[u]);
    return reponse(Buffer.from('introuvable'), false);   // AR202212_01.pdf : erreur réseau simulée
  };
  svc = createArretesSite({ db: env.db, audit: env.c.audit, storage: env.c.storage, refs: env.c.refs, settings: env.c.settings, log: null, bus: env.c.bus, http });
});
afterAll(async () => { await env.close(); });

describe('arrêtés du site : lecture de la page', () => {
  it('liste les PDF d’arrêtés de la page, sans doublon ni autre site', () => {
    const l = lirePage(HTML, PAGE);
    expect(l.map((x) => x.numero)).toEqual(['AR202609_02', 'AR202503_11', 'AR202212_01']);
    expect(l[0]).toMatchObject({ annee: 2026, mois: 9, titre: 'Plan communal de sauvegarde' });
    expect(l[2].titre).toBe('Arrêté AR202212_01');                                           // pas de titre dans le nom du fichier
  });
  it('n’accepte que des adresses HTTPS de noms de domaine publics', () => {
    expect(() => verifierUrl('http://www.ivry94.fr/x')).toThrow();
    expect(() => verifierUrl('https://127.0.0.1/x')).toThrow();
    expect(() => verifierUrl('https://localhost/x')).toThrow();
    expect(() => verifierUrl('https://www.ivry94.fr/2214/arretes-pris-par-le-maire.htm')).not.toThrow();
  });
});

describe('arrêtés du site : reprise', () => {
  const attendre = async (job) => { for (let i = 0; i < 200 && job.etat === 'en_cours'; i++) await new Promise((r) => setTimeout(r, 25)); return job; };

  it('crée des arrêtés signés marqués « site », avec leur date et leur document', async () => {
    const job = await attendre(await svc.lancer({ username: 'admin' }, ville.id, { url: PAGE }));
    expect(job).toMatchObject({ etat: 'termine', total: 3, nouveaux: 2, ignores: 0 });
    expect(job.erreurs).toHaveLength(1); expect(job.erreurs[0].url).toMatch(/AR202212_01/);   // l'erreur d'un arrêté n'arrête pas les autres
    const rows = await env.db.all('SELECT a.titre, a.statut, a.site, a.redacteur, a.signe_at, a.custom, f.mime FROM actes a JOIN files f ON f.id = a.document_source_pdf_file_id WHERE a.site ORDER BY a.signe_at');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.statut === 'signe' && r.site && r.redacteur === '@site' && r.mime === 'application/pdf')).toBe(true);
    const sept = rows.find((r) => r.titre === 'Plan communal de sauvegarde');
    expect(new Date(sept.signe_at).toISOString().slice(0, 10)).toBe('2026-09-02');          // date lue dans l'accusé de réception
    expect(sept.custom.site).toMatchObject({ numero: 'AR202609_02', dateApproximative: false });
    const mars = rows.find((r) => r.titre === 'Fermeture Ossuaire');
    expect(new Date(mars.signe_at).toISOString().slice(0, 7)).toBe('2025-03');               // à défaut, le mois du dossier
    expect(mars.custom.site.dateApproximative).toBe(true);
  });

  it('est listé par la recherche de la bibliothèque (sans texte, avec le titre, avec le numéro)', async () => {
    const dupont = await loginAs(env, 'dupont', 'pw-dupont');
    const cherche = async (tok, q = '') => (await env.http().get(`/api/v1/organismes/${ville.id}/bibliotheque${q}`).set(bearer(tok))).body;
    expect((await cherche(dupont)).items.map((x) => x.titre)).toEqual(expect.arrayContaining(['Plan communal de sauvegarde', 'Fermeture Ossuaire']));
    expect((await cherche(dupont, '?q=sauvegarde')).items.map((x) => x.titre)).toContain('Plan communal de sauvegarde');
    expect((await cherche(dupont, '?q=Ossuaire')).items.map((x) => x.titre)).toContain('Fermeture Ossuaire');
    expect((await cherche(dupont, '?q=AR202609_02')).items.map((x) => x.titre)).toContain('Plan communal de sauvegarde');
    expect((await cherche(dupont, '?annee=2026')).items.map((x) => x.titre)).toContain('Plan communal de sauvegarde');
    // le texte du PDF de l'arrêté est indexé (en arrière-plan) : un mot présent seulement dans le document retrouve l'arrêté
    let trouve = [];
    for (let i = 0; i < 80 && !trouve.includes('Fermeture Ossuaire'); i++) { trouve = (await cherche(dupont, '?q=identifiant')).items.map((x) => x.titre); if (!trouve.includes('Fermeture Ossuaire')) await new Promise((r) => setTimeout(r, 100)); }
    expect(trouve).toContain('Fermeture Ossuaire');
  });

  it('est rejouable : un arrêté déjà repris est ignoré', async () => {
    const job = await attendre(await svc.lancer({ username: 'admin' }, ville.id, { url: PAGE }));
    expect(job).toMatchObject({ etat: 'termine', nouveaux: 0, ignores: 2 });
    expect((await env.db.get('SELECT count(*)::int AS n FROM actes WHERE site')).n).toBe(2);
  });

  it('survit à un effacement général des données et ne se supprime pas depuis l’application', async () => {
    await env.db.run('DELETE FROM actes WHERE organisme_id = $1', [ville.id]);              // effacement général
    expect((await env.db.get('SELECT count(*)::int AS n FROM actes WHERE site')).n).toBe(2);
    const id = (await env.db.get('SELECT id FROM actes WHERE site LIMIT 1')).id;
    const r = await env.http().delete(`/api/v1/organismes/${ville.id}/actes/${id}`).set(bearer(admin));
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/site de la Ville/);
  });

  it('l’administration voit l’état et lance la reprise ; les autres rôles n’y ont pas accès', async () => {
    const dupont = await loginAs(env, 'dupont', 'pw-dupont');
    expect((await env.http().get(`/api/v1/organismes/${ville.id}/arretes-site`).set(bearer(dupont))).status).toBe(403);
    expect((await env.http().post(`/api/v1/organismes/${ville.id}/arretes-site/reprise`).set(bearer(dupont)).send({})).status).toBe(403);
    const e = (await env.http().get(`/api/v1/organismes/${ville.id}/arretes-site`).set(bearer(admin))).body;
    expect(e).toMatchObject({ total: 2 }); expect(e.parAnnee.map((x) => x.annee)).toEqual([2026, 2025]);
  });
});
