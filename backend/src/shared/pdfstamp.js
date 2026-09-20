/**
 * Tampon de la préfecture (TLT-34, D104) : l'encadré « Accusé de réception en préfecture » posé en haut à droite de CHAQUE page, comme sur
 * l'extrait du registre de la Ville : identifiant de l'acte, date de télétransmission, date de réception en préfecture.
 * Posé sur la copie consultable ; le PDF transmis à S²LOW n'est jamais modifié.
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const jour = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });

/** Renvoie un nouveau PDF : chaque page porte l'encadré. `simulation` : la première ligne le dit (aucune valeur juridique). */
async function apposerTampon(pdfBuffer, { arId, dateTransmission, dateReception, simulation = false }) {
  const doc = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const lignes = [
    `Accusé de réception en préfecture${simulation ? ' (SIMULATION)' : ''}`, String(arId),
    `Date de télétransmission : ${dateTransmission ? jour(dateTransmission) : jour(dateReception)}`, `Date de réception préfecture : ${jour(dateReception)}`,
  ];
  const taille = 6.2; const interligne = 7.6; const marge = 4;
  const largeur = Math.max(...lignes.map((l) => f.widthOfTextAtSize(l, taille))) + marge * 2; const hauteur = lignes.length * interligne + marge * 2 - 1;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize(); const x = width - 16 - largeur; const y = height - 12 - hauteur;
    page.drawRectangle({ x, y, width: largeur, height: hauteur, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 0.7 });
    lignes.forEach((l, i) => page.drawText(l, { x: x + marge, y: y + hauteur - marge - taille - i * interligne + 0.5, size: taille, font: f, color: rgb(0, 0, 0) }));
  }
  return Buffer.from(await doc.save());
}

/** Assemble plusieurs PDF (page de garde, présence, délibération) en un seul. */
async function assembler(buffers) {
  const out = await PDFDocument.create();
  for (const b of buffers) { const src = await PDFDocument.load(b, { updateMetadata: false }); for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p); }
  return { buffer: Buffer.from(await out.save()), pages: out.getPageCount() };
}

module.exports = { apposerTampon, assembler, jour };
