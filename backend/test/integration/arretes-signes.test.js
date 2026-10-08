const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let dupont; let ville; let pdf;
const base = () => `/api/v1/organismes/${ville.id}`;

const creer = (tok, champs = {}, { annexes = [] } = {}) => {
  let r = env.http().post(`${base()}/actes/arrete-signe`).set(bearer(tok));
  const f = { titre: 'Arrêté portant fermeture de la rue Truillot', dateSignature: '2026-09-02', signataire: 'Le Maire', numeroArrete: 'AR202609_41', controleLegalite: JSON.stringify({ etat: 'a_transmettre' }), ...champs };
  for (const [k, v] of Object.entries(f)) if (v !== undefined) r = r.field(k, v);
  r = r.attach('arrete', pdf, 'arrete.pdf');
  annexes.forEach((a, i) => { r = r.attach('annexes', pdf, `annexe-${i + 1}.pdf`); });
  return annexes.length ? r.field('annexesTitres', JSON.stringify(annexes)) : r;
};

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  ville = (await env.http().get('/api/v1/organismes').set(bearer(admin))).body.items.find((o) => o.code === 'ville');
  const d = await PDFDocument.create(); d.addPage([200, 200]); pdf = Buffer.from(await d.save());
});
afterAll(async () => { await env.close(); });

describe('arrêté déjà signé', () => {
  let a;
  it('crée un arrêté signé avec ses annexes, sans circuit ni exposé, directement en bibliothèque', async () => {
    const r = await creer(dupont, {}, { annexes: ['Plan de circulation', 'Photographies'] });
    expect(r.status).toBe(201);
    a = r.body;
    expect(a).toMatchObject({ statut: 'signe', typeCode: 'arrete', titre: 'Arrêté portant fermeture de la rue Truillot', signePar: 'Le Maire' });
    expect(new Date(a.signeAt).toISOString().slice(0, 10)).toBe('2026-09-02');
    expect(a.custom.dejaSigne).toMatchObject({ numeroArrete: 'AR202609_41', signataire: 'Le Maire' });
    expect(a.custom.controleLegalite).toEqual({ etat: 'a_transmettre' });
    const annexes = (await env.http().get(`${base()}/actes/${a.id}/annexes`).set(bearer(dupont))).body.items;
    expect(annexes.map((x) => x.titre)).toEqual(['Plan de circulation', 'Photographies']);
    const src = await env.db.get('SELECT document_source_pdf_file_id AS f, source_collecteur, site FROM actes WHERE id = $1', [a.id]);
    expect(src.f).toBeTruthy(); expect(src.site).toBe(false);                                    // un arrêté saisi n'est pas un arrêté « site »
    expect((await env.db.get("SELECT count(*)::int AS n FROM tracked_texts WHERE acte_id = $1 AND kind = 'expose' AND markdown <> ''", [a.id])).n).toBe(0);   // pas d'exposé des motifs
    const biblio = (await env.http().get(`${base()}/bibliotheque?q=Truillot`).set(bearer(dupont))).body;
    expect(biblio.items.map((x) => x.acteId ?? x.id)).toContain(a.id);                              // directement en bibliothèque
  });

  it('est proposé à la télétransmission tant qu’il est « à transmettre », puis en sort quand il est déjà envoyé', async () => {
    const lot = async () => (await env.http().get(`${base()}/teletransmission/hors-seance`).set(bearer(admin))).body.items.map((i) => i.acteId);
    expect(await lot()).toContain(a.id);
    expect((await env.http().put(`${base()}/actes/${a.id}/controle-legalite`).set(bearer(dupont)).send({ etat: 'deja_envoye' })).status).toBe(400);   // date d'envoi exigée
    expect((await env.http().put(`${base()}/actes/${a.id}/controle-legalite`).set(bearer(dupont)).send({ etat: 'deja_envoye', dateEnvoi: '2999-01-01' })).status).toBe(400);
    const r = await env.http().put(`${base()}/actes/${a.id}/controle-legalite`).set(bearer(dupont)).send({ etat: 'deja_envoye', dateEnvoi: '2026-09-03', dateAr: '2026-09-04', numeroAr: '094-219400413-20260903-AR202609_41-AI' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ etat: 'deja_envoye', dateEnvoi: '2026-09-03', dateAr: '2026-09-04' });
    expect(await lot()).not.toContain(a.id);
    expect((await env.http().put(`${base()}/actes/${a.id}/controle-legalite`).set(bearer(dupont)).send({ etat: 'a_transmettre' })).status).toBe(200);
    expect(await lot()).toContain(a.id);                                                         // réversible
  });

  it('refuse un dossier incomplet ou invalide, sans laisser de dossier à moitié créé', async () => {
    const avant = (await env.db.get('SELECT count(*)::int AS n FROM actes')).n;
    expect((await creer(dupont, { titre: 'x' })).status).toBe(400);
    expect((await creer(dupont, { dateSignature: '2999-01-01' })).status).toBe(400);
    expect((await creer(dupont, { controleLegalite: undefined })).status).toBe(400);
    expect((await creer(dupont, { controleLegalite: JSON.stringify({ etat: 'deja_envoye' }) })).status).toBe(400);
    const sansFichier = await env.http().post(`${base()}/actes/arrete-signe`).set(bearer(dupont)).field('titre', 'Arrêté sans document').field('dateSignature', '2026-09-02').field('controleLegalite', JSON.stringify({ etat: 'a_transmettre' }));
    expect(sansFichier.status).toBe(400);
    const faux = await env.http().post(`${base()}/actes/arrete-signe`).set(bearer(dupont)).field('titre', 'Arrêté mal formé').field('dateSignature', '2026-09-02').field('controleLegalite', JSON.stringify({ etat: 'a_transmettre' })).attach('arrete', Buffer.from('pas un pdf'), 'arrete.pdf');
    expect(faux.status).toBe(400);
    expect((await env.db.get('SELECT count(*)::int AS n FROM actes')).n).toBe(avant);
  });
});
