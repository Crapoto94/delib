/**
 * Règles de la tenue de séance (LIVE-04, LIVE-08 à LIVE-10) — fonctions PURES, sans base ni horloge, testées à part.
 *
 *  - un élu EN SALLE exerce sa propre voix (son éventuel pouvoir donné est alors sans effet) ;
 *  - un mandant qui n'est pas en salle vote PAR POUVOIR si son mandataire est en salle ;
 *  - tous les autres (absents, excusés, sortis, mandants dont le mandataire est absent) ne prennent pas part au vote.
 */
const CHOIX = ['pour', 'contre', 'abstention', 'nppv'];

/**
 * Droit de vote de chaque élu : 'propre' | 'pouvoir' | 'aucun', avec le mandataire quand c'est un pouvoir.
 * `presences` : Map eluId -> { statut, enSalle } ; `procurations` : [{ mandant, mandataire }].
 */
function droits(eluIds, presences, procurations) {
  const enSalle = (id) => !!presences.get(id)?.enSalle;
  const mandataireDe = new Map(procurations.map((p) => [p.mandant, p.mandataire]));
  const out = new Map();
  for (const id of eluIds) {
    if (enSalle(id)) { out.set(id, { droit: 'propre', mandataire: null }); continue; }
    const m = mandataireDe.get(id);
    out.set(id, m && enSalle(m) ? { droit: 'pouvoir', mandataire: m } : { droit: 'aucun', mandataire: null });
  }
  return out;
}

/** Décompte : `votes` = Map eluId -> choix. Les élus sans droit sont « absents » ; ceux qui ont le droit mais pas de choix sont « manquants ». */
function decompte(eluIds, droitsMap, votes) {
  const t = { pour: 0, contre: 0, abstention: 0, nppv: 0, absents: 0, votants: 0, exprimes: 0, manquants: [] };
  for (const id of eluIds) {
    if (droitsMap.get(id)?.droit === 'aucun') { t.absents++; continue; }
    const c = votes.get(id);
    if (!CHOIX.includes(c)) { t.manquants.push(id); continue; }
    t[c]++;
  }
  t.votants = t.pour + t.contre + t.abstention;
  t.exprimes = t.pour + t.contre;
  return t;
}

/**
 * Résultat d'un vote. Abstentions et NPPV ne sont pas des suffrages exprimés `[H]`. Partage des voix : la voix du président de séance
 * est prépondérante — il faut donc qu'il ait voté pour ou contre (`presidentChoix`) ; sinon `{ partage: true }` et le point reste ouvert.
 */
function resultat(t, presidentChoix) {
  if (t.pour > t.contre) return { resultat: t.contre === 0 && t.abstention === 0 ? 'adopte_unanimite' : 'adopte_majorite' };
  if (t.pour < t.contre) return { resultat: 'rejete' };
  if (t.pour === 0) return { resultat: 'rejete' }; // personne n'a exprimé de suffrage
  if (presidentChoix === 'pour') return { resultat: 'adopte_preponderante' };
  if (presidentChoix === 'contre') return { resultat: 'rejete_preponderante' };
  return { partage: true };
}

/** Quorum : majorité des membres en exercice `[H]` ; seuls comptent les élus en salle (jamais les pouvoirs). */
function quorum(membres, enSalle) {
  const requis = Math.floor(membres / 2) + 1;
  return { membres, requis, enSalle, atteint: membres > 0 && enSalle >= requis };
}

/** Statut d'un acte selon le résultat d'un point. */
const ACTE_STATUT = { adopte_unanimite: 'adopte', adopte_majorite: 'adopte', adopte_preponderante: 'adopte', rejete: 'rejete', rejete_preponderante: 'rejete' };

/** Point suivant / précédent à traiter : saute les chapitres, les points retirés et ceux déjà clos. */
function voisin(points, courantId, sens) {
  const ok = (p) => p.kind !== 'chapitre' && p.statut !== 'retire' && !['traite', 'sans_vote', 'retire', 'ajourne'].includes(p.etat);
  const i = points.findIndex((p) => p.id === courantId);
  const rangee = sens === 'suivant' ? points.slice(i + 1) : points.slice(0, Math.max(i, 0)).reverse();
  if (i < 0 && sens === 'suivant') return points.find(ok) || null;
  return rangee.find(sens === 'suivant' ? ok : (p) => p.kind !== 'chapitre' && p.statut !== 'retire') || null;
}

module.exports = { CHOIX, droits, decompte, resultat, quorum, voisin, ACTE_STATUT };
