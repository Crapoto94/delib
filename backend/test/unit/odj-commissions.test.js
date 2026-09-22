const { createOdj, odjContent } = require('../../src/modules/seances/odj.service');

// `groupesParCommission` est pur : aucune dépendance n'est utilisée.
const odj = createOdj({});
const ligne = (id, principale) => ({ id, commissionPrincipale: principale ? { id: principale, nom: `C${principale}` } : null });

describe('rupture par commission de l\'ordre du jour (commission principale = première choisie à la rédaction)', () => {
  it('coupe une section à chaque changement de commission principale, dans l\'ordre reçu (ordre de passage respecté)', () => {
    const groups = odj.groupesParCommission([ligne(1, 10), ligne(2, 10), ligne(3, 20), ligne(4, null), ligne(5, 10)]);
    expect(groups.map((g) => g.commission?.id ?? null)).toEqual([10, 20, null, 10]);
    expect(groups.map((g) => g.items.map((x) => x.id))).toEqual([[1, 2], [3], [4], [5]]);
  });

  it('une ligne sans commission principale explicite retombe sur sa première commission', () => {
    const groups = odj.groupesParCommission([{ id: 1, commissions: [{ id: 7, nom: 'La Ville qui débat' }] }, { id: 2, commissions: [{ id: 7, nom: 'La Ville qui débat' }] }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].commission).toMatchObject({ id: 7, nom: 'La Ville qui débat' });
  });

  it('un dossier hors commission forme sa propre section', () => {
    const groups = odj.groupesParCommission([ligne(1, null), ligne(2, null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].commission).toBeNull();
    expect(groups[0].items).toHaveLength(2);
  });
});

describe('composition d\'un ordre du jour (odjContent)', () => {
  it('insère un titre de section par commission et affiche les commissions de chaque dossier', () => {
    const content = odjContent({ organisme: 'Ville', sousTitre: 'Séance — 18h30', items: [
      { numero: '1', titre: 'A', kind: 'deliberation', rapporteur: 'X', commissionPrincipale: { id: 1, nom: 'La Ville qui débat' }, commissions: [{ nom: 'La Ville qui débat', principale: true }] },
      { numero: '2', titre: 'B', kind: 'deliberation', commissionPrincipale: { id: 2, nom: 'La Ville en transition' }, commissions: [{ nom: 'La Ville en transition', principale: true }] },
    ] });
    const titres = content.filter((b) => b.type === 'title').map((b) => b.text);
    expect(titres).toContain('LA VILLE QUI DÉBAT');
    expect(titres).toContain('LA VILLE EN TRANSITION');
    const texte = content.find((b) => b.type === 'runs').runs[0].text;
    expect(texte).toContain('Commission(s) concernée(s) : La Ville qui débat');
  });
});
