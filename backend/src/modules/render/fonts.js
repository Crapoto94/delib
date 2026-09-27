/**
 * Familles de polices des PDF. « interstate » (police de la Ville, fournie localement : jamais dans le dépôt) est chargée
 * depuis FONTS_DIR/interstate-2 ; si les fichiers manquent, on retombe sur Times sans faire échouer le rendu.
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
const { StandardFonts } = require('pdf-lib');

const FAMILIES = {
  times: { label: 'Times (standard PDF)', std: { text: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold }, repli: 'serif' },
  helvetica: { label: 'Helvetica (standard PDF)', std: { text: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold }, repli: 'sans' },
  interstate: { label: 'Interstate (police de la Ville)', dir: 'interstate-2', files: { text: 'InterstateRegular.otf', bold: 'InterstateBold.otf' } },
};

/**
 * Polices de repli EMBARQUÉES, utilisées pour les familles « standard PDF » (Helvetica, Times).
 *
 * Ces polices standard ne sont PAS incluses dans le fichier PDF : une visionneuse qui n'a pas leurs données les
 * remplace par du vide, et le texte disparaît. Constaté dans le parapheur du Hub : la trame posée par VibeDélib
 * (en-tête, pied, pagination) ne s'y affichait pas, alors qu'elle réapparaissait après signature (le PDF est alors
 * reconstruit par le parapheur). On embarque donc un vrai fichier de police dès qu'il est disponible — le PDF devient
 * autonome, quel que soit le lecteur.
 */
const REPLI = {
  serif: { dirs: ['/usr/share/fonts/dejavu', '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts'], files: { text: 'DejaVuSerif.ttf', bold: 'DejaVuSerif-Bold.ttf' } },
  sans: { dirs: ['/usr/share/fonts/dejavu', '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts'], files: { text: 'DejaVuSans.ttf', bold: 'DejaVuSans-Bold.ttf' } },
};

// Pas de ligatures (fi, fl, ffi…) : le glyphe de ligature d'un sous-ensemble OpenType s'affichait « # » dans certains lecteurs PDF
const NO_LIGATURES = { liga: false, clig: false, dlig: false, rlig: false, calt: false };

const bytesCache = new Map();
function readFont(dir, file) {
  const p = path.join(dir, file);
  if (!bytesCache.has(p)) bytesCache.set(p, fs.existsSync(p) ? fs.readFileSync(p) : null);
  return bytesCache.get(p);
}

/** Familles utilisables sur ce serveur (Interstate seulement si ses fichiers sont présents). */
function available(fontsDir) {
  return Object.entries(FAMILIES).map(([id, f]) => ({ id, label: f.label, disponible: !f.files || Object.values(f.files).every((file) => !!readFont(path.join(fontsDir, f.dir), file)) }));
}

/** Intègre la famille dans le document ; renvoie { text, bold, family } (family = famille réellement utilisée). */
async function embedFamily(doc, family, fontsDir) {
  const def = FAMILIES[family] || FAMILIES.times;
  if (def.files) {
    const dir = path.join(fontsDir || '', def.dir);
    const t = readFont(dir, def.files.text); const b = readFont(dir, def.files.bold);
    if (t && b) {
      doc.registerFontkit(fontkit);
      return { text: await doc.embedFont(t, { subset: true, features: NO_LIGATURES }), bold: await doc.embedFont(b, { subset: true, features: NO_LIGATURES }), family };
    }
    return embedFamily(doc, 'times', fontsDir);
  }
  return embedStandard(doc, def, family, fontsDir);
}

/**
 * Famille « standard » : on préfère une police **embarquée** dès qu'un fichier est disponible (voir `REPLI`). Repli
 * ultime : les polices standard du PDF, qui peuvent ne rien afficher dans certaines visionneuses.
 */
async function embedStandard(doc, def, family, fontsDir) {
  const repli = REPLI[def.repli];
  if (repli) {
    const dirs = [...(fontsDir ? [path.join(fontsDir, 'repli')] : []), ...repli.dirs];
    for (const dir of dirs) {
      const t = readFont(dir, repli.files.text); const b = readFont(dir, repli.files.bold);
      if (t && b) {
        try {
          doc.registerFontkit(fontkit);
          return { text: await doc.embedFont(t, { subset: true, features: NO_LIGATURES }), bold: await doc.embedFont(b, { subset: true, features: NO_LIGATURES }), family: family in FAMILIES ? family : 'times' };
        } catch { /* fichier illisible : on essaie le suivant */ }
      }
    }
  }
  return { text: await doc.embedFont(def.std.text), bold: await doc.embedFont(def.std.bold), family: family in FAMILIES ? family : 'times' };
}

module.exports = { FAMILIES, available, embedFamily };
