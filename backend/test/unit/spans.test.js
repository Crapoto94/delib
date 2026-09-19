const S = require('../../src/modules/textes/spans');

const A = { author: 'alice', name: 'Alice', color: '#2563EB' };
const B = { author: 'bruno', name: 'Bruno', color: '#059669' };
const C = { author: 'claire', name: 'Claire', color: '#7C3AED' };
const edit = (spans, oldT, newT, who, at) => S.applyDiffToSpans(spans, oldT, newT, who, { at });
const byType = (spans, type) => spans.filter((s) => s.type === type).map((s) => s.text).join('|');

describe('suivi des modifications : spans', () => {
  it('marque une insertion et une suppression avec leur auteur, leur couleur et leur date', () => {
    const t0 = 'Le conseil approuve la subvention.';
    const t1 = 'Le conseil municipal approuve la subvention de 500 euros.';
    const spans = edit(S.initialSpans(t0), t0, t1, A, '2026-01-01T10:00:00.000Z');
    expect(S.liveText(spans)).toBe(t1);
    const ins = spans.filter((s) => s.type === 'insert');
    expect(ins.length).toBeGreaterThan(0);
    expect(ins.every((s) => s.author === 'alice' && s.color === '#2563EB' && s.at === '2026-01-01T10:00:00.000Z' && s.cid)).toBe(true);
    expect(byType(spans, 'insert')).toContain('municipal');

    const t2 = 'Le conseil municipal approuve la subvention de 500 euros au club.';
    const t3 = 'Le conseil approuve la subvention de 500 euros au club.';
    const s2 = edit(edit(S.initialSpans(t0), t0, t1, A), t1, t2, A);
    const s3 = edit(s2, t2, t3, B, '2026-01-02T10:00:00.000Z');
    expect(S.liveText(s3)).toBe(t3);
    const del = s3.filter((s) => s.type === 'delete');
    expect(del.map((s) => s.text).join('')).toContain('municipal');
    expect(del.every((s) => s.author === 'bruno')).toBe(true);
  });

  it("conserve l'attribution des amendements précédents quand un autre auteur modifie ailleurs", () => {
    const t0 = 'Article 1 : approuver le budget. Article 2 : autoriser le maire.';
    const t1 = 'Article 1 : approuver le budget primitif. Article 2 : autoriser le maire.';
    const t2 = 'Article 1 : approuver le budget primitif. Article 2 : autoriser Monsieur le maire à signer.';
    let spans = edit(S.initialSpans(t0), t0, t1, A);
    spans = edit(spans, t1, t2, B);
    expect(S.liveText(spans)).toBe(t2);
    expect(byType(spans, 'insert')).toContain('primitif');
    const primitif = spans.find((s) => s.type === 'insert' && s.text.includes('primitif'));
    expect(primitif.author).toBe('alice');
    const monsieur = spans.find((s) => s.type === 'insert' && s.text.includes('Monsieur'));
    expect(monsieur.author).toBe('bruno');
    expect(new Set(spans.filter((s) => s.type !== 'text').map((s) => s.cid)).size).toBe(2);
  });

  it("l'auteur qui retire l'ajout d'un autre le barre à SA couleur, sans effacer l'historique", () => {
    const t0 = 'Le maire signe la convention.';
    const t1 = 'Le maire signe la convention avec l\'association.';
    const t2 = 'Le maire signe la convention.';
    let spans = edit(S.initialSpans(t0), t0, t1, A);
    spans = edit(spans, t1, t2, B);
    expect(S.liveText(spans)).toBe(t2);
    const del = spans.filter((s) => s.type === 'delete');
    expect(del.map((s) => s.text).join('')).toContain('association');
    expect(del.every((s) => s.author === 'bruno')).toBe(true);
  });

  it("l'algorithme est stable : aucun caractère perdu, texte vivant exact après une série d'éditions aléatoires", () => {
    const words = 'le conseil municipal approuve la subvention exceptionnelle attribuée à l\'association sportive pour l\'année deux mille vingt-six'.split(' ');
    let seed = 42;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let text = words.slice(0, 8).join(' ') + '.';
    let spans = S.initialSpans(text);
    const authors = [A, B, C];
    for (let i = 0; i < 60; i++) {
      const w = text.replace('.', '').split(' ');
      const op = rnd(3);
      const pos = rnd(w.length);
      if (op === 0) w.splice(pos, 0, words[rnd(words.length)]);
      else if (op === 1 && w.length > 3) w.splice(pos, 1);
      else w[pos] = words[rnd(words.length)];
      const next = w.join(' ') + '.';
      spans = edit(spans, text, next, authors[rnd(3)]);
      text = next;
      expect(S.liveText(spans), `édition ${i}`).toBe(text);
    }
    expect(S.isConsistent(spans, text)).toBe(true);
  });

  it('accepter une modification la rend neutre ; rejeter une insertion la retire ; rejeter une suppression la restaure', () => {
    const t0 = 'Le maire signe la convention.';
    const t1 = 'Le maire signe la nouvelle convention.'; // insertion
    const t2 = 'Le maire signe nouvelle convention.'; // suppression de « la »
    let spans = edit(S.initialSpans(t0), t0, t1, A);
    spans = edit(spans, t1, t2, B);
    const changes = S.listChanges(spans);
    expect(changes).toHaveLength(2);
    const insC = changes.find((c) => c.inserted);
    const delC = changes.find((c) => c.deleted);

    const rejIns = S.resolveChanges(spans, [insC.cid], 'reject');
    expect(S.liveText(rejIns)).not.toContain('nouvelle');
    const rejDel = S.resolveChanges(spans, [delC.cid], 'reject');
    expect(S.liveText(rejDel)).toContain('la');
    expect(S.liveText(rejDel)).toBe('Le maire signe la nouvelle convention.');
    const accIns = S.resolveChanges(spans, [insC.cid], 'accept');
    expect(S.liveText(accIns)).toBe(t2);
    expect(S.listChanges(accIns)).toHaveLength(1);

    const all = S.acceptAll(spans);
    expect(S.liveText(all)).toBe(t2);
    expect(all.every((s) => s.type === 'text')).toBe(true);
    expect(all).toHaveLength(1);
  });

  it('la vue « depuis » ne garde la couleur que des modifications récentes', () => {
    const t0 = 'Premier texte.';
    const t1 = 'Premier texte ancien.';
    const t2 = 'Premier texte ancien récent.';
    let spans = edit(S.initialSpans(t0), t0, t1, A, '2026-01-01T00:00:00.000Z');
    spans = edit(spans, t1, t2, B, '2026-03-01T00:00:00.000Z');
    const v = S.sinceView(spans, '2026-02-01T00:00:00.000Z');
    expect(S.liveText(v)).toBe(t2);
    expect(v.filter((s) => s.type === 'insert').map((s) => s.text).join('')).toContain('récent');
    expect(v.filter((s) => s.type === 'insert').every((s) => s.author === 'bruno')).toBe(true);
    expect(S.sinceView(spans, '2027-01-01T00:00:00.000Z').every((s) => s.type === 'text')).toBe(true);
  });

  it("reconstruit les spans en rejouant les instantanés, sans jamais perdre l'attribution", () => {
    const versions = [
      { markdown: 'Texte de départ.', author: 'alice', tracking: false, created_at: '2026-01-01T00:00:00Z' },
      { markdown: 'Texte de départ modifié.', author: 'alice', name: 'Alice', color: '#2563EB', tracking: true, created_at: '2026-01-02T00:00:00Z', cid: 'c1' },
      { markdown: 'Texte modifié.', author: 'bruno', name: 'Bruno', color: '#059669', tracking: true, created_at: '2026-01-03T00:00:00Z', cid: 'c2' },
    ];
    const spans = S.rebuildSpans(versions);
    expect(S.liveText(spans)).toBe('Texte modifié.');
    expect(spans.some((s) => s.type === 'delete' && s.author === 'bruno' && s.cid === 'c2')).toBe(true);
    expect(spans.some((s) => s.type === 'insert' && s.author === 'alice' && s.cid === 'c1')).toBe(true);
  });

  it('échappe le HTML dans le rendu annoté', () => {
    const spans = [{ id: '1', text: '<script>alert(1)</script> & ', type: 'text' }, { id: '2', text: '<b>x</b>', type: 'insert', color: '#2563EB', cid: 'c' }];
    const html = S.annotatedMarkdown(spans);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('data-cid="c"');
  });

  it('normalise fins de ligne, espaces de fin et espaces extérieurs', () => {
    expect(S.normalize('  a  \r\nb \r\n\r\nc  ')).toBe('a\nb\n\nc');
    expect(S.normalize(null)).toBe('');
  });

  it('tient la charge sur un long texte (5 000 mots) en moins d\'une demi-seconde', () => {
    const base = Array.from({ length: 5000 }, (_, i) => `mot${i}`).join(' ');
    const edited = base.replace('mot2500', 'modifié2500').replace('mot4000 ', '');
    const t = Date.now();
    const spans = edit(S.initialSpans(base), base, edited, A);
    expect(Date.now() - t).toBeLessThan(500);
    expect(S.liveText(spans)).toBe(edited);
  });
});
