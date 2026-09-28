const { markdownVersDocx, docxVersMarkdown } = require('../../src/modules/render/docx.service');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const aller = async (md) => docxVersMarkdown(await markdownVersDocx(md));

describe('aller-retour Markdown ⇄ .docx (édition externe d’un texte suivi)', () => {
  it('conserve paragraphes, gras et « Article N »', async () => {
    const md = '**Article 1** : une subvention est attribuée.\n\nArticle 2 : elle sera versée en une fois.';
    expect(await aller(md)).toContain('**Article 1** : une subvention est attribuée.');
    expect(await aller(md)).toContain('Article 2 : elle sera versée en une fois.');
  });

  it('conserve les sauts de ligne internes à un paragraphe', async () => {
    expect(await aller('Vu le code ;\nConsidérant que…')).toBe('Vu le code ;\nConsidérant que…');
  });

  it('conserve l’italique', async () => {
    expect(await aller('Un mot *important* ici.')).toBe('Un mot *important* ici.');
  });

  it('conserve l’alignement de paragraphe', async () => {
    const buf = await markdownVersDocx('{center} Titre centré');
    const JSZip = require('jszip');
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('text');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(await docxVersMarkdown(buf)).toBe('{center} Titre centré');
  });

  it('conserve les listes à puces et numérotées', async () => {
    expect(await aller('- premier\n- second')).toBe('- premier\n- second');
    expect(await aller('1. premier\n2. second')).toBe('1. premier\n2. second');
  });

  it('conserve un tableau Markdown', async () => {
    const md = '| Nom | Montant |\n| --- | --- |\n| Sport | 1 500 € |';
    expect(await aller(md)).toBe(md);
  });

  it('conserve une image (data-URL) et sa largeur', async () => {
    const sortie = await aller(`![logo](${PNG}#vd:w=200)`);
    expect(sortie).toMatch(/^!\[logo\]\(data:image\/png;base64,/);
    expect(sortie).toContain('w=200');
  });

  it('refuse un fichier qui n’est pas un .docx', async () => {
    await expect(docxVersMarkdown(Buffer.from('pas un zip'))).rejects.toThrow();
  });
});
