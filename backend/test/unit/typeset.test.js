const T = require('../../src/modules/render/typeset');
const { resolveConfig } = require('../../src/modules/render/defaults');

// mesure factice : 5 points par caractère (6 pour le gras) — les tests portent sur la logique de découpe, pas sur les polices
const measure = (token, size) => token.text.length * (token.bold ? 6 : 5) * (size / 10);
const cfg = (over = {}) => resolveConfig('deliberation', { entete: [], pied: { pagination: true }, ...over });
const run = (text, type = 'text', color) => ({ text, type, color });
const layout = (content, over, vars = {}) => T.layoutDocument({ content, cfg: cfg(over), vars, measure });
const linesOf = (l) => l.pages.flatMap((p) => p.ops.filter((o) => !o.rect));
const texts = (l) => linesOf(l).map((o) => o.text);

describe('mise en page : découpe et pagination', () => {
  it('découpe un paragraphe en lignes qui tiennent dans la largeur utile', () => {
    const long = Array.from({ length: 80 }, (_, i) => `mot${i}`).join(' ');
    const l = layout([{ type: 'runs', runs: [run(long)] }]);
    const ops = linesOf(l);
    const ys = [...new Set(ops.map((o) => Math.round(o.y)))];
    expect(ys.length).toBeGreaterThan(3);
    const { left, width } = l.geometry;
    expect(ops.every((o) => o.x >= left - 0.01 && o.x + o.width <= left + width + 0.5)).toBe(true);
    expect(texts(l).join(' ').replace(/\s+/g, ' ')).toContain('mot0');
    expect(texts(l).filter((t) => t.trim()).length).toBe(80);
  });

  it('change de page quand la page est pleine, sans perdre de mot', () => {
    const paras = Array.from({ length: 60 }, (_, i) => ({ type: 'runs', runs: [run(`Paragraphe numéro ${i} avec un texte assez long pour occuper de la place sur la page courante.`)] }));
    const l = layout(paras);
    expect(l.pages.length).toBeGreaterThan(1);
    const all = texts(l).join(' ');
    for (let i = 0; i < 60; i++) expect(all).toContain(`numéro`);
    expect(texts(l).filter((t) => t === 'Paragraphe').length).toBe(60);
    const { bottom } = l.geometry;
    expect(linesOf(l).every((o) => o.y >= bottom - 1)).toBe(true);
  });

  it('reconnaît titres, puces et listes numérotées et retire le préfixe Markdown', () => {
    const l = layout([{ type: 'runs', runs: [run('# Titre principal\n- premier point\n- second point\n1. étape une\nTexte simple')] }]);
    const t = texts(l);
    expect(t).toContain('Titre');
    expect(t.join(' ')).not.toContain('#');
    expect(t.filter((x) => x === '-').length).toBe(2); // marqueurs des puces
    expect(t).toContain('1.');
    const heading = linesOf(l).find((o) => o.text === 'Titre');
    const plain = linesOf(l).find((o) => o.text === 'simple');
    expect(heading.size).toBeGreaterThan(plain.size);
    expect(heading.bold).toBe(true);
    const bullet = linesOf(l).find((o) => o.text === 'premier');
    expect(bullet.x).toBeGreaterThan(l.geometry.left + 10); // retrait des listes
  });

  it('applique le gras (**) sans laisser les astérisques', () => {
    const l = layout([{ type: 'runs', runs: [run('Le **maire** signe.')] }]);
    expect(texts(l).join(' ')).not.toContain('*');
    expect(linesOf(l).find((o) => o.text === 'maire').bold).toBe(true);
    expect(linesOf(l).find((o) => o.text === 'signe.').bold).toBe(false);
  });

  it('conserve le style du suivi des modifications (ajout / suppression, couleur de l\'auteur)', () => {
    const l = layout([{ type: 'runs', runs: [run('Le conseil '), run('municipal ', 'insert', '#2563EB'), run('ancien ', 'delete', '#059669'), run('approuve.')] }]);
    const ops = linesOf(l);
    expect(ops.find((o) => o.text === 'municipal')).toMatchObject({ type: 'insert', color: '#2563EB' });
    expect(ops.find((o) => o.text === 'ancien')).toMatchObject({ type: 'delete', color: '#059669' });
    expect(ops.find((o) => o.text === 'approuve.').type).toBe('text');
  });

  it("n'isole jamais un titre en bas de page", () => {
    const filler = Array.from({ length: 44 }, () => ({ type: 'runs', runs: [run('Ligne de remplissage.')] }));
    const l = layout([...filler, { type: 'runs', runs: [run('# Titre à ne pas orpheliner\nSuite du texte.')] }]);
    const lastOfPage1 = l.pages[0].ops.filter((o) => !o.rect).map((o) => o.text);
    if (l.pages.length > 1) expect(lastOfPage1.join(' ')).not.toContain('orpheliner');
  });

  it('justifie les lignes pleines (les espaces s\'étirent) mais pas la dernière', () => {
    const long = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ');
    const justified = layout([{ type: 'runs', runs: [run(long)] }], { police: { justifie: true } });
    const ragged = layout([{ type: 'runs', runs: [run(long)] }], { police: { justifie: false } });
    const right = (l) => { const ys = [...new Set(linesOf(l).map((o) => o.y))]; const first = linesOf(l).filter((o) => o.y === ys[0]); return Math.max(...first.map((o) => o.x + o.width)); };
    const { left, width } = justified.geometry;
    expect(right(justified)).toBeGreaterThan(right(ragged) - 0.01);
    expect(right(justified)).toBeCloseTo(left + width, 0);
  });

  it('remplace les variables du gabarit dans les titres et le texte', () => {
    const l = layout([{ type: 'title', text: 'OBJET : {rubrique} — {titre}', size: 12 }, { type: 'runs', runs: [run('Séance du {date_seance}.')] }], {}, { rubrique: 'FINANCES', titre: 'Budget', date_seance: '1 JANVIER' });
    const all = texts(l).join(' ');
    expect(all).toContain('FINANCES');
    expect(all).toContain('Budget');
    expect(all).toContain('JANVIER');
    expect(all).not.toContain('{');
  });

  it('dessine un cadre autour d\'un titre encadré et centre les titres centrés', () => {
    const l = layout([{ type: 'title', text: 'EXTRAIT DU REGISTRE', boxed: true, align: 'center' }]);
    expect(l.pages[0].ops.some((o) => o.rect)).toBe(true);
    const op = linesOf(l)[0];
    const middle = l.geometry.left + l.geometry.width / 2;
    expect(op.x + op.width / 2).toBeLessThan(middle + 60);
  });

  it('remplace les caractères hors WinAnsi par un équivalent sûr', () => {
    const font = { encodeText: (c) => { if (c.charCodeAt(0) > 255 && c !== '€' && c !== 'œ' && c !== '«') throw new Error('non encodable'); } };
    expect(T.winAnsi(font, 'a b c')).toBe('a b c');
    expect(T.winAnsi(font, 'x ≥ 3')).toBe('x >= 3');
    expect(T.winAnsi(font, '日')).toBe('?');
  });

  it('résout la configuration par défaut d\'un gabarit et la surcharge par celle de l\'organisme', () => {
    const c = resolveConfig('deliberation', { marges: { haut: 40 }, police: { taille: 12 } });
    expect(c.marges).toEqual({ haut: 40, bas: 25, gauche: 22, droite: 22 });
    expect(c.police).toMatchObject({ taille: 12, justifie: true });
    expect(c.entete.some((b) => /REGISTRE DES DÉLIBÉRATIONS/.test(b.texte))).toBe(true);
    expect(resolveConfig('deliberation', { entete: [] }).entete).toEqual([]);
  });
});
