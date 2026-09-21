const { listeParRole, civElu } = require('../../src/modules/render/render.service');

describe('mise en forme des listes de présents (par rôle)', () => {
  const m = (nom, prenom, role) => ({ nom, prenom, role });

  it('groupe Maire / adjoints / conseillers, en lignes séparées', () => {
    const out = listeParRole([
      m('BOUYSSOU', 'Philippe', 'Maire'),
      m('MARCHAND', 'Xavier', 'Adjoint'),
      m('BERNARD', 'Méhadée', 'Adjoint'),
      m('PETER', 'Sandrine', 'Conseiller municipal'),
      m('AUBRY', 'Jean', 'Conseiller municipal'),
    ]);
    expect(out).toBe(
      'M. BOUYSSOU, Maire\n\n'
      + 'M. MARCHAND, Mme BERNARD, adjoints au Maire\n\n'
      + 'Mme PETER, M. AUBRY, conseillers municipaux.',
    );
  });

  it('déduit la civilité du prénom (Mme / M.)', () => {
    expect(civElu(m('DIARRA', 'Fenda', 'Adjoint'))).toBe('Mme DIARRA');
    expect(civElu(m('CLAUDON', 'Jean-François', 'Adjoint'))).toBe('M. CLAUDON');
    expect(civElu(m('SPIRO', 'Guillaume', 'Adjoint'))).toBe('M. SPIRO');
    expect(civElu(m('OUDART', 'Fabienne', 'Adjoint'))).toBe('Mme OUDART');
  });
});
