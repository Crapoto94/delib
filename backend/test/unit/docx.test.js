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

  it('met « Article N » en gras et en MAJUSCULES dans le dispositif', async () => {
    const src = await creer(doc(para('{dispositif}')));
    const out = await lire(await remplir(src, { '{dispositif}': markdownToRich('**Article 1** : une subvention est attribuée.') }));
    expect(out).toContain('<w:b/>');
    expect(out).toContain('ARTICLE 1');
    expect(out).toContain(' : une subvention est attribuée.');
  });
});
