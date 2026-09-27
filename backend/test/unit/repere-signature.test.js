/**
 * Collecteurs — repère de signature dans un document.
 *
 * Le repère (par exemple « [SIGNATURE] ») est cherché dans le PDF final pour placer le cadre de signature : c'est ce
 * qui permet à un modèle Word/PDF déposé de dire lui-même où le maire doit signer. Ce test construit un PDF avec
 * pdf-lib (origine en bas à gauche, comme la bibliothèque de lecture) et vérifie la conversion en pourcentages
 * « depuis la gauche » et « depuis le haut », la convention attendue par le parapheur.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chercherRepereSignature } from '../../src/modules/collecteurs/collecteurs.service.js';

const PAGE = { w: 595.28, h: 841.89 };   // A4, en points

async function pdfAvecTexte(texte, { x = 300, y = 200 } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const police = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(texte, { x, y, size: 12, font: police });
  return Buffer.from(await doc.save());
}

describe('collecteurs — repère de signature', () => {
  it('situe le cadre à l’endroit du repère, en pourcentages de la page', async () => {
    const a = await chercherRepereSignature(await pdfAvecTexte('[SIGNATURE]', { x: 100 }), '[SIGNATURE]');
    const b = await chercherRepereSignature(await pdfAvecTexte('[SIGNATURE]', { x: 300 }), '[SIGNATURE]');
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(a.page).toBe(1);
    // 200 pt d'écart sur une page de 595,28 pt : environ 33,6 points de pourcentage de plus.
    expect(b.x - a.x).toBeGreaterThan(32);
    expect(b.x - a.x).toBeLessThan(35);
    // Le texte est posé à 200 pt du bas d'une page de 841,89 pt : environ 76 % depuis le haut, pour les deux.
    expect(a.y).toBeGreaterThan(74); expect(a.y).toBeLessThan(78);
    expect(b.y).toBeGreaterThan(74); expect(b.y).toBeLessThan(78);
    expect(a.w).toBe(150); expect(a.h).toBe(60);
  });

  it('trouve le repère quelle que soit la casse ou les accents', async () => {
    const pdf = await pdfAvecTexte('Signature du maire ici');
    expect(await chercherRepereSignature(pdf, 'signature')).not.toBeNull();
  });

  it('rend null quand le repère est absent — le cadre par défaut s’applique alors', async () => {
    const pdf = await pdfAvecTexte('Aucun marqueur dans ce document.');
    expect(await chercherRepereSignature(pdf, '[SIGNATURE]')).toBeNull();
    expect(await chercherRepereSignature(pdf, '')).toBeNull();
  });
});
