/**
 * Recherche plein texte (section 20, D87) — PostgreSQL seul (REC-09), derrière un port : ce service est le seul à connaître
 * `search_index`, la configuration `fr_unaccent` et la syntaxe de requête ; un autre moteur (OpenSearch) le remplacerait tel quel.
 *
 * - Index : une entrée par acte, reconstruite à chaque évènement utile et balayée périodiquement (rattrapage) ; jamais pendant la frappe.
 * - Droits : la règle SQL de visibilité des actes (VIS-*) est appliquée DANS la requête → ni résultat, ni compteur, ni extrait d'un acte invisible.
 * - Espace élus : délibérations adoptées des séances accessibles, poids A et B seulement (titre, objet, dispositif), extraits sans annexe ni exposé.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const PLAFOND = 5000;          // lignes lues pour composer les facettes
const MAX_ANNEXE = 400000;     // caractères conservés par annexe
const MAX_CONTENU = 60000;     // caractères conservés pour les extraits
const MAX_TSV = 700000;        // un tsvector est limité à 1 Mo
const RESULTATS = {
  adopte_unanimite: "adopté à l'unanimité", adopte_majorite: 'adopté à la majorité', adopte_preponderante: 'adopté voix prépondérante',
  rejete_preponderante: 'rejeté voix prépondérante', rejete: 'rejeté',
};
const AVIS = { favorable: 'avis favorable', defavorable: 'avis défavorable', reserve: 'avis avec réserves', sans_avis: 'sans avis' };

// ------------------------------------------------------------------------------------------------------------ texte
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Markdown → texte brut (l'index ne conserve ni la mise en forme ni les liens). */
const brut = (md) => String(md || '')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^[#>\-*+\s]+/gm, ' ').replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim();
const coupe = (s, n) => (s.length > n ? s.slice(0, n) : s);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Extrait surligné : tout est échappé, seules nos balises <mark> subsistent. */
function surligne(s) {
  return esc(s).replace(/\[\[m\]\]/g, '<mark>').replace(/\[\[\/m\]\]/g, '</mark>');
}

// ------------------------------------------------------------------------------------------------------------ requête
const lex = (s) => `'${String(s).replace(/'/g, "''")}'`;
const mots = (s) => String(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Synonymes (REC-12) : une ligne = des termes équivalents, séparés par des virgules (« école, établissement scolaire »). */
function groupesSynonymes(texte) {
  return String(texte || '').split(/\r?\n/).map((l) => l.split(/[,;=]/).map((t) => t.trim()).filter(Boolean)).filter((g) => g.length > 1);
}

/**
 * Syntaxe naturelle → expression tsquery. `poids` restreint les correspondances (ex. « AB » pour l'espace élus).
 * Renvoie aussi le numéro reconnu : « 123 » (suivi) ou « 2026-4-012 » (délibération).
 */
function analyser(q, { synonymes = [], poids = '' } = {}) {
  const texte = String(q || '').trim();
  const out = { tsq: null, numero: null, mots: [], strict: false }; // strict : expression exacte ou exclusion → jamais de tolérance aux fautes
  if (!texte) return out;
  if (/^\d{1,9}$/.test(texte)) { out.numero = { suivi: Number(texte), ref: null }; return out; }
  if (/^[A-Za-z0-9]{1,12}(-[A-Za-z0-9]{1,12}){2,}$/.test(texte)) { out.numero = { suivi: null, ref: texte }; return out; }

  const groupes = synonymes.map((g) => g.map(sansAccent));
  const suffixe = (prefixe) => (prefixe || poids ? `:${prefixe ? '*' : ''}${poids}` : '');
  const terme = (parts, prefixe) => parts.map((x, i) => lex(x) + suffixe(i === parts.length - 1 && prefixe)).join(' <-> ');
  const ors = []; let courant = [];
  const pousse = (expr) => courant.push(expr);
  const ferme = () => { if (courant.length) ors.push(courant.join(' & ')); courant = []; };
  const re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(texte))) {
    if (m[1] !== undefined) {
      const parts = mots(m[1]); if (!parts.length) continue;
      out.mots.push(...parts); out.strict = true;
      pousse(`(${terme(parts, false)})`);
      continue;
    }
    let tok = m[2];
    if (tok === 'OR') { ferme(); continue; }
    let neg = false; if (tok.startsWith('-') && tok.length > 1) { neg = true; out.strict = true; tok = tok.slice(1); }
    const prefixe = tok.endsWith('*'); const parts = mots(tok); if (!parts.length) continue;
    if (!neg) out.mots.push(...parts); // les mots exclus ne servent pas à la tolérance aux fautes
    let expr = terme(parts, prefixe);
    const g = !prefixe && groupes.find((gr) => gr.includes(parts.map(sansAccent).join(' ')));
    if (g) expr = `(${g.map((alt) => terme(mots(alt), false)).join(' | ')})`;
    else if (parts.length > 1) expr = `(${expr})`;
    pousse(neg ? `!${expr}` : expr);
  }
  ferme();
  if (ors.length) out.tsq = ors.map((x) => `(${x})`).join(' | ');
  return out;
}

// ------------------------------------------------------------------------------------------------------------ service
function createRecherche({ db, audit, acl, settings, storage, bus, log }) {
  let chaine = Promise.resolve();
  let reindexation = null;      // { total, traites, debut, fin, erreur }
  let pdfjs = null;

  // ------------------------------------------------------------------------------------- extraction du texte des PDF
  async function lirePdf(buffer) {
    pdfjs = pdfjs || await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0, isEvalSupported: false }).promise;
    try {
      let out = '';
      for (let i = 1; i <= doc.numPages && out.length < MAX_ANNEXE; i++) {
        const page = await doc.getPage(i);
        out += `${(await page.getTextContent()).items.map((x) => x.str).join(' ')} `;
        page.cleanup();
      }
      return out.replace(/\s+/g, ' ').trim();
    } finally { await doc.destroy(); }
  }

  /** Texte d'un fichier PDF, lu une seule fois (cache par fichier). */
  async function texteDuFichier(fileId) {
    const dejaLu = await db.get('SELECT 1 AS x FROM search_annexes WHERE file_id = $1', [fileId]);
    if (dejaLu) return false;
    const f = await db.get('SELECT storage_key FROM files WHERE id = $1', [fileId]);
    if (!f) return false;
    let texte = ''; let erreur = null;
    try { texte = coupe(await lirePdf(await storage.get(f.storage_key)), MAX_ANNEXE); } catch (e) { erreur = String(e.message || e).slice(0, 300); log?.warn?.({ fileId, err: erreur }, 'extraction du texte du PDF impossible'); }
    await db.run('INSERT INTO search_annexes (file_id, texte, sans_texte, erreur) VALUES ($1,$2,$3,$4) ON CONFLICT (file_id) DO NOTHING', [fileId, texte, texte.length < 20, erreur]);
    return true;
  }

  // ------------------------------------------------------------------------------------------------- indexation
  async function reindexerActe(acteId) {
    const a = await db.get('SELECT * FROM actes WHERE id = $1', [acteId]);
    if (!a) return false;
    const ref = async (id) => (id ? (await db.get('SELECT libelle FROM ref_items WHERE id = $1', [id]))?.libelle || '' : '');
    const [type, nature, matiere, rubrique] = await Promise.all([ref(a.type_id), ref(a.nature_id), ref(a.matiere_id), ref(a.rubrique_id)]);
    const rapp = a.rapporteur_id ? await db.get('SELECT nom, prenom FROM elus WHERE id = $1', [a.rapporteur_id]) : null;
    const delibs = await db.all('SELECT titre FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [acteId]);
    const textes = await db.all('SELECT kind, markdown FROM tracked_texts WHERE acte_id = $1 ORDER BY id', [acteId]);
    const avis = await db.all("SELECT avis, avis_commentaire FROM acte_commissions WHERE acte_id = $1 AND retiree_at IS NULL AND avis IS NOT NULL", [acteId]);
    const points = await db.all(
      `SELECT it.numero, sp.resultat FROM seance_items it LEFT JOIN seance_points sp ON sp.item_id = it.id WHERE it.acte_id = $1 AND it.statut = 'a_traiter'`, [acteId]);
    const annexes = await db.all(
      `SELECT an.titre, sa.texte FROM annexes an LEFT JOIN search_annexes sa ON sa.file_id = an.file_id WHERE an.acte_id = $1 ORDER BY an.ordre, an.id`, [acteId]);

    const txt = (k) => textes.filter((t) => t.kind === k).map((t) => brut(t.markdown)).join(' ');
    const objet = brut(a.commentaire_initial);
    const numeros = [String(a.numero_suivi), ...points.map((p) => p.numero).filter(Boolean)].join(' ');
    const A = [a.titre, ...delibs.map((d) => d.titre), numeros].join(' . ');
    const dispositif = txt('dispositif');
    const B = [objet, rubrique, matiere, nature, type, rapp ? `${rapp.prenom} ${rapp.nom}` : '', dispositif].filter(Boolean).join(' . ');
    const C = [txt('expose'), txt('visas'), a.direction_label, ...avis.map((v) => `${AVIS[v.avis] || v.avis} ${brut(v.avis_commentaire)}`),
      ...points.map((p) => RESULTATS[p.resultat] || '')].filter(Boolean).join(' . ');
    const D = coupe(annexes.map((x) => `${x.titre} ${x.texte || ''}`).join(' . '), MAX_ANNEXE);

    const publicTxt = [a.titre, ...delibs.map((d) => d.titre), objet, dispositif].filter(Boolean).join(' . ');
    const contenu = coupe([A, B, C, D].filter(Boolean).join(' . '), MAX_CONTENU);
    const tsv = `(setweight(to_tsvector('fr_unaccent', $3), 'A') || setweight(to_tsvector('fr_unaccent', $4), 'B') || setweight(to_tsvector('fr_unaccent', $5), 'C') || setweight(to_tsvector('fr_unaccent', $6), 'D'))`;
    await db.run(
      `INSERT INTO search_index (acte_id, organisme_id, titre_norm, contenu, contenu_public, tsv, indexed_at)
       VALUES ($1, $2, unaccent(lower($7)), $8, $9, ${tsv}, now())
       ON CONFLICT (acte_id) DO UPDATE SET titre_norm = EXCLUDED.titre_norm, contenu = EXCLUDED.contenu, contenu_public = EXCLUDED.contenu_public, tsv = EXCLUDED.tsv, indexed_at = now()`,
      [acteId, a.organisme_id, coupe(A, MAX_TSV), coupe(B, MAX_TSV), coupe(C, MAX_TSV), D, `${a.titre} ${delibs.map((d) => d.titre).join(' ')} ${objet}`.slice(0, 4000), contenu, coupe(publicTxt, MAX_CONTENU)]);
    return true;
  }

  /** Lit le texte des annexes d'un acte qui n'ont pas encore été lues, puis reconstruit l'entrée. */
  async function traiterActe(acteId) {
    for (const f of await db.all('SELECT DISTINCT file_id FROM annexes WHERE acte_id = $1', [acteId])) await texteDuFichier(f.file_id);
    return reindexerActe(acteId);
  }

  /** File d'attente série : jamais plus d'une extraction de PDF à la fois, et jamais dans la requête de l'utilisateur. */
  function enFile(acteId) {
    chaine = chaine.then(() => traiterActe(acteId)).catch((e) => log?.warn?.({ acteId, err: e.message }, "indexation d'un acte en erreur"));
    return chaine;
  }
  const surActe = (p) => { if (p?.acteId) enFile(p.acteId); };
  if (bus?.on) {
    for (const t of ['acte.created', 'acte.submitted', 'acte.seance_changed', 'acte.duplicated', 'deliberation.added', 'text.committed', 'text.resolved', 'annexe.added', 'annexe.replaced', 'commission.avis', 'commission.retiree']) bus.on(t, surActe);
    bus.on('tenue.close', (p) => { db.all("SELECT DISTINCT acte_id FROM seance_items WHERE seance_id = $1 AND acte_id IS NOT NULL", [p.seanceId]).then((rows) => rows.forEach((r) => enFile(r.acte_id))).catch(() => undefined); });
  }

  /** Actes dont l'index est absent ou plus ancien qu'une de leurs sources (rattrapage : tâche planifiée). */
  async function enRetard(org, limite = 200) {
    return db.all(
      `SELECT a.id FROM actes a LEFT JOIN search_index si ON si.acte_id = a.id
       WHERE a.organisme_id = $1 AND (si.acte_id IS NULL OR si.indexed_at < GREATEST(a.updated_at,
         COALESCE((SELECT max(t.updated_at) FROM tracked_texts t WHERE t.acte_id = a.id), 'epoch'),
         COALESCE((SELECT max(x.updated_at) FROM annexes x WHERE x.acte_id = a.id), 'epoch'),
         COALESCE((SELECT max(d.updated_at) FROM deliberations d WHERE d.acte_id = a.id), 'epoch'),
         COALESCE((SELECT max(p.updated_at) FROM seance_points p JOIN seance_items i ON i.id = p.item_id WHERE i.acte_id = a.id), 'epoch'),
         COALESCE((SELECT max(c.avis_at) FROM acte_commissions c WHERE c.acte_id = a.id), 'epoch')))
       ORDER BY a.id LIMIT $2`, [org, limite]);
  }

  // ------------------------------------------------------------------------------------------------- requête
  async function synonymesDe(org) { return groupesSynonymes((await settings.resolve(org))['recherche.synonymes']?.value); }

  /** Descendants d'une matière (arbre par code parent), elle-même comprise. */
  async function matieresSous(org, matiereId) {
    const items = await db.all("SELECT id, code, parent_code FROM ref_items WHERE kind = 'matiere' AND (organisme_id IS NULL OR organisme_id = $1)", [org]);
    const racine = items.find((i) => i.id === matiereId); if (!racine) return [matiereId];
    const ids = new Set([racine.id]); const codes = new Set([racine.code]); let grandi = true;
    while (grandi) { grandi = false; for (const i of items) if (i.parent_code && codes.has(i.parent_code) && !ids.has(i.id)) { ids.add(i.id); codes.add(i.code); grandi = true; } }
    return [...ids];
  }

  /**
   * Cœur : construit et exécute la requête. `portee` = { vis } (agents) ou { elu: { seanceIds } } (espace élus).
   * Renvoie toutes les lignes (plafonnées) : les facettes sont comptées dessus, la page est découpée ensuite.
   */
  async function lignes(org, f, portee) {
    const elu = !!portee.elu;
    const syn = await synonymesDe(org);
    const an = analyser(f.q, { synonymes: syn, poids: elu ? 'AB' : '' });
    const p = [org]; const add = (v) => { p.push(v); return `$${p.length}`; };
    const w = ['si.organisme_id = $1'];

    if (elu) {
      if (!portee.elu.seanceIds.length) return { rows: [], an, approchee: false };
      w.push(`EXISTS (SELECT 1 FROM seance_items xi JOIN seance_points xp ON xp.item_id = xi.id WHERE xi.acte_id = a.id AND xi.seance_id = ANY(${add(portee.elu.seanceIds)}::int[]) AND xp.resultat LIKE 'adopte%')`);
    } else {
      const vis = await acl.visibilitySql(portee.ctx, org, p.length + 1);
      p.push(...vis.params); w.push(vis.where);
    }

    // critères (REC-03)
    if (f.statut) w.push(`a.statut = ${add(f.statut)}`); else w.push("a.statut <> 'abandonne'");
    if (f.typeId) w.push(`a.type_id = ${add(f.typeId)}`);
    if (f.natureId) w.push(`a.nature_id = ${add(f.natureId)}`);
    if (f.matiereId) w.push(`a.matiere_id = ANY(${add(await matieresSous(org, f.matiereId))}::int[])`);
    if (f.rubriqueId) w.push(`a.rubrique_id = ${add(f.rubriqueId)}`);
    if (f.rapporteurId) w.push(`a.rapporteur_id = ${add(f.rapporteurId)}`);
    if (f.directionCode) w.push(`a.direction_code = ${add(f.directionCode)}`);
    if (f.redacteur) w.push(`a.redacteur = ${add(f.redacteur)}`);
    if (f.incidence !== undefined) w.push(`a.incidence_financiere IS NOT DISTINCT FROM ${add(f.incidence)}`);
    if (f.annexes !== undefined) w.push(`${f.annexes ? '' : 'NOT '}EXISTS (SELECT 1 FROM annexes xa WHERE xa.acte_id = a.id)`);
    if (f.seanceId) w.push(`d.seance_id = ${add(f.seanceId)}`);
    if (f.instanceId) w.push(`d.instance_id = ${add(f.instanceId)}`);
    if (f.resultat) w.push(`d.resultat = ${add(f.resultat)}`);
    if (f.du) w.push(`d.date_seance >= ${add(f.du)}::date`);
    if (f.au) w.push(`d.date_seance < (${add(f.au)}::date + 1)`);
    if (f.creeDu) w.push(`a.created_at >= ${add(f.creeDu)}::date`);
    if (f.creeAu) w.push(`a.created_at < (${add(f.creeAu)}::date + 1)`);

    const nBase = p.length;
    let tsq = null; let rang = '1::float4'; let approchee = false; const fts = [];
    if (an.numero) {
      if (an.numero.suivi !== null) fts.push(elu ? 'FALSE' : `a.numero_suivi = ${add(an.numero.suivi)}`);
      else fts.push(`EXISTS (SELECT 1 FROM seance_items ni WHERE ni.acte_id = a.id AND upper(ni.numero) = ${add(an.numero.ref.toUpperCase())})`);
    } else if (an.tsq) {
      const ok = (await db.get('SELECT numnode(to_tsquery(\'fr_unaccent\', $1)) AS n', [an.tsq])).n > 0;
      if (ok) { tsq = add(an.tsq); fts.push(`si.tsv @@ to_tsquery('fr_unaccent', ${tsq})`); rang = `ts_rank(si.tsv, to_tsquery('fr_unaccent', ${tsq}))`; }
      else fts.push('FALSE');
    }

    const sql = (extraWhere, extraRank) => `
      SELECT a.id, a.numero_suivi, a.titre, a.statut, a.type_id, a.nature_id, a.matiere_id, a.rubrique_id, a.rapporteur_id, a.direction_code, a.direction_label,
             a.created_at, a.incidence_financiere, d.seance_id, d.instance_id, d.instance_nom, d.date_seance, d.resultat, d.numero, d.item_id, ${extraRank} AS rang
      FROM search_index si JOIN actes a ON a.id = si.acte_id
      LEFT JOIN LATERAL (
        SELECT it.id AS item_id, it.numero, se.id AS seance_id, se.date_seance, se.instance_id, i.nom AS instance_nom, sp.resultat
        FROM seance_items it JOIN seances se ON se.id = it.seance_id JOIN instances i ON i.id = se.instance_id LEFT JOIN seance_points sp ON sp.item_id = it.id
        WHERE it.acte_id = a.id AND it.statut = 'a_traiter' ${elu ? "AND sp.resultat LIKE 'adopte%'" : ''} ORDER BY se.date_seance DESC LIMIT 1) d ON true
      WHERE ${[...w, ...(extraWhere ? [] : fts)].join(' AND ')}${extraWhere} ORDER BY rang DESC, d.date_seance DESC NULLS LAST, a.id DESC LIMIT ${PLAFOND}`;
    let rows = await db.all(sql('', rang), p);

    // tolérance aux fautes légères (REC-04) : seulement si rien n'a été trouvé
    if (!rows.length && !an.numero && an.mots.length && !an.strict) {
      p.length = nBase; // le paramètre de la tsquery n'est plus utilisé dans cette variante
      const q = add(sansAccent(an.mots.join(' ')));
      rows = await db.all(sql(` AND word_similarity(${q}::text, si.titre_norm) >= 0.45`, `word_similarity(${q}::text, si.titre_norm)`), p);
      approchee = rows.length > 0;
    }
    return { rows, an, tsq: tsq ? an.tsq : null, approchee };
  }

  const cle = (r, k) => r[k] ?? null;
  async function libelles(org, rows) {
    const ids = [...new Set(rows.flatMap((r) => [r.type_id, r.nature_id, r.matiere_id, r.rubrique_id]).filter(Boolean))];
    const refs = ids.length ? new Map((await db.all('SELECT id, libelle FROM ref_items WHERE id = ANY($1::int[])', [ids])).map((x) => [x.id, x.libelle])) : new Map();
    const eids = [...new Set(rows.map((r) => r.rapporteur_id).filter(Boolean))];
    const elus = eids.length ? new Map((await db.all('SELECT id, nom, prenom FROM elus WHERE id = ANY($1::int[])', [eids])).map((x) => [x.id, `${x.prenom} ${String(x.nom).toUpperCase()}`.trim()])) : new Map();
    return { ref: (id) => refs.get(id) || null, elu: (id) => elus.get(id) || null };
  }

  function facettes(rows, lib) {
    const compte = (cleFn, libFn, tri) => {
      const m = new Map();
      for (const r of rows) { const k = cleFn(r); if (k === null || k === undefined || k === '') continue; m.set(k, (m.get(k) || 0) + 1); }
      const out = [...m.entries()].map(([valeur, n]) => ({ valeur, libelle: libFn(valeur, rows.find((r) => cleFn(r) === valeur)), n }));
      return out.sort(tri || ((a, b) => b.n - a.n || String(a.libelle).localeCompare(String(b.libelle), 'fr')));
    };
    const date = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    return {
      statut: compte((r) => r.statut, (v) => v),
      typeId: compte((r) => r.type_id, (v) => lib.ref(v)),
      natureId: compte((r) => r.nature_id, (v) => lib.ref(v)),
      matiereId: compte((r) => r.matiere_id, (v) => lib.ref(v)),
      rubriqueId: compte((r) => r.rubrique_id, (v) => lib.ref(v)),
      rapporteurId: compte((r) => r.rapporteur_id, (v) => lib.elu(v)),
      directionCode: compte((r) => r.direction_code, (v, r) => r?.direction_label || v),
      seanceId: compte((r) => r.seance_id, (v, r) => `${r?.instance_nom || 'Séance'} du ${date(r?.date_seance)}`, (a, b) => b.n - a.n),
      resultat: compte((r) => r.resultat, (v) => RESULTATS[v] || v),
      annee: compte((r) => (r.date_seance ? new Date(r.date_seance).getFullYear() : null), (v) => String(v), (a, b) => b.valeur - a.valeur),
    };
  }

  async function extraits(rows, an, tsq, elu) {
    if (!rows.length) return new Map();
    const p = [rows.map((r) => r.id)];
    const col = elu ? 'si.contenu_public' : 'si.contenu';
    const q = tsq ? (p.push(tsq), `to_tsquery('fr_unaccent', $${p.length})`) : null;
    const res = await db.all(
      `SELECT si.acte_id, ${q
        ? `ts_headline('fr_unaccent', ${col}, ${q}, 'StartSel=[[m]],StopSel=[[/m]],MaxFragments=2,MaxWords=28,MinWords=9,FragmentDelimiter= … ,HighlightAll=false')`
        : `left(${col}, 260)`} AS extrait FROM search_index si WHERE si.acte_id = ANY($1::int[])`, p);
    return new Map(res.map((r) => [r.acte_id, surligne(r.extrait || '')]));
  }

  async function chercher(org, f, portee) {
    const t0 = Date.now();
    const { rows: brutes, an, tsq, approchee } = await lignes(org, f, portee);
    const elu = !!portee.elu;
    const lib = await libelles(org, brutes);
    const fac = facettes(brutes, lib);
    let liste = brutes;
    if (f.annee) liste = liste.filter((r) => r.date_seance && new Date(r.date_seance).getFullYear() === f.annee);
    if (f.tri === 'date') liste = [...liste].sort((a, b) => new Date(b.date_seance || b.created_at) - new Date(a.date_seance || a.created_at) || b.id - a.id);
    const limit = f.limit || 20; const offset = f.offset || 0;
    const page = liste.slice(offset, offset + limit);
    const ex = await extraits(page, an, tsq, elu);
    const out = {
      total: liste.length, tronque: brutes.length >= PLAFOND, limit, offset, approchee, dureeMs: Date.now() - t0,
      items: page.map((r) => ({
        acteId: r.id, numeroSuivi: r.numero_suivi, numero: r.numero || null, titre: r.titre, statut: r.statut, extrait: ex.get(r.id) || '',
        type: lib.ref(r.type_id), nature: lib.ref(r.nature_id), matiere: lib.ref(r.matiere_id), rubrique: lib.ref(r.rubrique_id), rapporteur: lib.elu(r.rapporteur_id),
        direction: r.direction_label || r.direction_code, seanceId: cle(r, 'seance_id'), itemId: cle(r, 'item_id'), instance: cle(r, 'instance_nom'), dateSeance: cle(r, 'date_seance'),
        resultat: r.resultat ? { code: r.resultat, libelle: RESULTATS[r.resultat] } : null, creeLe: r.created_at,
      })),
      facettes: fac,
    };
    // journal anonymisé (REC-12) : ni identifiant ni nom
    if (f.q && !offset) db.run('INSERT INTO search_log (organisme_id, requete, nb, espace) VALUES ($1, $2, $3, $4)', [org, String(f.q).slice(0, 200), out.total, elu ? 'elus' : 'agents']).catch(() => undefined);
    return out;
  }

  function assureCritere(f) {
    const q = String(f.q || '').trim();
    const filtre = Object.entries(f).some(([k, v]) => !['q', 'limit', 'offset', 'tri'].includes(k) && v !== undefined && v !== '');
    if (!q && !filtre) throw E.badRequest('Saisissez un mot à chercher ou choisissez un critère');
  }

  const svc = {
    analyser, reindexerActe, traiterActe, texteDuFichier, enRetard,
    /** Attend la fin des indexations en file (tests, arrêt propre). */
    async idle() { await chaine; if (reindexation && !reindexation.fin) await reindexation.promesse; },

    async chercher(ctx, organismeId, f = {}) {
      const org = requireOrg(organismeId); assureCritere(f);
      return chercher(org, f, { ctx });
    },

    /** Espace élus : délibérations adoptées de mes séances, titre / objet / dispositif seulement. */
    async chercherElu(elu, seanceIds, f = {}) {
      assureCritere(f);
      const { q, limit, offset } = f;
      return chercher(elu.organismeId, { q, limit, offset, tri: f.tri }, { elu: { seanceIds } });
    },

    async exportCsv(ctx, organismeId, f = {}) {
      const org = requireOrg(organismeId); assureCritere(f);
      const r = await chercher(org, { ...f, limit: PLAFOND, offset: 0 }, { ctx });
      const c = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['N° suivi', 'N° délibération', 'Titre', 'Statut', 'Type', 'Matière', 'Rubrique', 'Rapporteur', 'Direction', 'Séance', 'Date de séance', 'Résultat']];
      for (const i of r.items) rows.push([i.numeroSuivi, i.numero, i.titre, i.statut, i.type, i.matiere, i.rubrique, i.rapporteur, i.direction, i.instance, i.dateSeance ? new Date(i.dateSeance).toISOString().slice(0, 10) : '', i.resultat?.libelle]);
      return `${String.fromCharCode(0xfeff)}${rows.map((l) => l.map(c).join(';')).join('\r\n')}\r\n`;
    },

    /** Actes proches (REC-08) : à la création (titre + objet saisis) ou sur une fiche existante ; dans les limites des droits. */
    async similaires(ctx, organismeId, { acteId, titre, objet } = {}) {
      const org = requireOrg(organismeId);
      let texte = `${titre || ''} ${objet || ''}`;
      if (acteId) {
        const a = await db.get('SELECT titre, commentaire_initial FROM actes WHERE id = $1 AND organisme_id = $2', [acteId, org]);
        if (!a) throw E.notFound('Acte introuvable');
        texte = `${a.titre} ${a.commentaire_initial || ''}`;
      }
      const lexemes = [...new Set(mots(sansAccent(texte)).filter((m) => m.length >= 4))].slice(0, 14);
      if (!lexemes.length) return { items: [] };
      const vis = await acl.visibilitySql(ctx, org, 2);
      const p = [org, ...vis.params]; const add = (v) => { p.push(v); return `$${p.length}`; };
      const q = add(lexemes.map(lex).join(' | '));
      const ex = acteId ? `AND a.id <> ${add(acteId)}` : '';
      const rows = await db.all(
        `SELECT a.id, a.numero_suivi, a.titre, a.statut, ts_rank(si.tsv, to_tsquery('fr_unaccent', ${q})) AS rang,
                (SELECT it.numero FROM seance_items it WHERE it.acte_id = a.id AND it.statut = 'a_traiter' ORDER BY it.id DESC LIMIT 1) AS numero
         FROM search_index si JOIN actes a ON a.id = si.acte_id
         WHERE si.organisme_id = $1 AND ${vis.where} AND a.statut <> 'abandonne' ${ex} AND si.tsv @@ to_tsquery('fr_unaccent', ${q})
         ORDER BY rang DESC, a.id DESC LIMIT 6`, p);
      return { items: rows.filter((r) => r.rang > 0.02).map((r) => ({ acteId: r.id, numeroSuivi: r.numero_suivi, numero: r.numero, titre: r.titre, statut: r.statut, pertinence: Math.round(r.rang * 100) / 100 })) };
    },

    // ----------------------------------------------------------------------------------- recherches enregistrées
    async enregistrees(ctx, organismeId) {
      return (await db.all('SELECT id, nom, requete, created_at FROM search_saved WHERE organisme_id = $1 AND username = $2 ORDER BY nom', [requireOrg(organismeId), ctx.username]))
        .map((r) => ({ id: r.id, nom: r.nom, requete: r.requete, creeLe: r.created_at }));
    },
    async enregistrer(ctx, organismeId, { nom, requete }) {
      const org = requireOrg(organismeId);
      if ((await db.get('SELECT count(*)::int AS n FROM search_saved WHERE organisme_id = $1 AND username = $2', [org, ctx.username])).n >= 50) throw E.conflict('Limite de 50 recherches enregistrées atteinte');
      const r = await db.get('INSERT INTO search_saved (organisme_id, username, nom, requete) VALUES ($1,$2,$3,$4::jsonb) RETURNING id', [org, ctx.username, nom, JSON.stringify(requete)]);
      return { id: r.id, nom, requete };
    },
    async supprimerEnregistree(ctx, organismeId, id) {
      const r = await db.run('DELETE FROM search_saved WHERE id = $1 AND organisme_id = $2 AND username = $3', [id, requireOrg(organismeId), ctx.username]);
      if (!r.changes) throw E.notFound('Recherche introuvable');
      return { ok: true };
    },

    // ----------------------------------------------------------------------------------- administration (REC-09, REC-12)
    async etat(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const [actes, indexes, annexes, sans, retard, top] = await Promise.all([
        db.get('SELECT count(*)::int AS n FROM actes WHERE organisme_id = $1', [org]),
        db.get('SELECT count(*)::int AS n FROM search_index WHERE organisme_id = $1', [org]),
        db.get('SELECT count(*)::int AS n FROM search_annexes sa JOIN files f ON f.id = sa.file_id WHERE f.organisme_id = $1', [org]),
        db.get('SELECT count(*)::int AS n FROM search_annexes sa JOIN files f ON f.id = sa.file_id WHERE f.organisme_id = $1 AND sa.sans_texte', [org]),
        enRetard(org, 100000),
        db.all("SELECT requete, count(*)::int AS n, round(avg(nb))::int AS moyenne FROM search_log WHERE organisme_id = $1 AND at > now() - interval '90 days' GROUP BY requete ORDER BY n DESC LIMIT 15", [org]),
      ]);
      const sansResultat = await db.all("SELECT requete, count(*)::int AS n FROM search_log WHERE organisme_id = $1 AND nb = 0 AND at > now() - interval '90 days' GROUP BY requete ORDER BY n DESC LIMIT 15", [org]);
      return {
        actes: actes.n, indexes: indexes.n, enRetard: retard.length, annexesLues: annexes.n, annexesSansTexte: sans.n,
        reindexation: reindexation ? { enCours: !reindexation.fin, total: reindexation.total, traites: reindexation.traites, erreur: reindexation.erreur || null } : null,
        frequentes: top, sansResultat, synonymes: (await settings.resolve(org))['recherche.synonymes']?.value || '',
      };
    },

    /** Ré-indexation complète en arrière-plan (les annexes déjà lues ne sont pas relues). */
    async reindexer(ctx, organismeId) {
      const org = requireOrg(organismeId);
      if (reindexation && !reindexation.fin) return { demarre: false, message: 'Une ré-indexation est déjà en cours' };
      const ids = (await db.all('SELECT id FROM actes WHERE organisme_id = $1 ORDER BY id', [org])).map((r) => r.id);
      const etat = { total: ids.length, traites: 0, debut: new Date(), fin: null, erreur: null };
      reindexation = etat;
      etat.promesse = (async () => {
        try { for (const id of ids) { await traiterActe(id); etat.traites++; } } catch (e) { etat.erreur = e.message; log?.error?.({ err: e.message }, 'ré-indexation en erreur'); } finally { etat.fin = new Date(); }
      })();
      await audit.log(ctx, { organismeId: org, action: 'recherche.reindexation', entity: 'search_index', after: { actes: ids.length } });
      return { demarre: true, total: ids.length };
    },

    /** Rattrapage périodique : reconstruit les entrées en retard (tâche planifiée). */
    async balayer(organismeId) {
      const rows = await enRetard(requireOrg(organismeId));
      for (const r of rows) await traiterActe(r.id);
      return { n: rows.length };
    },
  };
  return svc;
}

module.exports = { createRecherche, analyser, groupesSynonymes };
