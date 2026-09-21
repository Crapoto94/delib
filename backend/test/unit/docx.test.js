const JSZip = require('jszip');
const { remplir, markdownToText, markdownToRich } = require('../../src/modules/render/docx.service');

const creer = async (xml) => {
  const zip = new JSZip();
  zip.file('word/document.xml', xml);
  zip.file('[Content_Types].xml', '<Types/>');
  return zip.generateAsync({ type: 'nodebuffer' });
};
const lire = async (buf) => { const z = await JSZip.loadAsync(buf); return z.file('word/document.xml').async('text'); };
const doc = (corps) => `<?xml version="1.0"?><w:document><w:body>${corps}</w:body></w:document>`;
const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

describe('fusion d’un modèle Word (.docx)', () => {
  it('remplace les variables et échappe le XML', async () => {
    const src = await creer(doc(para('{titre}')));
    const out = await lire(await remplir(src, { '{titre}': 'Subvention <A> & B' }));
    expect(out).toContain('Subvention &lt;A&gt; &amp; B');
  });

  it('recolle une variable fragmentée par Word', async () => {
    const frag = doc('<w:p><w:r><w:t>{ti</w:t></w:r><w:r><w:t>tre}</w:t></w:r></w:p>');
    const out = await lire(await remplir(await creer(frag), { '{titre}': 'Ma délibération' }));
    expect(out).toContain('Ma délibération');
  });

  it('conserve ou retire un bloc conditionnel selon la valeur', async () => {
    const src = await creer(doc(para('{IF visas|VU : {visas}}')));
    const plein = await lire(await remplir(src, { '{visas}': 'Vu le code ;' }));
    expect(plein).toContain('VU : Vu le code ;');
    const vide = await lire(await remplir(src, { '{visas}': '  ' }));
    expect(vide).not.toContain('VU :');
  });

  it('convertit les sauts de ligne en <w:br/> (même paragraphe)', async () => {
    const src = await creer(doc(para('{dispositif}')));
    const out = await lire(await remplir(src, { '{dispositif}': 'Article 1\nArticle 2' }));
    expect(out).toContain('Article 1</w:t><w:br/><w:t xml:space="preserve">Article 2');
  });

  it('refuse un fichier qui n’est pas un .docx', async () => {
    await expect(remplir(Buffer.from('pas un zip'), {})).rejects.toThrow();
  });

  it('markdownToText retire la syntaxe et garde les sauts de ligne', () => {
    expect(markdownToText('# Titre\n**gras** et *italique*\n- point')).toBe('Titre\ngras et italique\n• point');
  });

  it('insère un tableau Markdown en vraie table Word', async () => {
    const src = await creer(doc(para('{expose}')));
    const out = await lire(await remplir(src, { '{expose}': 'Avant.\n\n| Nom | Montant |\n| --- | --- |\n| Sport | 1 500 € |' }));
    expect(out).toContain('<w:tbl>');
    expect(out).toContain('<w:tc>');
    expect(out).toContain('Sport');
    expect(out).toContain('Avant.');
  });

  it('insère une image (data-URL) avec sa relation et son média', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const zip = new JSZip();
    zip.file('word/document.xml', doc(para('{expose}')));
    zip.file('[Content_Types].xml', '<Types></Types>');
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    const src = await zip.generateAsync({ type: 'nodebuffer' });
    const outBuf = await remplir(src, { '{expose}': `![logo](${PNG})` });
    const z = await JSZip.loadAsync(outBuf);
    expect(z.file('word/media/image1.png')).toBeTruthy();
    expect(await z.file('word/_rels/document.xml.rels').async('text')).toContain('media/image1.png');
    expect(await z.file('word/document.xml').async('text')).toContain('<w:drawing>');
  });

  it('met « Article N » en gras et en MAJUSCULES dans le dispositif', async () => {
    const src = await creer(doc(para('{dispositif}')));
    const out = await lire(await remplir(src, { '{dispositif}': markdownToRich('**Article 1** : une subvention est attribuée.') }));
    expect(out).toContain('<w:b/>');
    expect(out).toContain('ARTICLE 1');
    expect(out).toContain(' : une subvention est attribuée.');
  });
});
