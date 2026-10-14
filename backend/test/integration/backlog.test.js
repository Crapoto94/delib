const { createTestEnv, loginAs, bearer, adminToken } = require('../helpers');

let env; let admin; let dupont; let durand; let ville;
const B = (p = '') => `/api/v1/organismes/${ville.id}/backlog${p}`;
const as = (tok) => ({ get: (u) => env.http().get(u).set(bearer(tok)), post: (u, b) => env.http().post(u).set(bearer(tok)).send(b), put: (u, b) => env.http().put(u).set(bearer(tok)).send(b) });

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  dupont = await loginAs(env, 'dupont', 'pw-dupont');
  durand = await loginAs(env, 'durand', 'pw-durand');
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  expect((await as(admin).post(`/api/v1/organismes/${ville.id}/roles`, { username: 'durand', role: 'scc' })).status).toBeLessThan(300);
});
afterAll(async () => { await env.close(); });

describe('backlog', () => {
  let bug; let evo;
  it('tout utilisateur déclare un bug ou demande une évolution', async () => {
    const r = await as(dupont).post(B(), { type: 'bug', titre: 'Le bouton ne répond pas', description: 'Sur la fiche, rien ne se passe.', versionApp: '0.54.0' });
    expect(r.status).toBe(201); bug = r.body;
    expect(bug).toMatchObject({ type: 'bug', statut: 'demandee', demandeur: 'dupont', demandeurEmail: 'alice.dupont@ivry.test' });
    evo = (await as(dupont).post(B(), { type: 'evolution', titre: 'Export Excel', description: 'Exporter la liste.' })).body;
    expect((await as(dupont).post(B(), { type: 'autre', titre: 'xxx', description: 'yyy' })).status).toBe(400);
    expect((await as(dupont).get(B('/mes-demandes'))).body.items).toHaveLength(2);
  });

  it('la liste complète et le traitement sont réservés au SCC et à l\'administrateur', async () => {
    expect((await as(dupont).get(B())).status).toBe(403);
    expect((await as(dupont).put(B(`/${bug.id}/etat`), { statut: 'acceptee' })).status).toBe(403);
    expect((await as(durand).get(B())).body.items).toHaveLength(2);
    expect((await as(durand).get(B('?statut=acceptee'))).body.items).toHaveLength(0);
  });

  it('chaque changement d\'état prévient le demandeur par courriel', async () => {
    const avant = env.mail.state.sent.length;
    const a = await as(durand).put(B(`/${bug.id}/etat`), { statut: 'acceptee' });
    expect(a.status).toBe(200); expect(a.body).toMatchObject({ statut: 'acceptee', traitePar: 'durand', courriel: 'envoye' });
    const m = env.mail.state.sent[avant];
    expect(m.to).toBe('alice.dupont@ivry.test'); expect(m.subject).toContain('acceptée'.toLowerCase());
    const r = await as(durand).put(B(`/${bug.id}/etat`), { statut: 'realisee' });
    expect(r.body.statut).toBe('realisee'); expect(env.mail.state.sent.length).toBe(avant + 2);
  });

  it('un refus exige un motif, transmis au demandeur', async () => {
    expect((await as(durand).put(B(`/${evo.id}/etat`), { statut: 'refusee' })).status).toBe(400);
    const avant = env.mail.state.sent.length;
    const r = await as(durand).put(B(`/${evo.id}/etat`), { statut: 'refusee', motif: 'Hors périmètre' });
    expect(r.body).toMatchObject({ statut: 'refusee', motif: 'Hors périmètre' });
    expect(env.mail.state.sent[avant].html).toContain('Hors périmètre');
    expect((await as(durand).put(B(`/${evo.id}/etat`), { statut: 'realisee' })).status).toBe(400);
  });

  it('un échec d\'envoi ne bloque pas le changement d\'état', async () => {
    env.mail.failNext(1);
    const r = await as(durand).put(B(`/${evo.id}/etat`), { statut: 'acceptee' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ statut: 'acceptee', courriel: 'echec' });
  });
});

describe('backlog — pièces jointes', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const post = (tok, champs, fichiers) => {
    let rq = env.http().post(B()).set(bearer(tok));
    for (const [k, v] of Object.entries(champs)) rq = rq.field(k, v);
    for (const [nom, buf] of fichiers) rq = rq.attach('fichiers', buf, nom);
    return rq;
  };
  let d;
  it('une capture et un document accompagnent la demande ; le demandeur et le SCC les téléchargent', async () => {
    const r = await post(dupont, { type: 'bug', titre: 'Erreur affichée', description: 'Voir la capture.' }, [['capture-20261014-1010.png', PNG], ['note.txt', Buffer.from('détail')]]);
    expect(r.status).toBe(201); d = r.body; expect(d.pieces).toHaveLength(2);
    const liste = (await as(durand).get(B())).body.items.find((x) => x.id === d.id);
    expect(liste.pieces.map((p) => p.nom)).toEqual(['capture-20261014-1010.png', 'note.txt']);
    for (const tok of [dupont, durand]) {
      const f = await env.http().get(B(`/${d.id}/pieces/${d.pieces[0].id}/file`)).set(bearer(tok));
      expect(f.status).toBe(200); expect(f.headers['content-type']).toContain('image/png'); expect(Buffer.compare(f.body, PNG)).toBe(0);
    }
  });
  it('un autre agent n\'y a pas accès', async () => {
    const martin = await loginAs(env, 'martin', 'pw-martin');
    expect((await env.http().get(B(`/${d.id}/pieces/${d.pieces[0].id}/file`)).set(bearer(martin))).status).toBe(403);
  });
  it('refuse un type non accepté, un faux contenu et plus de 5 fichiers', async () => {
    const base = { type: 'bug', titre: 'Pièce refusée', description: 'Test.' };
    expect((await post(dupont, base, [['virus.exe', Buffer.from('MZ')]])).status).toBe(400);
    expect((await post(dupont, base, [['faux.png', Buffer.from('pas une image')]])).status).toBe(400);
    expect((await post(dupont, base, Array.from({ length: 6 }, (_, i) => [`n${i}.txt`, Buffer.from('x')]))).status).toBeGreaterThanOrEqual(400);
  });
});
