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

  it('applique taille, rotation et alignement d’une image (fragment #vd:)', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const out = await lire(await remplir(await creer(doc(para('{expose}'))), { '{expose}': `![logo](${PNG}#vd:w=200,rot=90,align=center)` }));
    expect(out).toContain('rot="5400000"');
    expect(out).toContain('<w:jc w:val="center"/>');
    expect(out).toContain('cx="1905000"'); // 200 px × 9 525 EMU
  });

  it('aligne un paragraphe centré ou justifié (`{center}`, `{justify}`)', async () => {
    const src = await creer(doc(para('{expose}')));
    expect(await lire(await remplir(src, { '{expose}': '{center} Titre centré' }))).toContain('<w:jc w:val="center"/>');
    expect(await lire(await remplir(src, { '{expose}': '{justify} Texte justifié' }))).toContain('<w:jc w:val="both"/>');
  });

  it('injecte le corps d’un document bureautique en conservant polices et tailles', async () => {
    const modele = await creer(doc(`${para('Avant')}${para('{expose}')}${para('après')}`));
    const source = await creer(doc('<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial Black"/><w:sz w:val="32"/></w:rPr><w:t>GROS TEXTE</w:t></w:r></w:p>'));
    const out = await lire(await remplir(modele, { '{expose}': { docx: source } }));
    expect(out).toContain('<w:t>Avant</w:t>');
    expect(out).toContain('<w:t>après</w:t>');
    expect(out).toContain('GROS TEXTE');
    expect(out).toContain('w:ascii="Arial Black"');
    expect(out).toContain('<w:sz w:val="32"/>');
  });

  it('recopie les images d’un document bureautique injecté et réécrit les relations', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const zipSrc = new JSZip();
    zipSrc.file('word/document.xml', doc('<w:p><w:r><w:t>Image</w:t></w:r><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>'));
    zipSrc.file('[Content_Types].xml', '<Types/>');
    zipSrc.file('word/media/photo.png', PNG);
    zipSrc.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/></Relationships>');
    const source = await zipSrc.generateAsync({ type: 'nodebuffer' });
    const out = await remplir(await creer(doc(para('{expose}'))), { '{expose}': { docx: source } });
    const z = await JSZip.loadAsync(out);
    expect(z.file('word/media/image1.png')).toBeTruthy();
    expect(await z.file('word/document.xml').async('text')).toContain('r:embed="rId1"');
  });

  it('importe les styles nommés du document bureautique (renommés) et réécrit les références', async () => {
    const modele = await creer(doc(para('{expose}')));
    const z = new JSZip();
    z.file('[Content_Types].xml', '<Types></Types>');
    z.file('word/document.xml', doc('<w:p><w:pPr><w:pStyle w:val="TitrePerso"/></w:pPr><w:r><w:t>Style</w:t></w:r></w:p>'));
    z.file('word/styles.xml', '<?xml version="1.0"?><w:styles xmlns:w="x"><w:style w:type="paragraph" w:styleId="TitrePerso"><w:name w:val="Titre perso"/><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr></w:style></w:styles>');
    const source = await z.generateAsync({ type: 'nodebuffer' });
    const out = await JSZip.loadAsync(await remplir(modele, { '{expose}': { docx: source } }));
    expect(await out.file('word/document.xml').async('text')).toMatch(/<w:pStyle w:val="vd1_TitrePerso"\/>/);
    const styles = await out.file('word/styles.xml').async('text');
    expect(styles).toContain('w:styleId="vd1_TitrePerso"');
    expect(styles).toContain('Georgia');
  });

  it('importe les listes à puces (numérotation) du document bureautique', async () => {
    const modele = await creer(doc(para('{visas}')));
    const z = new JSZip();
    z.file('[Content_Types].xml', '<Types></Types>');
    z.file('word/document.xml', doc('<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Puces</w:t></w:r></w:p>'));
    z.file('word/numbering.xml', '<?xml version="1.0"?><w:numbering xmlns:w="x"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="7"/></w:num></w:numbering>');
    const source = await z.generateAsync({ type: 'nodebuffer' });
    const out = await JSZip.loadAsync(await remplir(modele, { '{visas}': { docx: source } }));
    expect(await out.file('word/document.xml').async('text')).toContain('<w:numId w:val="1"/>');
    const num = await out.file('word/numbering.xml').async('text');
    expect(num).toContain('w:numId="1"');
    expect(num).toContain('w:abstractNumId="1"');
    expect(num).toContain('w:numFmt w:val="bullet"');
    expect(num.indexOf('<w:abstractNum')).toBeLessThan(num.indexOf('<w:num '));   // schéma : abstractNum avant num
  });

  it('met « Article N » en gras et en MAJUSCULES dans le dispositif', async () => {
    const src = await creer(doc(para('{dispositif}')));
    const out = await lire(await remplir(src, { '{dispositif}': markdownToRich('**Article 1** : une subvention est attribuée.') }));
    expect(out).toContain('<w:b/>');
    expect(out).toContain('ARTICLE 1');
    expect(out).toContain(' : une subvention est attribuée.');
  });
});
