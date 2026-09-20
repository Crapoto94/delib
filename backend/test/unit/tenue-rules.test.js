const { droits, decompte, resultat, quorum, voisin } = require('../../src/modules/seances/tenue.rules');

const pres = (o) => new Map(Object.entries(o).map(([id, enSalle]) => [Number(id), { statut: enSalle ? 'present' : 'absent', enSalle }]));

describe('droit de vote (LIVE-08)', () => {
  it('un élu en salle vote ; un absent ou un sorti ne prend pas part au vote', () => {
    const d = droits([1, 2, 3], pres({ 1: true, 2: false }), []);
    expect(d.get(1)).toMatchObject({ droit: 'propre' });
    expect(d.get(2)).toMatchObject({ droit: 'aucun' });
    expect(d.get(3)).toMatchObject({ droit: 'aucun' }); // jamais pointé : absent
  });
  it('un mandant absent vote par son mandataire s\'il est en salle ; sinon le pouvoir tombe (ni pour lui ni pour son mandant)', () => {
    const procs = [{ mandant: 2, mandataire: 1 }];
    expect(droits([1, 2], pres({ 1: true, 2: false }), procs).get(2)).toEqual({ droit: 'pouvoir', mandataire: 1 });
    expect(droits([1, 2], pres({ 1: false, 2: false }), procs).get(2)).toEqual({ droit: 'aucun', mandataire: null });
    expect(droits([1, 2], pres({ 1: false, 2: false }), procs).get(1).droit).toBe('aucun');
  });
  it('un mandant qui arrive en salle vote lui-même : son pouvoir est sans effet', () => {
    expect(droits([1, 2], pres({ 1: true, 2: true }), [{ mandant: 2, mandataire: 1 }]).get(2)).toEqual({ droit: 'propre', mandataire: null });
  });
});

describe('décompte et résultat (VOT-03, VOT-04)', () => {
  const ids = [1, 2, 3, 4, 5];
  const votes = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  it('compte les voix, les absents et signale les élus qui doivent encore voter', () => {
    const d = droits(ids, pres({ 1: true, 2: true, 3: true, 4: true, 5: false }), []);
    const t = decompte(ids, d, votes({ 1: 'pour', 2: 'pour', 3: 'contre', 4: 'nppv' }));
    expect(t).toMatchObject({ pour: 2, contre: 1, abstention: 0, nppv: 1, absents: 1, votants: 3, exprimes: 3, manquants: [] });
    expect(decompte(ids, d, votes({ 1: 'pour' })).manquants).toEqual([2, 3, 4]);
  });
  it('unanimité, majorité, rejet, partage des voix et voix prépondérante du président', () => {
    const t = (pour, contre, abstention = 0) => ({ pour, contre, abstention, nppv: 0 });
    expect(resultat(t(5, 0))).toEqual({ resultat: 'adopte_unanimite' });
    expect(resultat(t(5, 0, 1))).toEqual({ resultat: 'adopte_majorite' });
    expect(resultat(t(3, 2))).toEqual({ resultat: 'adopte_majorite' });
    expect(resultat(t(2, 3))).toEqual({ resultat: 'rejete' });
    expect(resultat(t(2, 2))).toEqual({ partage: true });
    expect(resultat(t(2, 2), 'pour')).toEqual({ resultat: 'adopte_preponderante' });
    expect(resultat(t(2, 2), 'contre')).toEqual({ resultat: 'rejete_preponderante' });
    expect(resultat(t(0, 0, 4))).toEqual({ resultat: 'rejete' }); // que des abstentions : aucun suffrage exprimé
  });
  it('quorum : majorité des membres en exercice, seuls comptent les élus en salle', () => {
    expect(quorum(33, 16)).toMatchObject({ requis: 17, atteint: false });
    expect(quorum(33, 17)).toMatchObject({ requis: 17, atteint: true });
    expect(quorum(0, 0).atteint).toBe(false);
  });
});

describe('navigation dans l\'ordre du jour (LIVE-05)', () => {
  const pts = [
    { id: 1, kind: 'chapitre', statut: 'a_traiter', etat: 'a_traiter' }, { id: 2, kind: 'deliberation', statut: 'a_traiter', etat: 'traite' },
    { id: 3, kind: 'deliberation', statut: 'retire', etat: 'a_traiter' }, { id: 4, kind: 'libre', statut: 'a_traiter', etat: 'a_traiter' }, { id: 5, kind: 'deliberation', statut: 'a_traiter', etat: 'a_traiter' },
  ];
  it('saute les chapitres, les points retirés et ceux déjà clos', () => {
    expect(voisin(pts, null, 'suivant').id).toBe(4);
    expect(voisin(pts, 4, 'suivant').id).toBe(5);
    expect(voisin(pts, 5, 'suivant')).toBeNull();
    expect(voisin(pts, 4, 'precedent').id).toBe(2); // on peut revenir sur un point clos pour le revoir
    expect(voisin(pts, 2, 'precedent')).toBeNull();
  });
});
