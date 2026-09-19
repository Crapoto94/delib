/**
 * Nomenclature ministérielle des matières (matieres.txt, 4 niveaux) — MAT-01 à MAT-06.
 *  - code = ce qui précède le premier espace (ou le point suivi d'une lettre : « 1.Commande Publique ») ;
 *  - parent = code tronqué au dernier segment ; niveau = nombre de segments ;
 *  - tri NUMÉRIQUE par segment (le fichier place 1.2.1.10 avant 1.2.1.2) ;
 *  - anomalies connues corrigées et signalées dans le rapport d'import (MAT-06).
 */
const CORRECTIONS = [
  [/pourvoirs/gi, 'pouvoirs'],
  [/competences/gi, 'compétences'],
  [/Domaines de compétences/g, 'Domaines de compétences'],
];

const LINE = /^(\d+(?:\.\d+)*)\.?\s*(\D.*)$/;

const compareCodes = (a, b) => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  }
  return 0;
};

function parseMatieres(text) {
  const items = []; const corrections = []; const ignored = [];
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) { ignored.push(line); continue; }
    let libelle = m[2].trim();
    for (const [re, to] of CORRECTIONS) {
      const fixed = libelle.replace(re, to);
      if (fixed !== libelle) { corrections.push({ code: m[1], avant: libelle, apres: fixed }); libelle = fixed; }
    }
    const segs = m[1].split('.');
    items.push({ code: m[1], libelle, parentCode: segs.length > 1 ? segs.slice(0, -1).join('.') : null, niveau: segs.length });
  }
  items.sort((a, b) => compareCodes(a.code, b.code));
  items.forEach((it, i) => { it.ordre = i + 1; });
  const codes = new Set(items.map((i) => i.code));
  const orphans = items.filter((i) => i.parentCode && !codes.has(i.parentCode)).map((i) => i.code);
  const duplicates = items.filter((i, idx) => items.findIndex((j) => j.code === i.code) !== idx).map((i) => i.code);
  return { items, corrections, ignored, orphans, duplicates };
}

/** Code -> niveaux classif1..5 attendus par S²LOW (« 1.1.2.1 » -> [1,1,2,1]). */
const classifLevels = (code) => String(code).split('.').map(Number).slice(0, 5);

module.exports = { parseMatieres, compareCodes, classifLevels };
