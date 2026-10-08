const { reparerEspaces, paragraphesVu, referencesDuTexte, creerCumul, entreeBibliotheque } = require('../../src/modules/ai/visas-historique');
const { normaliserCle } = require('../../src/modules/ai/visas.service');

// Texte aplati tel que l'extraction d'un PDF d'archive le donne : « vu » en minuscules, tampon de la préfecture, considérants, décision.
const TEXTE = `OBJET : DISPOSITIONS ORGANIQUES Accusé de réception en préfecture 094-219400413-20180704-DEL-DE LE CONSEIL,
  vu le code général des collectivités territoriales, notamment ses articles L.2121-21,  L.2121-29 et L.2121-33,
  vu le procès-verbal d’élection des conseillers municipaux du 22 mars 2026,
  vu la loi n° 2015-991 du 7 août 2015 portant nouvelle organisation territoriale de la République,
  considérant que l’association réunit, au vu de ses statuts, les conservatoires du département,
  considérant que la Ville porte un intérêt particulier, DECIDE : Article 1 : de désigner ; vu l'article L.9999-1 cité dans le dispositif`;

describe('visas de l\'historique : extraction', () => {
  it('découpe les « vu » en minuscules, sans couper « au vu de » ni retenir le dispositif', () => {
    const v = paragraphesVu(TEXTE);
    expect(v).toHaveLength(3);
    expect(v[0]).toMatch(/^vu le code général des collectivités territoriales/);
    expect(v.join(' ')).not.toMatch(/considérant|DECIDE|9999/i);
  });
  it('en tire les références de la bibliothèque : code, articles, loi — pas de date seule ni d\'article sans code', () => {
    const cles = referencesDuTexte(TEXTE).map((r) => r.cle);
    expect(cles).toEqual(expect.arrayContaining(['cgct', 'cgct:L2121-21', 'cgct:L2121-29', 'cgct:L2121-33', 'loi:2015-991']));
    expect(cles.filter((c) => c.includes(':du:') || c.startsWith('article:'))).toEqual([]);
    cles.forEach((c) => expect(() => normaliserCle(c)).not.toThrow());                      // chaque clé est valide pour la bibliothèque
  });
  it("recolle les mots coupés par l’extraction PDF (vocabulaire juridique seulement)", () => {
    const refs = referencesDuTexte('LE CONSEIL, vu le code général des collectivi tés territoriales, notamment ses article s L.2121-29 et L.2122-21, considérant que');
    expect(refs.map((r) => r.cle)).toEqual(expect.arrayContaining(['cgct', 'cgct:L2121-29', 'cgct:L2122-21']));
    expect(reparerEspaces('au vu de ce qui pr écède et de la liste des élus')).toBe('au vu de ce qui pr écède et de la liste des élus');   // pas de recollage hasardeux
  });
  it('un texte sans visa ne produit rien', () => { expect(referencesDuTexte('Le conseil décide : article 1.')).toEqual([]); expect(referencesDuTexte('')).toEqual([]); });
});

describe('visas de l\'historique : regroupement et entrées', () => {
  const cumul = () => {
    const c = creerCumul();
    c.ajouter(referencesDuTexte(TEXTE), 2019);
    c.ajouter(referencesDuTexte('vu le code général des collectivités territoriales, notamment son article L.2121-29, vu le code de la commande publique,'), 2022);
    c.ajouter(referencesDuTexte('vu la loi n° 2015-991 du 7 août 2015,'), 2024);
    return c;
  };
  it('compte les délibérations (une fois par délibération) et borne la période', () => {
    const c = cumul().candidats({ min: 2 });
    const cgct = c.find((e) => e.cle === 'cgct'); const art = c.find((e) => e.cle === 'cgct:L2121-29');
    expect(cgct).toMatchObject({ delibs: 2, premiere: 2019, derniere: 2022 });
    expect(art.delibs).toBe(2);
    expect(c.find((e) => e.cle === 'loi:2015-991')).toMatchObject({ delibs: 2, derniere: 2024 });
    expect(c.find((e) => e.cle === 'cgct:L2121-21')).toBeUndefined();                       // citée une seule fois : sous le seuil
    expect(c[0].delibs).toBeGreaterThanOrEqual(c[c.length - 1].delibs);                      // les plus citées d'abord
  });
  it('produit des entrées de bibliothèque jamais vérifiées, avec la période et un avertissement', () => {
    const e = entreeBibliotheque(cumul().candidats({ min: 2 }).find((x) => x.cle === 'cgct:L2121-29'));
    expect(e).toMatchObject({ cle: 'cgct:L2121-29', type: 'code', code: 'cgct', article: 'L2121-29', statut: 'en_vigueur', source: 'Historique des délibérations (AIRS)' });
    expect(e.intitule).toMatch(/^Article L\. 2121-29 du code général des collectivités territoriales/);
    expect(e.note).toMatch(/2 délibérations de 2019 à 2022.*Jamais vérifiée/);
    expect(e).not.toHaveProperty('verifieLe');
  });
});
