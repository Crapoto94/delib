const { PDFDocument } = require('pdf-lib');
const { createTestEnv, loginAs, bearer, adminToken, makePdf } = require('../helpers');

let env; let admin; let ville; let t; let acte; let texts;
const as = (tok) => ({
  get: (u) => env.http().get(u).set(bearer(tok)),
  post: (u, b) => env.http().post(u).set(bearer(tok)).send(b),
  put: (u, b) => env.http().put(u).set(bearer(tok)).send(b),
  del: (u) => env.http().delete(u).set(bearer(tok)),
});
const base = () => `/api/v1/organismes/${ville.id}`;
const tx = (a = acte) => `${base()}/actes/${a.id}/textes`;
const pdfOf = (res) => PDFDocument.load(res.body, { updateMetadata: false });
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const preview = (tok, body, a = acte) => env.http().post(`${base()}/actes/${a.id}/apercu`).set(bearer(tok)).send(body).buffer(true).parse(binary);
const find = (kind, delibId = null) => texts.find((x) => x.kind === kind && (x.deliberationId ?? null) === delibId);

beforeAll(async () => {
  env = await createTestEnv();
  admin = await adminToken(env);
  ville = (await as(admin).get('/api/v1/organismes')).body.items.find((o) => o.code === 'ville');
  t = {};
  for (const [u, p] of [['dupont', 'pw-dupont'], ['durand', 'pw-durand'], ['leroy', 'pw-leroy'], ['petit', 'pw-petit']]) t[u] = await loginAs(env, u, p);
  const types = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items;
  acte = (await as(t.dupont).post(`${base()}/actes`, { typeId: types[0].id, titre: 'Attribution d\'une subvention à l\'association Les Amis du Sport' })).body;
  texts = (await as(t.dupont).get(tx())).body.items;
});
afterAll(async () => { await env.close(); });

describe('création des textes', () => {
  it('crée l\'exposé et, pour chaque délibération, « Vu et considérant » et « Délibéré »', () => {
    expect(texts).toHaveLength(3);
    expect(find('expose').label).toBe('Exposé des motifs');
    expect(find('visas', acte.id && texts.find((x) => x.kind === 'visas').deliberationId).label).toBe('Vu et considérant');
    expect(texts.every((x) => x.empty && x.version === 1 && x.tracking === false)).toBe(true);
  });

  it('ajouter une délibération crée ses deux textes', async () => {
    const d = (await as(t.dupont).post(`${base()}/actes/${acte.id}/deliberations`, { titre: 'Convention d\'objectifs' })).body;
    const list = (await as(t.dupont).get(tx())).body.items;
    expect(list.filter((x) => x.deliberationId === d.id).map((x) => x.kind).sort()).toEqual(['dispositif', 'visas']);
    await as(t.dupont).del(`${base()}/actes/${acte.id}/deliberations/${d.id}`);
    texts = (await as(t.dupont).get(tx())).body.items;
  });
});

describe('rédaction libre avant l\'envoi (pas de coloration)', () => {
  it('enregistre, incrémente la version et conserve un instantané', async () => {
    const e = find('expose');
    const r = await as(t.dupont).put(`${tx()}/${e.id}`, { markdown: 'Le conseil est invité à approuver la subvention.', baseVersion: e.version });
    expect(r.body).toMatchObject({ changed: true, version: 2, tracking: false });
    const v = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    expect(v.markdown).toBe('Le conseil est invité à approuver la subvention.');
    expect(v.spans.every((s) => s.type === 'text')).toBe(true);
    expect((await as(t.dupont).get(`${tx()}/${e.id}/versions`)).body.items.map((x) => x.version)).toEqual([2]);
  });

  it('détecte un enregistrement sur une version périmée (409 avec la version courante)', async () => {
    const e = find('expose');
    const r = await as(t.dupont).put(`${tx()}/${e.id}`, { markdown: 'Autre texte', baseVersion: 1 });
    expect(r.status).toBe(409);
    expect(r.body.details).toMatchObject({ currentVersion: 2 });
    expect(r.body.details.markdown).toContain('subvention');
  });

  it('un enregistrement sans changement ne crée pas de version', async () => {
    const e = find('expose');
    const r = await as(t.dupont).put(`${tx()}/${e.id}`, { markdown: 'Le conseil est invité à approuver la subvention.  \r\n', baseVersion: 2 });
    expect(r.body).toMatchObject({ changed: false, version: 2 });
  });

  it('remplit visas et dispositif de la délibération', async () => {
    const v = texts.find((x) => x.kind === 'visas'); const d = texts.find((x) => x.kind === 'dispositif');
    await as(t.dupont).put(`${tx()}/${v.id}`, { markdown: 'Vu le code général des collectivités territoriales ;\nConsidérant l\'intérêt local ;', baseVersion: 1 });
    await as(t.dupont).put(`${tx()}/${d.id}`, { markdown: 'Article 1 : la subvention de 500 euros est attribuée.', baseVersion: 1 });
    texts = (await as(t.dupont).get(tx())).body.items;
    expect(texts.every((x) => !x.empty)).toBe(true);
  });
});

describe('brouillon privé et verrou souple', () => {
  it('sauvegarde un brouillon visible de son seul auteur, supprimé à l\'enregistrement', async () => {
    const e = find('expose');
    await as(t.dupont).put(`${tx()}/${e.id}/brouillon`, { markdown: 'Brouillon en cours…' });
    expect((await as(t.dupont).get(`${tx()}/${e.id}/brouillon`)).body.draft.markdown).toBe('Brouillon en cours…');
    expect((await as(t.durand).get(`${tx()}/${e.id}/brouillon`)).body.draft).toBeNull();
    expect((await as(t.dupont).get(`${tx()}/${e.id}`)).body.draft.markdown).toBe('Brouillon en cours…');
    await as(t.dupont).put(`${tx()}/${e.id}`, { markdown: 'Le conseil est invité à approuver la subvention exceptionnelle.', baseVersion: (await as(t.dupont).get(`${tx()}/${e.id}`)).body.version });
    expect((await as(t.dupont).get(`${tx()}/${e.id}/brouillon`)).body.draft).toBeNull();
    texts = (await as(t.dupont).get(tx())).body.items;
  });

  it('un verrou empêche un autre éditeur d\'enregistrer, puis se libère', async () => {
    await as(t.dupont).put(`${base()}/actes/${acte.id}`, { coRedacteurs: ['durand'] });
    const e = find('expose');
    expect((await as(t.dupont).post(`${tx()}/${e.id}/verrou`)).body.user).toBe('dupont');
    expect((await as(t.durand).post(`${tx()}/${e.id}/verrou`)).status).toBe(409);
    const cur = (await as(t.durand).get(`${tx()}/${e.id}`)).body;
    expect(cur.lock.user).toBe('dupont');
    expect((await as(t.durand).put(`${tx()}/${e.id}`, { markdown: 'Texte du co-rédacteur', baseVersion: cur.version })).status).toBe(409);
    expect((await as(t.durand).del(`${tx()}/${e.id}/verrou`)).status).toBe(403);
    expect((await as(t.dupont).del(`${tx()}/${e.id}/verrou`)).status).toBe(204);
    expect((await as(t.durand).put(`${tx()}/${e.id}`, { markdown: 'Texte du co-rédacteur', baseVersion: cur.version })).status).toBe(200);
    await as(t.durand).put(`${tx()}/${e.id}`, { markdown: 'Le conseil est invité à approuver la subvention exceptionnelle.', baseVersion: cur.version + 1 });
  });

  it('les droits d\'édition sont ceux de l\'acte', async () => {
    const e = find('expose');
    expect((await as(t.leroy).get(`${tx()}/${e.id}`)).status).toBe(404); // autre service : le brouillon n'est pas visible
    await as(admin).post(`${base()}/roles`, { username: 'leroy', role: 'lecteur' }); // le lecteur voit tout, sans modifier
    expect((await as(t.leroy).get(`${tx()}/${e.id}`)).body.canEdit).toBe(false);
    expect((await as(t.leroy).put(`${tx()}/${e.id}`, { markdown: 'x', baseVersion: 1 })).status).toBe(403);
    expect((await as(t.leroy).put(`${tx()}/${e.id}/brouillon`, { markdown: 'x' })).status).toBe(403);
    expect((await as(t.petit).get(tx())).status).toBe(404);
  });
});

describe('suivi des modifications après l\'envoi (TRK-03 à TRK-10)', () => {
  let e;
  beforeAll(async () => {
    await env.c.textes.startTracking(acte.id, { username: 'dupont' });
    texts = (await as(t.dupont).get(tx())).body.items;
    e = find('expose');
  });

  it('le suivi démarre : la version envoyée devient la référence, sans coloration', async () => {
    expect(texts.every((x) => x.tracking)).toBe(true);
    const v = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    expect(v.spans.every((s) => s.type === 'text')).toBe(true);
    expect(v.changes).toEqual([]);
  });

  it('chaque auteur reçoit une couleur stable et ses modifications sont attribuées', async () => {
    let v = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    const r1 = await as(t.durand).put(`${tx()}/${e.id}`, { markdown: 'Le conseil municipal est invité à approuver la subvention exceptionnelle.', baseVersion: v.version });
    expect(r1.body.changes).toHaveLength(1);
    v = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    const r2 = await as(t.dupont).put(`${tx()}/${e.id}`, { markdown: 'Le conseil municipal est invité à approuver la subvention exceptionnelle de 500 euros.', baseVersion: v.version });
    expect(r2.body.changes[0].author).toBe('dupont');
    v = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    const colors = Object.fromEntries(v.authors.map((a) => [a.username, a.color]));
    expect(colors.durand).not.toBe(colors.dupont);
    expect(v.changes.map((c) => c.author).sort()).toEqual(['dupont', 'durand']);
    const municipal = v.spans.find((s) => s.type === 'insert' && s.text.includes('municipal'));
    expect(municipal).toMatchObject({ author: 'durand', color: colors.durand });
    expect(v.html).toContain('<ins');
    expect(v.html).toContain(colors.dupont);
    // une nouvelle modification de durand garde sa couleur
    const r3 = await as(t.durand).put(`${tx()}/${e.id}`, { markdown: 'Le conseil municipal est invité à approuver la subvention exceptionnelle de 500 euros.\nPièces jointes en annexe.', baseVersion: v.version });
    expect(r3.status).toBe(200);
    const v2 = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    expect(v2.authors.find((a) => a.username === 'durand').color).toBe(colors.durand);
  });

  it('propose la version propre, la vue avec suivi et « depuis ma dernière lecture »', async () => {
    const propre = (await as(t.dupont).get(`${tx()}/${e.id}?mode=propre`)).body;
    expect(propre.spans).toHaveLength(1);
    expect(propre.html).toBeUndefined();
    const cur = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    await as(t.leroy).post(`${base()}/actes/${acte.id}/duplicate`); // sans effet sur ce texte
    // dupont a vu la version courante : plus rien de récent
    await as(t.dupont).post(`${tx()}/${e.id}/vu`, { version: cur.version });
    await new Promise((r) => setTimeout(r, 20));
    const none = (await as(t.dupont).get(`${tx()}/${e.id}?mode=depuis`)).body;
    expect(none.changes).toEqual([]);
    expect(none.spans.every((s) => s.type === 'text')).toBe(true);
    // une modification après la lecture apparaît, les anciennes redeviennent neutres
    await as(t.durand).put(`${tx()}/${e.id}`, { markdown: cur.markdown + '\nAjout récent.', baseVersion: cur.version });
    const since = (await as(t.dupont).get(`${tx()}/${e.id}?mode=depuis`)).body;
    expect(since.changes).toHaveLength(1);
    expect(since.changes[0].author).toBe('durand');
    expect(since.spans.filter((s) => s.type === 'insert').map((s) => s.text).join('')).toContain('Ajout récent');
  });

  it('accepte ou rejette une modification, ou toutes (D30, TRK-10)', async () => {
    const v = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    const recent = v.changes.find((c) => c.inserted.includes('Ajout récent'));
    const rej = await as(t.dupont).post(`${tx()}/${e.id}/modifications`, { decision: 'reject', cids: [recent.cid] });
    expect(rej.body.markdown).not.toContain('Ajout récent');
    expect(rej.body.version).toBe(v.version + 1);
    const before = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    const acc = await as(t.dupont).post(`${tx()}/${e.id}/modifications`, { decision: 'accept', cids: [before.changes[0].cid] });
    expect(acc.body.changes.length).toBe(before.changes.length - 1);
    expect((await as(t.dupont).post(`${tx()}/${e.id}/modifications`, { decision: 'accept', cids: ['inconnu'] })).status).toBe(404);
    expect((await as(t.dupont).post(`${tx()}/${e.id}/modifications`, { decision: 'accept' })).status).toBe(400);
    const all = await as(t.dupont).post(`${tx()}/${e.id}/modifications`, { decision: 'accept', all: true });
    expect(all.body.changes).toEqual([]);
    expect(all.body.markdown).toContain('subvention exceptionnelle de 500 euros');
    const clean = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    expect(clean.spans.every((s) => s.type === 'text')).toBe(true);
  });

  it('conserve tout l\'historique et compare deux versions quelconques (TRK-05, TRK-08)', async () => {
    const versions = (await as(t.dupont).get(`${tx()}/${e.id}/versions`)).body.items;
    expect(versions.length).toBeGreaterThan(6);
    expect(new Set(versions.map((v) => v.version)).size).toBe(versions.length);
    expect(versions.map((v) => v.author)).toEqual(expect.arrayContaining(['dupont', 'durand']));
    const first = versions[versions.length - 1].version; const last = versions[0].version;
    const cmp = (await as(t.dupont).get(`${tx()}/${e.id}/comparaison?from=${first}&to=${last}`)).body;
    expect(cmp.changed).toBe(true);
    expect(cmp.parts.some((p) => p.added)).toBe(true);
    const v1 = (await as(t.dupont).get(`${tx()}/${e.id}/versions/${first}`)).body;
    expect(v1.markdown).not.toContain('municipal');
    expect((await as(t.dupont).get(`${tx()}/${e.id}/versions/9999`)).status).toBe(404);
  });

  it('répare des spans désynchronisés en rejouant les instantanés, sans perdre l\'attribution', async () => {
    await env.db.query("UPDATE tracked_texts SET spans = '[{\"id\":\"x\",\"text\":\"texte corrompu\",\"type\":\"text\"}]'::jsonb WHERE id = $1", [e.id]);
    const v = (await as(t.dupont).get(`${tx()}/${e.id}`)).body;
    const live = v.spans.filter((s) => s.type !== 'delete').map((s) => s.text).join('');
    expect(live).toBe(v.markdown);
    expect(v.markdown).not.toContain('corrompu');
    const r = await as(t.durand).put(`${tx()}/${e.id}`, { markdown: v.markdown + ' Fin.', baseVersion: v.version });
    expect(r.status).toBe(200);
  });
});

describe('complétude et copie', () => {
  it('la complétude vérifie les textes (exposé, visas, dispositif)', async () => {
    const types = (await as(admin).get(`${base()}/referentiels/type_acte`)).body.items;
    const a = (await as(t.dupont).post(`${base()}/actes`, { typeId: types[0].id, titre: 'Acte sans texte rédigé' })).body;
    const before = (await as(t.dupont).get(`${base()}/actes/${a.id}`)).body.completude;
    expect(before.missing.map((m) => m.code)).toEqual(expect.arrayContaining(['expose']));
    expect(before.missing.some((m) => m.label.startsWith('Vu et considérant'))).toBe(true);
    expect(before.missing.some((m) => m.label.startsWith('Délibéré'))).toBe(true);
    const list = (await as(t.dupont).get(`${base()}/actes/${a.id}/textes`)).body.items;
    for (const x of list) await as(t.dupont).put(`${base()}/actes/${a.id}/textes/${x.id}`, { markdown: 'Texte rédigé.', baseVersion: 1 });
    const after = (await as(t.dupont).get(`${base()}/actes/${a.id}`)).body.completude;
    expect(after.missing.map((m) => m.code)).not.toContain('expose');
    expect(after.missing.some((m) => m.label.startsWith('Vu et considérant'))).toBe(false);
  });

  it('dupliquer un acte copie ses textes (version propre)', async () => {
    const copy = (await as(t.dupont).post(`${base()}/actes/${acte.id}/duplicate`)).body;
    const src = (await as(t.dupont).get(tx())).body.items.find((x) => x.kind === 'expose');
    const srcText = (await as(t.dupont).get(`${tx()}/${src.id}`)).body.markdown;
    const list = (await as(t.dupont).get(`${base()}/actes/${copy.id}/textes`)).body.items;
    expect(list).toHaveLength(3);
    const ce = list.find((x) => x.kind === 'expose');
    const v = (await as(t.dupont).get(`${base()}/actes/${copy.id}/textes/${ce.id}`)).body;
    expect(v.markdown).toBe(srcText);
    expect(v.tracking).toBe(false);
  });
});

describe('aperçu PDF au gabarit (section 12)', () => {
  it('rend l\'exposé, une délibération et le dossier complet en PDF valides', async () => {
    const e = await preview(t.dupont, { cible: 'expose' });
    expect(e.status).toBe(200);
    expect(e.headers['content-type']).toBe('application/pdf');
    expect(e.headers['cache-control']).toContain('no-store');
    const doc = await pdfOf(e);
    expect(doc.getPageCount()).toBe(Number(e.headers['x-page-count']));
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 0);
    expect((await preview(t.dupont, { cible: 'deliberation' })).status).toBe(200);
    const d = await preview(t.dupont, { cible: 'dossier' });
    expect(d.status).toBe(200);
    expect((await pdfOf(d)).getPageCount()).toBeGreaterThanOrEqual(3); // sommaire + exposé + délibération
  });

  it('le mode « suivi » diffère du mode « propre » ; le brouillon non enregistré est utilisé sur demande', async () => {
    const e = find('expose');
    const propre = await preview(t.dupont, { cible: 'expose', mode: 'propre' });
    const suivi = await preview(t.dupont, { cible: 'expose', mode: 'suivi' });
    expect(Buffer.compare(propre.body, suivi.body)).not.toBe(0);
    await as(t.dupont).put(`${tx()}/${e.id}/brouillon`, { markdown: 'Texte du brouillon '.repeat(500) });
    const withDraft = await preview(t.dupont, { cible: 'expose', brouillon: true });
    expect(Number(withDraft.headers['x-page-count'])).toBeGreaterThan(Number(propre.headers['x-page-count']));
    expect(Number((await preview(t.dupont, { cible: 'expose', brouillon: false })).headers['x-page-count'])).toBe(Number(propre.headers['x-page-count']));
  });

  it('respecte la visibilité de l\'acte et exige un identifiant de délibération quand il y en a plusieurs', async () => {
    expect((await preview(t.petit, { cible: 'expose' })).status).toBe(404);
    await as(t.dupont).post(`${base()}/actes/${acte.id}/deliberations`, { titre: 'Seconde délibération' });
    expect((await preview(t.dupont, { cible: 'deliberation' })).status).toBe(400);
    const d2 = (await as(t.dupont).get(`${base()}/actes/${acte.id}/deliberations`)).body.items[1];
    expect((await preview(t.dupont, { cible: 'deliberation', deliberationId: d2.id })).status).toBe(200);
  });
});

describe('gabarits : marges, en-tête, fond de page', () => {
  it('fournit les gabarits par défaut, modifiables et versionnés (org_admin)', async () => {
    const list = (await as(admin).get(`${base()}/gabarits`)).body.items;
    expect(list.map((x) => x.docType)).toEqual(expect.arrayContaining(['expose', 'deliberation', 'dossier', 'garde', 'intercalaire', 'sommaire']));
    expect(list.find((x) => x.docType === 'deliberation')).toMatchObject({ personnalise: false, version: 0 });
    expect((await as(t.dupont).put(`${base()}/gabarits/deliberation`, { marges: { haut: 40 } })).status).toBe(403);
    const r = await as(admin).put(`${base()}/gabarits/deliberation`, { marges: { haut: 40, gauche: 30 }, police: { taille: 12 }, entete: [{ texte: 'ORGANISME : {organisme}', align: 'center', gras: true }], filigrane: 'BROUILLON' });
    expect(r.body).toMatchObject({ version: 1, personnalise: true });
    expect(r.body.cfg.marges).toEqual({ haut: 40, bas: 25, gauche: 30, droite: 22 });
    expect((await as(admin).put(`${base()}/gabarits/deliberation`, { police: { taille: 99 } })).status).toBe(400);
    expect((await as(admin).put(`${base()}/gabarits/inconnu`, {})).status).toBe(400);
    expect((await as(admin).put(`${base()}/gabarits/deliberation`, { police: { taille: 11 } })).body.version).toBe(2);
    const audit = (await as(admin).get(`/api/v1/audit?organismeId=${ville.id}&action=gabarit.update`)).body.items;
    expect(audit).toHaveLength(2);
  });

  it('dépose un PDF de fond A4 (première page / suivantes) et le refuse s\'il n\'est pas A4 ou pas PDF', async () => {
    const bg = await (async () => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]).drawText('LOGO DE LA VILLE', { x: 60, y: 780, size: 20 }); return Buffer.from(await d.save()); })();
    const put = (page, buf, name = 'fond.pdf') => env.http().post(`${base()}/gabarits/expose/fond/${page}`).set(bearer(admin)).attach('file', buf, name);
    const ok = await put('first', bg);
    expect(ok.status).toBe(200);
    expect(ok.body.bgFirstFileId).toBeTruthy();
    expect((await put('next', bg)).body.bgNextFileId).toBeTruthy();
    const letter = await (async () => { const d = await PDFDocument.create(); d.addPage([612, 792]); return Buffer.from(await d.save()); })();
    const bad = await put('first', letter);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/A4/);
    expect((await put('first', Buffer.from('pas un pdf'))).status).toBe(400);
    expect((await put('milieu', bg)).status).toBe(400);
    // le rendu utilise le fond : le PDF est plus gros qu'avec le gabarit nu
    const withBg = await preview(t.dupont, { cible: 'expose' });
    expect(withBg.status).toBe(200);
    await as(admin).del(`${base()}/gabarits/expose/fond/first`);
    await as(admin).del(`${base()}/gabarits/expose/fond/next`);
    const without = await preview(t.dupont, { cible: 'expose' });
    expect(withBg.body.length).toBeGreaterThan(without.body.length);
  });

  it('produit un PDF d\'étalonnage ; un gabarit est propre à son organisme', async () => {
    const s = await env.http().get(`${base()}/gabarits/deliberation/etalonnage`).set(bearer(admin)).buffer(true).parse(binary);
    expect(s.status).toBe(200);
    expect((await PDFDocument.load(s.body)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect((await as(t.dupont).get(`${base()}/gabarits/deliberation/etalonnage`)).status).toBe(403);
    const ccas = (await as(admin).post('/api/v1/organismes', { code: 'ccas', nom: 'CCAS', type: 'ccas' })).body;
    const own = (await as(admin).get(`/api/v1/organismes/${ccas.id}/gabarits`)).body.items.find((x) => x.docType === 'deliberation');
    expect(own).toMatchObject({ personnalise: false, version: 0 });
    expect(own.cfg.marges.haut).toBe(25);
  });

  it('sait joindre les annexes dans le dossier complet (sommaire paginé)', async () => {
    const pdf3 = await makePdf(3);
    await env.http().post(`${tx().replace('/textes', '/annexes')}`).set(bearer(t.dupont)).field('titre', 'Convention').attach('file', pdf3, 'c.pdf');
    const plain = await preview(t.dupont, { cible: 'dossier' });
    const pages = (await pdfOf(plain)).getPageCount();
    expect(pages).toBeGreaterThanOrEqual(6);
    expect(Number(plain.headers['x-page-count'])).toBe(pages);
  });
});
