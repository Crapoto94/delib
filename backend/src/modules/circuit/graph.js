/**
 * Graphe de circuit (section 9) : DONNÉE, pas du code — étapes, transitions conditionnelles, résolveurs de valideurs.
 * Ce module est pur (aucun accès base) : validation avant publication (CIR-61), évaluation des conditions, projection du
 * parcours (CIR-62, VIS-01).
 *
 * graph = {
 *   start: 'redaction',
 *   steps: [{ key, label, resolver:{kind,…}, mode:'one'|'all'|'quorum', quorum?, canEdit?, optional?, nonDelegable?, slaDays?,
 *             onEnter?:{statut}, onDone?:{statut, event} }],
 *   transitions: [{ from, to, when?: condition, otherwise?: true }]
 * }
 * Résolveurs : redacteur | titulaire{fonction} | groupe{code} | agent{username}.
 */
const { FONCTIONS } = require('../titulaires/titulaires.service');

const STEP_KEY = /^[a-z][a-z0-9_]{1,39}$/;
const RESOLVER_KINDS = ['redacteur', 'titulaire', 'groupe', 'agent'];
const MODES = ['one', 'all', 'quorum'];
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'notEmpty'];
const FIELDS = ['incidenceFinanciere', 'montant', 'typeCode', 'urgence', 'directionCode', 'serviceCode', 'hasCommission'];
const MAX_STEPS = 60;

const isField = (f) => FIELDS.includes(f) || /^custom\.[a-zA-Z0-9_]{1,40}$/.test(f);
const getFact = (facts, field) => (field.startsWith('custom.') ? facts.custom?.[field.slice(7)] : facts[field]);

/** Évalue une condition : { field, op, value } | { and:[…] } | { or:[…] } | { not: cond }. */
function evalCondition(cond, facts) {
  if (!cond) return true;
  if (cond.and) return cond.and.every((c) => evalCondition(c, facts));
  if (cond.or) return cond.or.some((c) => evalCondition(c, facts));
  if (cond.not) return !evalCondition(cond.not, facts);
  const v = getFact(facts, cond.field);
  switch (cond.op) {
    case 'eq': return v === cond.value;
    case 'ne': return v !== cond.value;
    case 'gt': return v !== null && v !== undefined && Number(v) > Number(cond.value);
    case 'gte': return v !== null && v !== undefined && Number(v) >= Number(cond.value);
    case 'lt': return v !== null && v !== undefined && Number(v) < Number(cond.value);
    case 'lte': return v !== null && v !== undefined && Number(v) <= Number(cond.value);
    case 'in': return Array.isArray(cond.value) && cond.value.includes(v);
    case 'empty': return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    case 'notEmpty': return !(v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0));
    default: return false;
  }
}

function conditionErrors(cond, where, errors) {
  if (!cond) return;
  if (cond.and || cond.or) { for (const c of cond.and || cond.or) conditionErrors(c, where, errors); return; }
  if (cond.not) { conditionErrors(cond.not, where, errors); return; }
  if (!isField(cond.field)) errors.push({ code: 'condition_champ', message: `Champ de condition inconnu : « ${cond.field} » (${where})` });
  if (!OPS.includes(cond.op)) errors.push({ code: 'condition_operateur', message: `Opérateur inconnu : « ${cond.op} » (${where})` });
  else if (!['empty', 'notEmpty'].includes(cond.op) && cond.value === undefined) errors.push({ code: 'condition_valeur', message: `Valeur manquante (${where})` });
}

const stepOf = (graph, key) => graph.steps.find((s) => s.key === key) || null;
const outgoing = (graph, key) => graph.transitions.filter((t) => t.from === key);

/** Étape suivante : première transition dont la condition est vraie ; à défaut, la transition « otherwise ». */
function nextKey(graph, fromKey, facts) {
  const out = outgoing(graph, fromKey);
  const hit = out.find((t) => !t.otherwise && (t.when ? evalCondition(t.when, facts) : true));
  return (hit || out.find((t) => t.otherwise))?.to ?? null;
}

/**
 * Contrôles de cohérence avant publication (CIR-61) : une étape initiale, étapes atteignables, pas d'impasse, une
 * sortie par défaut quand il y a des conditions, pas de boucle, résolveurs et conditions valides.
 * `groupCodes` : codes de groupes connus de l'organisme (facultatif).
 */
function validateGraph(graph, { groupCodes = null } = {}) {
  const errors = []; const warnings = [];
  const err = (code, message, step) => errors.push({ code, message, ...(step ? { step } : {}) });
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.steps) || !Array.isArray(graph.transitions)) {
    return { ok: false, errors: [{ code: 'structure', message: 'Le graphe doit contenir steps[] et transitions[]' }], warnings };
  }
  if (!graph.steps.length) err('aucune_etape', 'Le circuit ne contient aucune étape');
  if (graph.steps.length > MAX_STEPS) err('trop_d_etapes', `Trop d'étapes (maximum ${MAX_STEPS})`);
  const keys = new Set();
  for (const s of graph.steps) {
    if (!STEP_KEY.test(s.key || '')) err('cle_invalide', `Clé d'étape invalide : « ${s.key} » (minuscules, chiffres, _ ; 2 à 40 caractères)`, s.key);
    if (keys.has(s.key)) err('cle_dupliquee', `Clé d'étape en double : ${s.key}`, s.key);
    keys.add(s.key);
    if (!s.label?.trim()) err('libelle_manquant', `Libellé manquant pour l'étape ${s.key}`, s.key);
    const r = s.resolver;
    if (!r || !RESOLVER_KINDS.includes(r.kind)) err('resolveur_invalide', `Résolveur invalide pour l'étape ${s.key}`, s.key);
    else if (r.kind === 'titulaire' && !FONCTIONS.includes(r.fonction)) err('resolveur_fonction', `Fonction de titulaire inconnue pour l'étape ${s.key} : ${r.fonction}`, s.key);
    else if (r.kind === 'groupe') {
      if (!r.code) err('resolveur_groupe', `Code de groupe manquant pour l'étape ${s.key}`, s.key);
      else if (groupCodes && !groupCodes.has(r.code)) err('groupe_inconnu', `Groupe « ${r.code} » inconnu dans cet organisme (étape ${s.key})`, s.key);
    } else if (r.kind === 'agent' && !r.username) err('resolveur_agent', `Identifiant d'agent manquant pour l'étape ${s.key}`, s.key);
    if (s.mode && !MODES.includes(s.mode)) err('mode_invalide', `Mode inconnu pour l'étape ${s.key} : ${s.mode}`, s.key);
    if (s.mode === 'quorum' && !(Number.isInteger(s.quorum) && s.quorum >= 1)) err('quorum_invalide', `Quorum invalide pour l'étape ${s.key}`, s.key);
    if (s.slaDays !== undefined && !(Number(s.slaDays) >= 0 && Number(s.slaDays) <= 365)) err('sla_invalide', `Délai invalide pour l'étape ${s.key}`, s.key);
  }
  if (!graph.start || !keys.has(graph.start)) err('depart_invalide', "L'étape initiale est absente ou inconnue");
  for (const t of graph.transitions) {
    if (!keys.has(t.from)) err('transition_source', `Transition depuis une étape inconnue : ${t.from}`);
    if (!keys.has(t.to)) err('transition_cible', `Transition vers une étape inconnue : ${t.to}`);
    conditionErrors(t.when, `${t.from} → ${t.to}`, errors);
    if (t.when && t.otherwise) err('transition_ambigue', `Transition ${t.from} → ${t.to} : « when » et « otherwise » sont exclusifs`);
  }
  if (errors.length) return { ok: false, errors, warnings };

  // sorties par défaut : si une étape a des transitions conditionnelles, il faut un « otherwise » ou une transition sans condition
  for (const s of graph.steps) {
    const out = outgoing(graph, s.key);
    if (out.length && out.some((t) => t.when) && !out.some((t) => t.otherwise || !t.when)) err('sortie_par_defaut', `L'étape ${s.key} a des conditions sans sortie par défaut (« otherwise »)`, s.key);
    if (out.filter((t) => t.otherwise).length > 1) err('otherwise_multiple', `L'étape ${s.key} a plusieurs sorties « otherwise »`, s.key);
  }
  // atteignabilité et boucles
  const seen = new Set(); const stack = [graph.start];
  while (stack.length) { const k = stack.pop(); if (seen.has(k)) continue; seen.add(k); for (const t of outgoing(graph, k)) stack.push(t.to); }
  for (const s of graph.steps) if (!seen.has(s.key)) err('etape_inatteignable', `L'étape ${s.key} n'est atteignable depuis aucun chemin`, s.key);
  const color = new Map();
  const dfs = (k, path) => {
    color.set(k, 1);
    for (const t of outgoing(graph, k)) {
      if (color.get(t.to) === 1) { err('boucle', `Boucle dans le circuit : ${[...path, k, t.to].join(' → ')}`); continue; }
      if (!color.has(t.to)) dfs(t.to, [...path, k]);
    }
    color.set(k, 2);
  };
  if (keys.has(graph.start)) dfs(graph.start, []);
  const terminals = graph.steps.filter((s) => !outgoing(graph, s.key).length && seen.has(s.key));
  if (!terminals.length) err('aucune_sortie', "Aucun chemin ne mène à la fin du circuit");
  if (graph.steps.filter((s) => !outgoing(graph, s.key).length).length > 1) warnings.push({ code: 'plusieurs_fins', message: 'Plusieurs étapes finales : vérifiez que c\'est voulu' });
  if (!stepOf(graph, graph.start)?.canEdit) warnings.push({ code: 'depart_non_editable', message: "L'étape initiale (rédaction) n'est pas éditable" });
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Projette le parcours à partir de `fromKey` (par défaut le départ) selon les faits de l'acte.
 * `resolve(step)` renvoie les titulaires de l'étape ({ holders, missing }) ; la projection ne fait qu'enchaîner.
 */
async function projectPath(graph, facts, resolve, { fromKey = null, skipKeys = new Set() } = {}) {
  const path = []; const visited = new Set();
  let key = fromKey || graph.start;
  while (key && !visited.has(key) && path.length < MAX_STEPS) {
    visited.add(key);
    const step = stepOf(graph, key);
    if (!step) break;
    const r = skipKeys.has(key) ? { holders: [], skipped: true } : await resolve(step);
    path.push({ key, label: step.label, holders: r.holders || [], optional: !!step.optional, skipped: !!r.skipped, reason: r.reason || null, missing: !!r.missing, canEdit: !!step.canEdit, nonDelegable: !!step.nonDelegable, slaDays: step.slaDays ?? null, mode: step.mode || 'one' });
    key = nextKey(graph, key, facts);
  }
  return path;
}

module.exports = { STEP_KEY, RESOLVER_KINDS, MODES, OPS, FIELDS, evalCondition, validateGraph, nextKey, projectPath, stepOf, outgoing, isField };
