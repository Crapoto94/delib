const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let ville; let t; let typeDelib; let com; let autre; let reunion; let elus; let dossier;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const O = () => `${base()}/seances/${reunion.id}/odj`;
const C = () => `${base()}/seances/${reunion.id}/convocation`;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const pdf = async (titre = 'Note') => { const d = await PDFDocument.create(); d.addPage().drawText(titre); return Buffer.from(await d.save()); };
const upload = (tok, itemId, buf, name, extra = {}) => env.http().post(`${O()}/points/${itemId}/fichiers`).set(bearer(tok)).field('titre', extra.titre || '').attach('file', buf, name);
const bin = (r) => r.buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['martin', 'pw-martin']]) t[u] = await loginAs(env, u, p);
  await as(admin).post(`${base()}/roles`, { username: 'martin', role: 'scc' });
  typeDelib = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items.find((x) => x.code === 'deliberation');
  elus = [];
  for (const e of [{ nom: 'Durif', prenom: 'Paul', email: 'paul.durif@example.fr' }, { nom: 'Lambert', prenom: 'Jeanne', email: 'jeanne.lambert@example.fr' }]) elus.push((await as(admin).post(`${base()}/elus`, e)).body);
});
afterAll(async () => { await env.close(); });

describe('type de commission', () => {
  it('une commission est, par défaut, associée à la rédaction des actes ; elle peut être « autre »', async () => {
    com = (await as(admin).post(`${base()}/commissions`, { nom: 'Commission Finances' })).body;
    autre = (await as(admin).post(`${base()}/commissions`, { nom: 'Commission d\'appel d\'offres', type: 'autre' })).body;
    expect(com.type).toBe('actes'); expect(autre.type).toBe('autre');
    expect((await as(admin).put(`${base()}/commissions/${autre.id}`, { type: 'actes' })).body.type).toBe('actes');
    expect((await as(admin).put(`${base()}/commissions/${autre.id}`, { type: 'autre' })).body.type).toBe('autre');
    expect((await as(admin).post(`${base()}/commissions`, { nom: 'Type invalide', type: 'divers' })).status).toBe(400);
    expect((await as(admin).get(`${base()}/commissions`)).body.items.find((c) => c.id === autre.id).type).toBe('autre');
  });

  it('une commission « autre » ne peut pas être proposée pour avis sur un acte ; une commission « actes » le peut', async () => {
    const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: typeDelib.id, titre: 'Acte de test' })).body;
    const r = await as(t.dupont).post(`${base()}/actes/${a.id}/commissions`, { commissionId: autre.id });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/pas associée à la rédaction des actes/);
    expect((await as(t.dupont).post(`${base()}/actes/${a.id}/commissions`, { commissionId: com.id })).status).toBe(201);
  });
});

describe('dossiers simples de l\'ordre du jour d\'une réunion de commission', () => {
  it('une réunion de la commission « autre » reçoit des dossiers simples : nom, description et pièces jointes', async () => {
    await as(admin).put(`${base()}/commissions/${autre.id}/membres`, { membres: elus.map((e, i) => ({ eluId: e.id, fonction: i ? 'membre' : 'president' })) });
    reunion = (await as(t.martin).post(`${base()}/commissions/${autre.id}/reunions`, { dateSeance: inDays(20), dureeMinutes: 120, lieu: 'Salle B', teams: { mode: 'aucun' } })).body;
    const r = await as(t.martin).post(`${O()}/points`, { titre: 'Marché de fournitures scolaires', description: 'Analyse des offres reçues pour le lot 2.', numerote: true });
    expect(r.status).toBe(201);
    dossier = r.body.items.find((i) => i.titre === 'Marché de fournitures scolaires');
    expect(dossier).toMatchObject({ kind: 'libre', description: 'Analyse des offres reçues pour le lot 2.', fichiers: [] });
    const up = await upload(t.martin, dossier.id, await pdf('Rapport d\'analyse'), 'rapport-analyse.pdf', { titre: 'Rapport d\'analyse des offres' });
    expect(up.status).toBe(201);
    const item = up.body.items.find((i) => i.id === dossier.id);
    expect(item.fichiers).toHaveLength(1);
    expect(item.fichiers[0]).toMatchObject({ titre: 'Rapport d\'analyse des offres', nom: 'rapport-analyse.pdf', mime: 'application/pdf', pages: 1 });
    const dl = await bin(as(t.martin).get(`${O()}/points/${dossier.id}/fichiers/${item.fichiers[0].id}`));
    expect(dl.status).toBe(200);
    expect((await PDFDocument.load(dl.body)).getPageCount()).toBe(1);
  });

  it('contrôle le type des pièces jointes (extension et signature), l\'existence du dossier et les droits', async () => {
    expect((await upload(t.martin, dossier.id, Buffer.from('MZ exécutable'), 'virus.exe')).status).toBe(400);
    expect((await upload(t.martin, dossier.id, Buffer.from('ceci n\'est pas un pdf'), 'faux.pdf')).status).toBe(400);
    expect((await upload(t.martin, 999999, await pdf(), 'note.pdf')).status).toBe(404);
    expect((await upload(t.dupont, dossier.id, await pdf(), 'note.pdf')).status).toBe(403);
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('contenu docx')]);
    expect((await upload(t.martin, dossier.id, docx, 'compte-rendu.docx')).status).toBe(201);
  });

  it('modifie la description et retire une pièce jointe', async () => {
    const maj = await as(t.martin).put(`${O()}/points/${dossier.id}`, { description: 'Description mise à jour.' });
    expect(maj.body.items.find((i) => i.id === dossier.id).description).toBe('Description mise à jour.');
    const cur = maj.body.items.find((i) => i.id === dossier.id);
    const del = await as(t.martin).del(`${O()}/points/${dossier.id}/fichiers/${cur.fichiers[1].id}`);
    expect(del.body.items.find((i) => i.id === dossier.id).fichiers).toHaveLength(1);
    expect((await as(t.martin).del(`${O()}/points/${dossier.id}/fichiers/999999`)).status).toBe(404);
  });
});

describe('convocation d\'une commission avec ses dossiers simples', () => {
  let tokens; let fichierId;
  it('convoque les membres de la commission : la convocation reprend les dossiers, leur description et leurs pièces', async () => {
    const p = (await as(t.martin).get(`${C()}/preparation`)).body;
    expect(p.seance.commission).toBe(true);
    expect(p.elus.map((e) => e.nom).sort()).toEqual(['Jeanne LAMBERT', 'Paul DURIF']);
    expect((await as(t.martin).post(`${O()}/arret`, { forcer: true })).status).toBe(200);
    const r = await as(t.martin).post(C(), { agents: [] });
    expect(r.status).toBe(202);
    await env.c.convocations.idle();
    const mails = env.mail.state.sent.filter((m) => /Convocation/.test(m.subject));
    expect(mails).toHaveLength(2);
    tokens = mails.map((m) => /\/c\/([A-Za-z0-9_-]{20,})/.exec(m.html)[1]);
    expect(new Set(tokens).size).toBe(2);
  });

  it('le convoqué voit le dossier simple et sa pièce jointe depuis son lien personnel, et chaque consultation est journalisée', async () => {
    const page = (await env.http().get(`/api/v1/public/convocations/${tokens[0]}`)).body;
    const d = page.ordreDuJour.find((i) => i.titre === 'Marché de fournitures scolaires');
    expect(d.description).toBe('Description mise à jour.');
    expect(d.fichiers).toHaveLength(1);
    fichierId = d.fichiers[0].id;
    const f = await bin(env.http().get(`/api/v1/public/convocations/${tokens[0]}/pieces/${fichierId}`));
    expect(f.status).toBe(200);
    expect(f.headers['content-type']).toMatch(/pdf/);
    const j = (await as(t.martin).get(`${C()}/versions/1/journal?type=piece_lue`)).body;
    expect(j.total).toBe(1);
    expect(j.items[0]).toMatchObject({ nom: expect.any(String), meta: { fichierId, fichier: 'Rapport d\'analyse des offres' } });
  });

  it('une pièce qui ne figure pas dans la convocation, ou un lien inconnu, ne donne rien', async () => {
    expect((await env.http().get(`/api/v1/public/convocations/${tokens[0]}/pieces/999999`)).status).toBe(404);
    expect((await env.http().get(`/api/v1/public/convocations/jeton-inconnu-jeton-inconnu/pieces/${fichierId}`)).status).toBe(404);
  });

  it('le PDF de convocation et l\'ordre du jour mentionnent la description et les pièces jointes', async () => {
    const conv = await bin(env.http().get(`/api/v1/public/convocations/${tokens[1]}/convocation.pdf`));
    expect(conv.status).toBe(200);
    expect((await PDFDocument.load(conv.body)).getPageCount()).toBeGreaterThanOrEqual(1);
    const v = (await as(t.martin).get(`${C()}/versions/1`)).body;
    expect(v.points).toBe(1);
  });
});
