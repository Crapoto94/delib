const fs = require('fs');
const path = require('path');
const { parseMatieres, compareCodes, classifLevels } = require('../../src/modules/referentiels/matieres');

const FILE = fs.readFileSync(path.resolve(__dirname, '../../seeds/matieres.txt'), 'utf8');

describe('nomenclature des matières (matieres.txt)', () => {
  const r = parseMatieres(FILE);

  it('reconnaît toutes les lignes, sur 4 niveaux, sans orphelin ni doublon', () => {
    expect(r.items.length).toBeGreaterThan(180);
    expect(Math.max(...r.items.map((i) => i.niveau))).toBe(4);
    expect(r.orphans).toEqual([]);
    expect(r.duplicates).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  it('lit les 9 domaines de niveau 1, y compris « 1.Commande Publique » sans espace', () => {
    const roots = r.items.filter((i) => i.niveau === 1);
    expect(roots.map((i) => i.code)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(roots[0].libelle).toBe('Commande Publique');
    expect(roots[6].libelle).toBe('Finances locales');
  });

  it('calcule le parent et le niveau depuis le code', () => {
    const it = r.items.find((i) => i.code === '1.1.2.1');
    expect(it).toMatchObject({ libelle: 'fournitures', parentCode: '1.1.2', niveau: 4 });
    expect(r.items.find((i) => i.code === '7.5')).toMatchObject({ libelle: 'Subventions', parentCode: '7', niveau: 2 });
  });

  it('trie numériquement par segment (1.2.1.2 avant 1.2.1.10), contrairement au fichier', () => {
    const codes = r.items.map((i) => i.code);
    expect(codes.indexOf('1.2.1.2')).toBeLessThan(codes.indexOf('1.2.1.10'));
    expect(codes.indexOf('7.2')).toBeLessThan(codes.indexOf('7.10'));
    expect(compareCodes('1.2.1.2', '1.2.1.10')).toBeLessThan(0);
    expect(compareCodes('1.1', '1.1.1')).toBeLessThan(0);
  });

  it('corrige et signale les fautes connues (« pourvoirs de police »)', () => {
    expect(r.corrections.some((c) => c.avant.includes('pourvoirs') && c.apres.includes('pouvoirs'))).toBe(true);
    expect(r.items.find((i) => i.code === '6').libelle).toBe('Libertés publiques et pouvoirs de police');
  });

  it('convertit un code en niveaux classif1..5 pour S²LOW', () => {
    expect(classifLevels('1.1.2.1')).toEqual([1, 1, 2, 1]);
    expect(classifLevels('7.5')).toEqual([7, 5]);
  });

  it('ignore les lignes vides et rejette un texte sans matière', () => {
    expect(parseMatieres('\n\n').items).toEqual([]);
    expect(parseMatieres('pas une matière').ignored).toEqual(['pas une matière']);
  });
});
