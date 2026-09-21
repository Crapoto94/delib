/**
 * Recherche lexicale dans le manifeste (MANIFEST.md), partagée par l'aide IA du centre d'aide et par Del-IA.
 * Le manifeste est chargé À LA DEMANDE (import dynamique) : il n'alourdit pas le bundle principal, et l'index
 * de ses sections n'est construit qu'une fois.
 */
export type Morceau = { titre: string; texte: string; norm: string };

const sansAccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STOP = new Set(['avec', 'dans', 'pour', 'plus', 'sont', 'cette', 'cettes', 'elle', 'elles', 'nous', 'vous', 'etre', 'avoir', 'fait', 'quel', 'quelle', 'quels', 'quelles', 'comment', 'quoi', 'qui', 'que', 'des', 'les', 'une', 'aux', 'sur', 'par', 'pas', 'est', 'son', 'ses', 'lui', 'ils', 'leur', 'votre', 'notre', 'tout', 'tous', 'toute', 'toutes', 'mais', 'donc', 'ou', 'et', 'en', 'au', 'du', 'de', 'la', 'le', 'un', 'il', 'je', 'tu', 'on', 'ne', 'se', 'ce', 'sa', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'ces', 'puis', 'peut', 'peuvent', 'doit', 'doivent', 'faire', 'faut', 'comme', 'aussi', 'bien', 'tres', 'sans', 'sous', 'vers', 'chez']);

/** Découpe le manifeste en morceaux par titre (niveaux 1 à 3), avec fil d'Ariane. */
function decouper(md: string): Morceau[] {
  const lignes = md.replace(/\r\n/g, '\n').split('\n');
  const out: { titre: string; texte: string }[] = [];
  const fil: string[] = []; let buf: string[] = [];
  const pousser = () => { const texte = buf.join('\n').trim(); if (texte) out.push({ titre: fil.filter(Boolean).join(' › ') || 'Manifeste', texte }); buf = []; };
  for (const l of lignes) {
    const m = /^(#{1,3})\s+(.*)$/.exec(l);
    if (m) { pousser(); const n = m[1].length; fil.length = Math.min(fil.length, n - 1); fil[n - 1] = m[2].trim(); }
    else buf.push(l);
  }
  pousser();
  return out.filter((c) => c.texte.length > 40).map((c) => ({ ...c, norm: sansAccent(`${c.titre} ${c.texte}`) }));
}

const mots = (question: string) => [...new Set(sansAccent(question).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];

/** Sélectionne les extraits du manifeste les plus proches de la question (recherche lexicale, sans IA). */
function choisir(index: Morceau[], question: string, max = 6): Morceau[] {
  const qs = mots(question);
  if (!qs.length) return index.slice(0, 3);
  const notes = index.map((c) => {
    let score = 0;
    for (const q of qs) { const n = c.norm.split(q).length - 1; if (n) score += Math.min(n, 5); if (sansAccent(c.titre).includes(q)) score += 3; }
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const choisis: Morceau[] = []; let taille = 0;
  for (const { c } of notes) { if (choisis.length >= max) break; if (choisis.length && taille + c.texte.length > 14000) break; choisis.push(c); taille += c.texte.length; }
  return choisis.length ? choisis : index.slice(0, 3);
}

let index: Morceau[] | null = null;
let promesse: Promise<void> | null = null;

/** Charge (une fois) le manifeste et son index. */
async function garantir(): Promise<void> {
  if (index) return;
  promesse = promesse ?? (async () => { const md = (await import('./legal/MANIFEST.md?raw')).default; index = decouper(md); })();
  await promesse;
}

/** Extrait du manifeste les passages les plus pertinents pour la question. */
export async function chargerExtraits(question: string, max = 6): Promise<{ titre: string; texte: string }[]> {
  await garantir();
  return choisir(index!, question, max).map(({ titre, texte }) => ({ titre, texte }));
}
