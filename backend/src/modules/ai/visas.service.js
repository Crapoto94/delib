/**
 * Références juridiques vérifiées PAR LE CODE (lot 5c-1, D101) :
 *  - bibliothèque de visas (IA-38) : textes normalisés, statut, validité, dernière vérification — maintenue par le juridique, fournie vide ;
 *  - listes de contrôle (IA-32) : visa attendu / mention attendue, par type d'acte et matière ;
 *  - rapport d'un dossier (IA-30, 31, 35, 36) : références extraites, rapprochées de la bibliothèque À LA DATE DE LA SÉANCE ;
 *  - veille (IA-38) : un texte qui devient abrogé ou modifié prévient les rédacteurs des actes en cours qui le citent.
 * Aucun droit n'est affirmé de mémoire (IA-05) : une référence absente de la bibliothèque est « à faire vérifier », jamais « fausse ».
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const R = require('./references');

const TYPES = ['code', 'loi', 'ordonnance', 'decret', 'arrete', 'autre'];
const STATUTS = ['en_vigueur', 'modifie', 'abroge'];
const GRAVITES = ['bloquant', 'a_revoir', 'info'];
const EN_COURS = ['brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu', 'inscrit_odj', 'texte_definitif_pret', 'pret_a_transmettre'];
const MOIS_DEFAUT = 12;
const LIB_STATUT = { en_vigueur: 'en vigueur', modifie: 'modifié', abroge: 'abrogé' };

const toEntry = (r) => ({
  id: r.id, cle: r.cle, type: r.type, code: r.code, article: r.article, intitule: r.intitule, statut: r.statut, dateDebut: r.date_debut, dateFin: r.date_fin,
  verifieLe: r.verifie_le, verifiePar: r.verifie_par, source: r.source, note: r.note, matieres: r.matieres, typesActe: r.types_acte, updatedAt: r.updated_at,
});
const toControle = (r) => ({
  id: r.id, nom: r.nom, typeActeId: r.type_acte_id, matiereId: r.matiere_id, regle: r.regle, cle: r.cle, motif: r.motif, estRegex: r.est_regex,
  montantMin: r.montant_min === null ? null : Number(r.montant_min), gravite: r.gravite, message: r.message, actif: r.actif,
});
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const frDate = (d) => (iso(d) ? R.dateFr(iso(d)) : null);

/** Clé de bibliothèque normalisée : « CGCT:l2121-29 » → « cgct:L2121-29 » ; « LOI:2015-991 » → « loi:2015-991 ». */
function normaliserCle(cle) {
  const p = String(cle || '').trim().replace(/[‑–—]/g, '-').split(':').map((x) => x.trim()).filter(Boolean);
  if (!p.length || !/^[a-z0-9][a-z0-9-]*$/i.test(p[0])) throw E.badRequest('Clé invalide : attendu « code:ARTICLE » (cgct:L2121-29), « loi:2015-991 » ou un code seul (ccp)');
  const t = p[0].toLowerCase();
  if (['loi', 'ordonnance', 'decret', 'arrete'].includes(t)) { if (p.length !== 2 || !/^[a-z0-9.-]+$/i.test(p[1])) throw E.badRequest(`Clé invalide pour un texte (${t}) : « ${t}:2015-991 »`); return `${t}:${p[1].toLowerCase()}`; }
  if (p.length === 1) return t;
  if (p.length !== 2 || !/^[LRD]?\d[0-9A-Za-z.-]*$/i.test(p[1])) throw E.badRequest('Clé invalide : l\'article doit ressembler à L2121-29');
  return `${t}:${p[1].toUpperCase()}`;
}

/** Lecture tolérante d'un CSV (séparateur ; ou ,, guillemets doubles) → tableau d'objets d'après la ligne d'en-tête. */
function lireCsv(texte) {
  const lignes = String(texte || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lignes.length < 2) return [];
  const sep = (lignes[0].match(/;/g) || []).length >= (lignes[0].match(/,/g) || []).length ? ';' : ',';
  const decoupe = (l) => { const out = []; let cur = ''; let q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()); };
  const cols = decoupe(lignes[0]).map((c) => c.toLowerCase().replace(/[^a-z_]/g, ''));
  return lignes.slice(1).map((l) => Object.fromEntries(decoupe(l).map((v, i) => [cols[i], v])));
}
const CHAMPS_CSV = { cle: 'cle', type: 'type', code: 'code', article: 'article', intitule: 'intitule', statut: 'statut', date_debut: 'dateDebut', datedebut: 'dateDebut', date_fin: 'dateFin', datefin: 'dateFin', verifie_le: 'verifieLe', verifiele: 'verifieLe', source: 'source', note: 'note' };

function createVisas({ db, audit, actes, settings, log }) {
  const clean = (b, cur = {}) => {
    const o = { ...cur };
    if (b.cle !== undefined) o.cle = normaliserCle(b.cle);
    if (b.type !== undefined) { if (!TYPES.includes(b.type)) throw E.badRequest(`Type inconnu : ${b.type}`); o.type = b.type; }
    for (const k of ['code', 'article', 'source', 'note']) if (b[k] !== undefined) o[k] = b[k] === null || b[k] === '' ? null : String(b[k]).trim().slice(0, 500);
    if (b.intitule !== undefined) o.intitule = String(b.intitule).trim().slice(0, 500);
    if (b.statut !== undefined) { if (!STATUTS.includes(b.statut)) throw E.badRequest(`Statut inconnu : ${b.statut}`); o.statut = b.statut; }
    for (const k of ['dateDebut', 'dateFin', 'verifieLe']) if (b[k] !== undefined) { const v = b[k] === null || b[k] === '' ? null : String(b[k]).slice(0, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw E.badRequest(`Date invalide (${k}) : attendu AAAA-MM-JJ`); o[k] = v; }
    for (const k of ['matieres', 'typesActe']) if (b[k] !== undefined) o[k] = [...new Set((b[k] || []).map(Number).filter(Number.isInteger))];
    if (!o.cle) throw E.badRequest('La clé est obligatoire');
    if (!o.intitule) throw E.badRequest('L\'intitulé est obligatoire');
    if (o.dateDebut && o.dateFin && o.dateFin < o.dateDebut) throw E.badRequest('La date de fin précède la date de début');
    // le code et l'article se déduisent de la clé quand ils ne sont pas donnés
    const [c, a] = o.cle.split(':');
    if (!['loi', 'ordonnance', 'decret', 'arrete'].includes(c)) { o.code = o.code || c; if (a) o.article = o.article || a; if (!o.type) o.type = 'code'; }
    if (!o.type) o.type = ['loi', 'ordonnance', 'decret', 'arrete'].includes(c) ? c : 'autre';
    return o;
  };

  const validite = async (orgId) => { const v = Number((await settings.resolve(orgId))['ai.verif_validite_mois']?.value); return Number.isFinite(v) && v >= 0 ? v : MOIS_DEFAUT; };

  /** Statut d'une référence par rapport à une entrée de la bibliothèque, à la date `ref` (AAAA-MM-JJ). */
  function jauger(e, ref, mois, ajd) {
    const fin = iso(e.date_fin); const debut = iso(e.date_debut); const nom = `« ${e.intitule} »`;
    if (e.statut === 'abroge' || (fin && fin < ref)) return { etat: 'obsolete', gravite: 'bloquant', message: `${nom} est ${e.statut === 'abroge' ? 'abrogé' : 'hors de sa période de validité'}${fin ? ` (fin de validité : ${frDate(fin)})` : ''} : à remplacer ou à retirer des visas.` };
    if (debut && debut > ref) return { etat: 'a_revoir', gravite: 'a_revoir', message: `${nom} n'est pas encore en vigueur à la date de la séance (à partir du ${frDate(debut)}).` };
    if (e.statut === 'modifie') return { etat: 'a_revoir', gravite: 'a_revoir', message: `${nom} a été modifié : vérifiez que la version citée est celle applicable à la date de la séance.` };
    const v = iso(e.verifie_le);
    if (mois > 0) {
      const limite = new Date(`${ajd}T00:00:00Z`); limite.setUTCMonth(limite.getUTCMonth() - mois);
      if (!v) return { etat: 'a_revoir', gravite: 'a_revoir', message: `${nom} n'a jamais été vérifié par le juridique.` };
      if (v < limite.toISOString().slice(0, 10)) return { etat: 'a_revoir', gravite: 'a_revoir', message: `${nom} n'a pas été vérifié depuis plus de ${mois} mois (dernière vérification : ${frDate(v)}).` };
    }
    return { etat: 'a_jour', gravite: null, message: null };
  }

  const svc = {
    TYPES, STATUTS, EN_COURS, normaliserCle, lireCsv,

    // -------------------------------------------------------------------------------------------------- bibliothèque (IA-38)
    async list(organismeId, { q, statut, type } = {}) {
      const org = requireOrg(organismeId); const p = [org]; const w = ['organisme_id = $1'];
      if (statut) { p.push(statut); w.push(`statut = $${p.length}`); }
      if (type) { p.push(type); w.push(`type = $${p.length}`); }
      if (q) { p.push(`%${String(q).trim().toLowerCase()}%`); w.push(`(lower(cle) LIKE $${p.length} OR lower(intitule) LIKE $${p.length})`); }
      return (await db.all(`SELECT * FROM visa_library WHERE ${w.join(' AND ')} ORDER BY code NULLS LAST, cle`, p)).map(toEntry);
    },

    async get(organismeId, id) {
      const r = await db.get('SELECT * FROM visa_library WHERE id = $1 AND organisme_id = $2', [id, requireOrg(organismeId)]);
      if (!r) throw E.notFound('Entrée introuvable');
      return r;
    },

    async create(ctx, organismeId, body) {
      const org = requireOrg(organismeId); const o = clean(body);
      if (await db.get('SELECT 1 AS x FROM visa_library WHERE organisme_id = $1 AND cle = $2', [org, o.cle])) throw E.conflict(`« ${o.cle} » figure déjà dans la bibliothèque`);
      const r = await db.get(`INSERT INTO visa_library (organisme_id, cle, type, code, article, intitule, statut, date_debut, date_fin, verifie_le, verifie_par, source, note, matieres, types_acte, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [org, o.cle, o.type, o.code ?? null, o.article ?? null, o.intitule, o.statut || 'en_vigueur', o.dateDebut ?? null, o.dateFin ?? null, o.verifieLe ?? null, o.verifieLe ? ctx.username : null, o.source ?? null, o.note ?? null, o.matieres || [], o.typesActe || [], ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'visa.creation', entity: 'visa_library', entityId: r.id, after: { cle: o.cle, statut: r.statut } });
      return toEntry(r);
    },

    async update(ctx, organismeId, id, body) {
      const org = requireOrg(organismeId); const cur = await svc.get(org, id);
      const o = clean({ ...body, cle: body.cle ?? cur.cle }, {
        type: cur.type, code: cur.code, article: cur.article, intitule: cur.intitule, statut: cur.statut, dateDebut: iso(cur.date_debut), dateFin: iso(cur.date_fin), verifieLe: iso(cur.verifie_le),
        source: cur.source, note: cur.note, matieres: cur.matieres, typesActe: cur.types_acte,
      });
      if (o.cle !== cur.cle && (await db.get('SELECT 1 AS x FROM visa_library WHERE organisme_id = $1 AND cle = $2 AND id <> $3', [org, o.cle, id]))) throw E.conflict(`« ${o.cle} » figure déjà dans la bibliothèque`);
      const verifie = body.verifieLe !== undefined;
      const r = await db.get(`UPDATE visa_library SET cle=$3, type=$4, code=$5, article=$6, intitule=$7, statut=$8, date_debut=$9, date_fin=$10, verifie_le=$11, verifie_par=CASE WHEN $12 THEN $13 ELSE verifie_par END,
        source=$14, note=$15, matieres=$16, types_acte=$17 WHERE id=$1 AND organisme_id=$2 RETURNING *`,
      [id, org, o.cle, o.type, o.code ?? null, o.article ?? null, o.intitule, o.statut, o.dateDebut ?? null, o.dateFin ?? null, o.verifieLe ?? null, verifie, ctx.username, o.source ?? null, o.note ?? null, o.matieres || [], o.typesActe || []]);
      await audit.log(ctx, { organismeId: org, action: 'visa.modification', entity: 'visa_library', entityId: id, before: { cle: cur.cle, statut: cur.statut }, after: { cle: r.cle, statut: r.statut } });
      const veille = cur.statut !== r.statut && (r.statut === 'abroge' || r.statut === 'modifie') ? await svc.veille(ctx, org, r) : null;
      return { ...toEntry(r), veille };
    },

    async remove(ctx, organismeId, id) {
      const org = requireOrg(organismeId); const cur = await svc.get(org, id);
      await db.run('DELETE FROM visa_library WHERE id = $1 AND organisme_id = $2', [id, org]);
      await audit.log(ctx, { organismeId: org, action: 'visa.suppression', entity: 'visa_library', entityId: id, before: { cle: cur.cle } });
      return { id, deleted: true };
    },

    /** « Vérifié aujourd'hui » : le juridique atteste avoir contrôlé le texte à la source. */
    async marquerVerifie(ctx, organismeId, id) {
      const org = requireOrg(organismeId); await svc.get(org, id);
      const r = await db.get('UPDATE visa_library SET verifie_le = CURRENT_DATE, verifie_par = $3 WHERE id = $1 AND organisme_id = $2 RETURNING *', [id, org, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'visa.verification', entity: 'visa_library', entityId: id, after: { cle: r.cle } });
      return toEntry(r);
    },

    /** Import en masse (JSON : tableau d'entrées ; CSV : en-tête cle;type;code;article;intitule;statut;date_debut;date_fin;verifie_le;source). Crée ou met à jour par clé. */
    async importer(ctx, organismeId, { format, contenu }) {
      const org = requireOrg(organismeId);
      let lignes;
      if (format === 'csv') lignes = lireCsv(contenu).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [CHAMPS_CSV[k] || k, v === '' ? undefined : v])));
      else { try { lignes = JSON.parse(contenu); } catch { throw E.badRequest('JSON illisible'); } if (!Array.isArray(lignes)) throw E.badRequest('Le JSON doit être un tableau d\'entrées'); }
      if (lignes.length > 2000) throw E.badRequest('Import limité à 2000 entrées');
      let crees = 0; let maj = 0; const erreurs = [];
      for (const [i, l] of lignes.entries()) {
        try {
          const cle = normaliserCle(l.cle); const ex = await db.get('SELECT id FROM visa_library WHERE organisme_id = $1 AND cle = $2', [org, cle]);
          if (ex) { await svc.update(ctx, org, ex.id, { ...l, cle }); maj++; } else { await svc.create(ctx, org, { ...l, cle }); crees++; }
        } catch (e) { erreurs.push({ ligne: i + 1, cle: l?.cle ?? null, erreur: e.message }); }
      }
      await audit.log(ctx, { organismeId: org, action: 'visa.import', entity: 'visa_library', after: { crees, maj, erreurs: erreurs.length } });
      return { crees, maj, erreurs };
    },

    // ------------------------------------------------------------------------------------------------ actes concernés / veille
    /** Actes EN COURS dont un texte cite l'entrée (clé identique). */
    async concernes(organismeId, entree) {
      const org = requireOrg(organismeId); const e = typeof entree === 'number' ? await svc.get(org, entree) : entree;
      const rows = await db.all(`SELECT t.id, t.kind, t.markdown, a.id AS acte_id, a.numero_suivi, a.titre, a.statut, a.redacteur
        FROM tracked_texts t JOIN actes a ON a.id = t.acte_id WHERE a.organisme_id = $1 AND a.statut = ANY($2::text[]) ORDER BY a.id`, [org, EN_COURS]);
      const par = new Map();
      for (const t of rows) {
        const hit = R.extraire({ id: t.id, kind: t.kind, markdown: t.markdown }).find((r) => r.cle === e.cle);
        if (hit && !par.has(t.acte_id)) par.set(t.acte_id, { acteId: t.acte_id, numeroSuivi: t.numero_suivi, titre: t.titre, statut: t.statut, redacteur: t.redacteur, extrait: hit.extrait });
      }
      return [...par.values()];
    },

    /** Notifie les rédacteurs des actes en cours qui citent un texte devenu abrogé ou modifié. */
    async veille(ctx, organismeId, entree) {
      const org = requireOrg(organismeId); const concernes = await svc.concernes(org, entree);
      for (const c of concernes) {
        const titre = `Texte ${LIB_STATUT[entree.statut]} cité dans « ${c.titre} »`;
        await db.run('INSERT INTO notifications (organisme_id, username, family, rule_code, acte_id, title, body) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [org, c.redacteur, 'visa', 'visa.veille', c.acteId, titre, `« ${entree.intitule} » est désormais ${LIB_STATUT[entree.statut]} dans la bibliothèque de visas. Vérifiez les visas du dossier (Assistant › Vérifier les références).`]);
      }
      return { actesConcernes: concernes.length };
    },

    // ------------------------------------------------------------------------------------------------ listes de contrôle (IA-32)
    async controles(organismeId) {
      return (await db.all('SELECT * FROM visa_controles WHERE organisme_id = $1 ORDER BY nom, id', [requireOrg(organismeId)])).map(toControle);
    },

    async creerControle(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      if (b.regle === 'visa') b = { ...b, cle: normaliserCle(b.cle) };
      if (b.regle === 'mention' && b.estRegex) { try { new RegExp(b.motif, 'i'); } catch { throw E.badRequest('Expression régulière invalide'); } }
      const r = await db.get(`INSERT INTO visa_controles (organisme_id, nom, type_acte_id, matiere_id, regle, cle, motif, est_regex, montant_min, gravite, message, actif, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [org, b.nom, b.typeActeId ?? null, b.matiereId ?? null, b.regle, b.regle === 'visa' ? b.cle : null, b.regle === 'mention' ? b.motif : null, !!b.estRegex, b.montantMin ?? null, b.gravite || 'a_revoir', b.message || null, b.actif !== false, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'visa.controle.creation', entity: 'visa_controles', entityId: r.id, after: { nom: r.nom, regle: r.regle } });
      return toControle(r);
    },

    async modifierControle(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const cur = await db.get('SELECT * FROM visa_controles WHERE id = $1 AND organisme_id = $2', [id, org]); if (!cur) throw E.notFound('Contrôle introuvable');
      const regle = b.regle ?? cur.regle; const cle = b.cle !== undefined ? (b.cle ? normaliserCle(b.cle) : null) : cur.cle; const motif = b.motif !== undefined ? b.motif : cur.motif; const estRegex = b.estRegex ?? cur.est_regex;
      if (regle === 'visa' && !cle) throw E.badRequest('La règle « visa attendu » demande une clé de la bibliothèque');
      if (regle === 'mention' && !motif) throw E.badRequest('La règle « mention attendue » demande une expression');
      if (regle === 'mention' && estRegex) { try { new RegExp(motif, 'i'); } catch { throw E.badRequest('Expression régulière invalide'); } }
      const has = (k) => b[k] !== undefined;
      const r = await db.get(`UPDATE visa_controles SET nom=$3, type_acte_id=$4, matiere_id=$5, regle=$6, cle=$7, motif=$8, est_regex=$9, montant_min=$10, gravite=$11, message=$12, actif=$13 WHERE id=$1 AND organisme_id=$2 RETURNING *`,
        [id, org, b.nom ?? cur.nom, has('typeActeId') ? b.typeActeId : cur.type_acte_id, has('matiereId') ? b.matiereId : cur.matiere_id, regle, regle === 'visa' ? cle : null, regle === 'mention' ? motif : null, estRegex,
          has('montantMin') ? b.montantMin : cur.montant_min, b.gravite ?? cur.gravite, has('message') ? b.message : cur.message, b.actif ?? cur.actif]);
      await audit.log(ctx, { organismeId: org, action: 'visa.controle.modification', entity: 'visa_controles', entityId: id, after: { nom: r.nom, actif: r.actif } });
      return toControle(r);
    },

    async supprimerControle(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const r = await db.get('DELETE FROM visa_controles WHERE id = $1 AND organisme_id = $2 RETURNING id', [id, org]); if (!r) throw E.notFound('Contrôle introuvable');
      await audit.log(ctx, { organismeId: org, action: 'visa.controle.suppression', entity: 'visa_controles', entityId: id });
      return { id, deleted: true };
    },

    // ---------------------------------------------------------------------------------------------------- rapport d'un dossier
    /**
     * Rapport de vérification des références d'un acte (IA-30, 31, 32, 35, 36). N'écrit rien.
     * Renvoie { dateReference, bibliotheque, references: [{..., etat, source}], constats: [{ gravite, categorie, message, extrait, textId, cle, etat }] }.
     */
    async rapport(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId); const org = a.organisme_id;
      const textes = await db.all("SELECT id, kind, markdown FROM tracked_texts WHERE acte_id = $1 ORDER BY CASE kind WHEN 'visas' THEN 0 WHEN 'expose' THEN 1 ELSE 2 END, id", [a.id]);
      const seance = await db.get("SELECT (date_seance AT TIME ZONE 'Europe/Paris')::date AS d FROM seances WHERE id = COALESCE($1::int, $2::int)", [a.seance_id ?? null, a.seance_visee_id ?? null]);
      const ajd = new Date().toISOString().slice(0, 10); const ref = iso(seance?.d) || ajd;
      const mois = await validite(org);
      const lib = new Map((await db.all('SELECT * FROM visa_library WHERE organisme_id = $1', [org])).map((e) => [e.cle, e]));
      const codesConnus = new Set([...lib.values()].map((e) => e.code).filter(Boolean));
      const refs = textes.flatMap((t) => R.extraire(t));
      const constats = []; const add = (c) => constats.push({ categorie: 'visa', ...c });

      if (!lib.size && refs.length) add({ gravite: 'info', message: "La bibliothèque de visas est vide : les références ne peuvent pas être vérifiées automatiquement. Le juridique peut l'alimenter dans Paramétrages › Visas et références.", extrait: null, textId: null, cle: null, etat: 'non_verifiable' });

      const seanceParDate = new Map(); const delibParNumero = new Map();
      for (const r of refs) {
        r.source = null; r.verifieLe = null;
        const pousse = (etat, gravite, message) => { r.etat = etat; if (gravite) add({ gravite, message, extrait: r.extrait, textId: r.textId, cle: r.cle, etat }); };
        if (r.type === 'delib') {
          if (r.numero) {
            if (!delibParNumero.has(r.numero)) delibParNumero.set(r.numero, await db.get(`SELECT a.id, a.titre, a.statut, sp.resultat FROM seance_items it JOIN actes a ON a.id = it.acte_id LEFT JOIN seance_points sp ON sp.item_id = it.id
              WHERE a.organisme_id = $1 AND upper(it.numero) = $2 ORDER BY it.id DESC LIMIT 1`, [org, r.numero]));
            const d = delibParNumero.get(r.numero);
            if (!d) pousse('introuvable', 'a_revoir', `La ${r.libelle} n'existe pas dans les actes de l'organisme : vérifiez le numéro.`);
            else if (d.id === a.id) pousse('a_revoir', 'a_revoir', 'Le dossier cite sa propre délibération.');
            else if (!/^adopte/.test(d.resultat || '') && !['adopte', 'executoire', 'publie', 'ar_recu', 'transmis', 'archive'].includes(d.statut)) pousse('a_revoir', 'a_revoir', `La ${r.libelle} (« ${d.titre} ») n'a pas été adoptée (statut : ${d.statut}).`);
            else { r.etat = 'a_jour'; r.source = `Acte n° ${d.id} : ${d.titre}`; }
          } else {
            if (!seanceParDate.has(r.date)) seanceParDate.set(r.date, await db.get("SELECT 1 AS x FROM seances WHERE organisme_id = $1 AND (date_seance AT TIME ZONE 'Europe/Paris')::date = $2 AND statut IN ('tenue', 'close')", [org, r.date]));
            if (!seanceParDate.get(r.date)) pousse('introuvable', 'a_revoir', `Aucune séance n'a eu lieu le ${R.dateFr(r.date)} : la ${r.libelle} est introuvable.`);
            else pousse('a_revoir', 'info', `La ${r.libelle} est citée par sa seule date : ajoutez son numéro pour qu'elle soit vérifiable.`);
          }
          continue;
        }
        if (r.type === 'article') { pousse('a_revoir', 'a_revoir', `${r.libelle} : précisez le code ou la loi qui contient cet article.`); continue; }
        if (!lib.size) { r.etat = 'non_verifiable'; continue; }
        const e = lib.get(r.cle);
        if (!e) {
          // un code cité sans article est connu dès que la bibliothèque contient au moins un de ses articles
          if (!r.article && r.type === 'code' && codesConnus.has(r.code)) { r.etat = 'a_jour'; continue; }
          pousse('introuvable', 'a_revoir', `« ${r.libelle} » ne figure pas dans la bibliothèque de visas : à faire vérifier par le juridique (existence, article, actualité).`);
          continue;
        }
        const j = jauger(e, ref, mois, ajd); r.etat = j.etat; r.source = e.source || 'Bibliothèque de visas'; r.verifieLe = iso(e.verifie_le);
        if (j.gravite) add({ gravite: j.gravite, message: j.message, extrait: r.extrait, textId: r.textId, cle: r.cle, etat: j.etat, source: r.source, verifieLe: r.verifieLe });
      }

      // ordre conventionnel (IA-35)
      for (const h of R.ordreVisas(refs)) add({ gravite: 'info', message: `Ordre des visas : « ${h.libelle} » devrait figurer avant « ${h.apres.libelle} » (ordre usuel : lois et codes, ordonnances, décrets, arrêtés, délibérations).`, extrait: h.extrait, textId: h.textId, cle: h.cle, etat: 'ordre' });

      // listes de contrôle (IA-32)
      const matieres = await svc.chaineMatiere(org, a.matiere_id);
      const regles = (await db.all('SELECT * FROM visa_controles WHERE organisme_id = $1 AND actif ORDER BY id', [org])).filter((c) =>
        (c.type_acte_id === null || c.type_acte_id === a.type_id) && (c.matiere_id === null || matieres.includes(c.matiere_id)) && (c.montant_min === null || (a.montant !== null && Number(a.montant) >= Number(c.montant_min))));
      const cles = new Set(refs.map((r) => r.cle));
      const tout = R.norm(textes.map((t) => t.markdown).join('\n'));
      const visasTxt = textes.find((t) => t.kind === 'visas');
      for (const c of regles) {
        if (c.regle === 'visa') {
          if (!cles.has(c.cle)) { const e = lib.get(c.cle); add({ gravite: c.gravite, message: c.message || `Visa attendu absent : « ${e?.intitule || c.cle} » (${c.nom}).`, extrait: null, textId: visasTxt?.id ?? null, cle: c.cle, etat: 'manquant' }); }
        } else {
          let present; try { present = c.est_regex ? new RegExp(c.motif, 'i').test(textes.map((t) => t.markdown).join('\n')) : tout.includes(R.norm(c.motif)); } catch { present = true; }
          if (!present) add({ gravite: c.gravite, message: c.message || `Mention attendue absente : « ${c.motif} » (${c.nom}).`, extrait: null, textId: null, cle: null, etat: 'mention_absente' });
        }
      }
      const rang = { bloquant: 0, a_revoir: 1, info: 2 };
      constats.sort((x, y) => rang[x.gravite] - rang[y.gravite]);
      return {
        dateReference: ref, bibliotheque: { entrees: lib.size, verifMois: mois }, references: refs.map(({ rang: _r, ...r }) => r),
        constats, resume: { bloquant: constats.filter((c) => c.gravite === 'bloquant').length, aRevoir: constats.filter((c) => c.gravite === 'a_revoir').length, info: constats.filter((c) => c.gravite === 'info').length },
      };
    },

    /** L'identifiant d'une matière et de tous ses ancêtres (une règle posée sur « Finances » vaut pour ses sous-matières). */
    async chaineMatiere(organismeId, matiereId) {
      if (!matiereId) return [];
      const out = []; let cur = await db.get('SELECT id, parent_code, organisme_id FROM ref_items WHERE id = $1', [matiereId]);
      for (let i = 0; cur && i < 10; i++) {
        out.push(cur.id);
        if (!cur.parent_code) break;
        cur = await db.get("SELECT id, parent_code, organisme_id FROM ref_items WHERE kind = 'matiere' AND code = $1 AND (organisme_id = $2 OR organisme_id IS NULL) ORDER BY organisme_id NULLS LAST LIMIT 1", [cur.parent_code, organismeId]);
      }
      return out;
    },
  };
  void log;
  return svc;
}

module.exports = { createVisas, normaliserCle, lireCsv };
