/**
 * Noms de fichiers en multipart : multer décode le nom en latin1 alors que le navigateur l'envoie en UTF-8. On vérifie
 * ici que la réparation est juste — et surtout qu'elle ne touche PAS un nom déjà correct (c'est tout le risque).
 */
const { reparerNom } = require('../../src/http/middleware/noms-fichiers');

describe('noms de fichiers reçus (latin1 → UTF-8)', () => {
  it('rétablit un nom accentué arrivé en mojibake', () => {
    expect(reparerNom('ExposÃ© des motifs.docx')).toBe('Exposé des motifs.docx');
    expect(reparerNom('DÃ©cision nÂ°12.pdf')).toBe('Décision n°12.pdf');
  });

  it('laisse intact un nom déjà correct', () => {
    expect(reparerNom('Exposé des motifs.docx')).toBe('Exposé des motifs.docx');
    expect(reparerNom('Décision n°12.docx')).toBe('Décision n°12.docx');
    expect(reparerNom('rapport-annuel.pdf')).toBe('rapport-annuel.pdf');
    expect(reparerNom('note — suite.docx')).toBe('note — suite.docx');
  });

  it('ne produit jamais de caractère de remplacement', () => {
    for (const nom of ['ExposÃ©.docx', 'Exposé.docx', 'a b c.pdf', '']) expect(reparerNom(nom)).not.toContain('\ufffd');
  });
});
