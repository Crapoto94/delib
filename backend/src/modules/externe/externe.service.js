/**
 * API externe en lecture seule (EXT-02 à EXT-04, D97). Les portées de la clé décident de ce qui est visible :
 *  - executoires : actes revenus du contrôle de légalité — métadonnées, texte adopté, PDF, annexes publiables ;
 *  - adoptes     : délibérations adoptées avant ou pendant la transmission — mêmes contenus, marqués « pas encore exécutoire » ;
 *  - encours     : actes en rédaction ou en circuit — métadonnées seulement, jamais de texte, de PDF ni d'annexe.
 * Jamais exposés : abandonnés, retirés, rejetés, ajournés ; actes confidentiels ou à huis clos ; annexes non publiables ; circuit, notes, commentaires, agents.
 */
const { E } = require('../../shared/errors');
const { createJetons } = require('./jeton');

const CATEGORIES = {
  executoires: { statuts: ['ar_recu', 'publie', 'executoire', 'archive'], etiquette: 'executoire', contenu: true },
  adoptes: { statuts: ['adopte', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis'], etiquette: 'adopte', contenu: true },
  encours: { statuts: ['brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu', 'inscrit_odj'], etiquette: 'encours', contenu: false },
};
const RESULTATS = { adopte_unanimite: 'Adoptée à l\'unanimité', adopte_majorite: 'Adoptée à la majorité', adopte_preponderante: 'Adoptée (voix prépondérante du président)', rejete: 'Rejetée', rejete_preponderante: 'Rejetée (voix prépondérante du président)' };
const SYS = (org) => ({ username: 'api-externe', kind: 'system', isPlatformAdmin: true, organismes: [], roles: [], orgIds: [org], agent: null, displayName: 'API externe' });
const categorieDe = (statut) => Object.entries(CATEGORIES).find(([, c]) => c.statuts.includes(statut))?.[0] || null;

function createExterne({ db, render, storage, config }) {
  const jetons = createJetons(config?.jwt?.secret);
  /** Catégories accessibles à la clé, d'après ses portées. */
  /** Contenus téléchargeables de la clé ; une clé ancienne (sans réglage) expose tout. */
  const contenus = (key) => ({ acte: true, expose: true, annexes: true, ...(key.contenus || {}) });
  const permises = (key) => Object.keys(CATEGORIES).filter((c) => key.portees.includes(`actes:${c}`));

  const SELECT = `
    SELECT a.id, a.numero_suivi, a.titre, a.statut, a.created_at, a.updated_at, a.organisme_id, a.rapporteur_id, a.custom,
           t.code AS type_code, t.libelle AS type, n.libelle AS nature, m.libelle AS matiere, ru.libelle AS rubrique, e.prenom AS rapp_prenom, e.nom AS rapp_nom,
           d.numero, d.seance_id, d.date_seance, d.instance_nom, d.resultat, tx.ar_at, tx.envoye_le
    FROM actes a
    LEFT JOIN ref_items t ON t.id = a.type_id LEFT JOIN ref_items n ON n.id = a.nature_id LEFT JOIN ref_items m ON m.id = a.matiere_id LEFT JOIN ref_items ru ON ru.id = a.rubrique_id
    LEFT JOIN elus e ON e.id = a.rapporteur_id
    LEFT JOIN LATERAL (
      SELECT it.numero, se.id AS seance_id, se.date_seance, i.nom AS instance_nom, sp.resultat
      FROM seance_items it JOIN seances se ON se.id = it.seance_id JOIN instances i ON i.id = se.instance_id LEFT JOIN seance_points sp ON sp.item_id = it.id
      WHERE it.acte_id = a.id AND it.statut = 'a_traiter' ORDER BY se.date_seance DESC LIMIT 1) d ON true
    LEFT JOIN LATERAL (SELECT max(x.ar_at) AS ar_at, max(x.sent_at) AS envoye_le FROM tlt_transactions x WHERE x.acte_id = a.id) tx ON true`;

  /** FROM commun aux listes de choix (type t, matière m, dernière séance d). */
  const DEPUIS = `FROM actes a LEFT JOIN ref_items t ON t.id = a.type_id LEFT JOIN ref_items m ON m.id = a.matiere_id
    LEFT JOIN LATERAL (SELECT it.numero, se.id AS seance_id, se.date_seance, i.nom AS instance_nom FROM seance_items it JOIN seances se ON se.id = it.seance_id JOIN instances i ON i.id = se.instance_id WHERE it.acte_id = a.id AND it.statut = 'a_traiter' ORDER BY se.date_seance DESC LIMIT 1) d ON true`;

  /** Annexes servies en PDF : le PDF de consultation déjà produit (Word converti), sinon le fichier s'il est lui-même un PDF. Aucune conversion à la demande. */
  const ANNEXES_PDF = `SELECT x.acte_id, x.id, x.titre, COALESCE(pf.storage_key, f.storage_key) AS storage_key, COALESCE(pf.original_name, f.original_name) AS original_name
    FROM annexes x JOIN files f ON f.id = x.file_id LEFT JOIN files pf ON pf.id = x.pdf_file_id AND pf.mime = 'application/pdf'`;
  const SEUL_PDF = "(pf.id IS NOT NULL OR f.mime = 'application/pdf')";
  const item = (r) => ({
    id: r.id, numeroSuivi: r.numero_suivi, numeroDeliberation: r.numero || null, titre: r.titre, categorie: CATEGORIES[categorieDe(r.statut)]?.etiquette ?? null, statut: r.statut,
    type: r.type, typeCode: r.type_code, nature: r.nature, matiere: r.matiere, rubrique: r.rubrique, motsCles: Array.isArray(r.custom?.motsCles) ? r.custom.motsCles : [],
    rapporteur: r.rapp_nom ? { id: r.rapporteur_id, nom: `${r.rapp_prenom || ''} ${r.rapp_nom}`.trim() } : null,
    seance: r.seance_id ? { id: r.seance_id, date: r.date_seance, instance: r.instance_nom } : null,
    resultat: r.resultat ? { code: r.resultat, libelle: RESULTATS[r.resultat] || r.resultat } : null,
    transmisLe: r.envoye_le || null, dateAr: r.ar_at || null, creeLe: r.created_at, majLe: r.updated_at,
  });

  const svc = {
    CATEGORIES, categorieDe,

    cle(key) { return { nom: key.nom, organismeId: key.organismeId, portees: key.portees, categoriesAccessibles: permises(key), types: key.types || [], dureeMois: key.dureeMois ?? 24, contenus: contenus(key) }; },

    /** Cadre commun à toutes les lectures : organisme, catégories permises, actes non confidentiels, types et durée de la clé. */
    cadre(key, cats) {
      const p = [key.organismeId, cats.flatMap((c) => CATEGORIES[c].statuts)]; const add = (v) => { p.push(v); return `$${p.length}`; };
      const w = ['a.organisme_id = $1', "a.confidentialite = 'normale'", 'a.statut = ANY($2::text[])'];
      if (key.types?.length) w.push(`t.code = ANY(${add(key.types)}::text[])`);
      w.push(`COALESCE(d.date_seance, a.created_at) >= now() - make_interval(months => ${add(key.dureeMois ?? 24)})`);
      return { p, w, add };
    },
    categories(key, categorie) {
      const ok = permises(key);
      if (!ok.length) throw E.forbidden('Cette clé n\'a aucun droit de lecture des actes');
      if (categorie) { if (!ok.includes(categorie)) throw E.forbidden(`Cette clé n'a pas le droit de lire les actes « ${categorie} »`); return [categorie]; }
      return ok;
    },

    async lister(key, f = {}) {
      const { p, w, add } = svc.cadre(key, svc.categories(key, f.categorie));
      if (f.annee) w.push(`extract(year FROM d.date_seance AT TIME ZONE 'Europe/Paris') = ${add(f.annee)}`);
      if (f.seanceId) w.push(`d.seance_id = ${add(f.seanceId)}`);
      if (f.type) w.push(`t.code = ${add(f.type)}`);
      if (f.matiere) w.push(`m.code = ${add(f.matiere)}`);
      if (f.rapporteurId) w.push(`a.rapporteur_id = ${add(f.rapporteurId)}`);
      if (f.dateDebut) w.push(`(COALESCE(d.date_seance, a.created_at) AT TIME ZONE 'Europe/Paris')::date >= ${add(f.dateDebut)}::date`);
      if (f.dateFin) w.push(`(COALESCE(d.date_seance, a.created_at) AT TIME ZONE 'Europe/Paris')::date <= ${add(f.dateFin)}::date`);
      if (f.motCle) {
        const mot = add(String(f.motCle).trim());
        w.push(`(EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.custom->'motsCles') = 'array' THEN a.custom->'motsCles' ELSE '[]'::jsonb END) k WHERE unaccent(lower(k)) = unaccent(lower(${mot})))
          OR unaccent(lower(COALESCE(m.libelle, ''))) = unaccent(lower(${mot})))`);
      }
      // Recherche plein texte dans le titre (lexèmes français sans accents) ; à défaut, sous-chaîne sans accents ; n° de suivi ou n° de délibération exact.
      if (f.q) {
        const q = add(String(f.q).trim()); const like = add(`%${String(f.q).trim().replace(/[%_\\]/g, '\\$&')}%`);
        w.push(`(to_tsvector('fr_unaccent', a.titre) @@ websearch_to_tsquery('fr_unaccent', ${q}) OR unaccent(a.titre) ILIKE unaccent(${like}) OR a.numero_suivi::text = ${q} OR d.numero = ${q})`);
      }
      if (f.modifieDepuis) w.push(`a.updated_at >= ${add(f.modifieDepuis)}`);
      const where = w.join(' AND ');
      const total = (await db.get(`SELECT count(*)::int AS n ${DEPUIS} WHERE ${where}`, p)).n;
      const ordre = f.tri === 'seance_desc' ? 'd.date_seance DESC NULLS LAST, d.numero ASC NULLS LAST, a.id DESC' : f.tri === 'seance' ? 'd.date_seance ASC NULLS LAST, d.numero ASC NULLS LAST, a.id' : 'a.updated_at DESC, a.id DESC';
      const limit = f.limit || 50; const offset = f.offset || 0;
      const rows = await db.all(`${SELECT} WHERE ${where} ORDER BY ${ordre} LIMIT ${add(limit)} OFFSET ${add(offset)}`, p);
      return { total, limit, offset, items: rows.map((r) => item(r)) };
    },

    /** Conseils passés dont au moins un acte est visible avec cette clé : liste de choix pour `seanceId`. */
    async seances(key, f = {}) {
      const { p, w } = svc.cadre(key, svc.categories(key, f.categorie));
      w.push('d.seance_id IS NOT NULL', 'd.date_seance <= now()');
      const rows = await db.all(`SELECT d.seance_id AS id, d.date_seance, d.instance_nom, count(*)::int AS nb_actes ${DEPUIS} WHERE ${w.join(' AND ')} GROUP BY d.seance_id, d.date_seance, d.instance_nom ORDER BY d.date_seance DESC`, p);
      return { items: rows.map((r) => ({ id: r.id, date: r.date_seance, instance: r.instance_nom, nbActes: r.nb_actes })) };
    },

    /** Rapporteurs (élus) des actes visibles avec cette clé : liste de choix pour `rapporteurId`. */
    async rapporteurs(key, f = {}) {
      const { p, w } = svc.cadre(key, svc.categories(key, f.categorie));
      w.push('a.rapporteur_id IS NOT NULL');
      const rows = await db.all(`SELECT e.id, e.prenom, e.nom, count(*)::int AS nb_actes ${DEPUIS} JOIN elus e ON e.id = a.rapporteur_id WHERE ${w.join(' AND ')} GROUP BY e.id, e.prenom, e.nom ORDER BY e.nom, e.prenom`, p);
      return { items: rows.map((r) => ({ id: r.id, nom: `${r.prenom || ''} ${r.nom}`.trim(), nbActes: r.nb_actes })) };
    },

    /** Types d'actes visibles avec cette clé : liste de choix pour `type`. */
    async types(key, f = {}) {
      const { p, w } = svc.cadre(key, svc.categories(key, f.categorie));
      const rows = await db.all(`SELECT t.code, t.libelle, count(*)::int AS nb_actes ${DEPUIS} WHERE ${w.join(' AND ')} AND t.code IS NOT NULL GROUP BY t.code, t.libelle ORDER BY t.libelle`, p);
      return { items: rows.map((r) => ({ code: r.code, libelle: r.libelle, nbActes: r.nb_actes })) };
    },

    // ------------------------------------------------------------------------------------------------ publication sans authentification (page publique de la DMZ)
    /** Clé « publique » interne : exécutoires seulement, acte et annexes publiables, JAMAIS l'exposé des motifs. Ne sort jamais du serveur. */
    clePublique(organismeId, mois) {
      return { id: 0, nom: 'publication', organismeId, portees: ['actes:executoires'], types: [], dureeMois: Math.min(24, Math.max(1, Number(mois) || 6)), contenus: { acte: true, expose: false, annexes: true } };
    },

    /** Délibérations exécutoires des derniers mois, de la plus récente à la plus ancienne. Aucun identifiant interne : les liens sont des jetons chiffrés. */
    async publication(organismeId, mois, { limit = 20, offset = 0 } = {}) {
      const key = svc.clePublique(organismeId, mois);
      const l = await svc.lister(key, { categorie: 'executoires', tri: 'seance_desc', limit, offset });
      const ids = l.items.map((i) => i.id);
      const annexes = ids.length ? await db.all(`${ANNEXES_PDF} WHERE x.acte_id = ANY($1::int[]) AND x.publiable AND ${SEUL_PDF} ORDER BY x.ordre, x.id`, [ids]) : [];
      const lien = (j) => `/api/v1/public/deliberations/f/${j}`;
      return {
        mois: key.dureeMois, total: l.total, limit: l.limit, offset: l.offset,
        items: l.items.map((i) => ({
          numero: i.numeroDeliberation, titre: i.titre, type: i.type, matiere: i.matiere, rapporteur: i.rapporteur?.nom ?? null,
          seance: i.seance ? { date: i.seance.date, instance: i.seance.instance } : null, resultat: i.resultat?.libelle ?? null,
          pdf: lien(jetons.creer({ type: 'p', acteId: i.id })),
          annexes: annexes.filter((a) => a.acte_id === i.id).map((a) => ({ titre: a.titre, url: lien(jetons.creer({ type: 'a', acteId: i.id, annexeId: a.id })) })),
        })),
      };
    },

    /** Document désigné par un lien public (jeton) : délibération ou annexe ; 404 si le jeton est invalide ou hors du périmètre publié. */
    async documentPublic(organismeId, mois, jeton) {
      const j = jetons.lire(jeton);
      if (!j) throw E.notFound('Document introuvable');
      const key = svc.clePublique(organismeId, mois);
      return j.type === 'p' ? svc.pdf(key, j.acteId) : svc.annexe(key, j.acteId, j.annexeId);
    },

    /** Un acte : 404 s'il n'existe pas OU si la clé n'a pas le droit de le voir (on ne révèle pas son existence). */
    async charger(key, id) {
      const r = await db.get(`${SELECT} WHERE a.id = $1 AND a.organisme_id = $2 AND a.confidentialite = 'normale'`, [id, key.organismeId]);
      const cat = r && categorieDe(r.statut);
      const debut = new Date(); debut.setMonth(debut.getMonth() - (key.dureeMois ?? 24));
      const horsPerimetre = r && ((key.types?.length && !key.types.includes(r.type_code)) || new Date(r.date_seance || r.created_at) < debut);
      if (!r || !cat || !permises(key).includes(cat) || horsPerimetre) throw E.notFound('Acte introuvable');
      return { r, cat };
    },

    async detail(key, id) {
      const { r, cat } = await svc.charger(key, id);
      const out = item(r);
      if (!CATEGORIES[cat].contenu) return out; // en cours : métadonnées seulement
      const base = `/api/v1/externe/actes/${id}`;
      const textes = await db.all('SELECT kind, deliberation_id, markdown FROM tracked_texts WHERE acte_id = $1', [id]);
      const delibs = await db.all('SELECT id, ordre, titre FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [id]);
      const txt = (kind, delib) => textes.find((t) => t.kind === kind && (kind === 'expose' ? true : t.deliberation_id === delib))?.markdown || '';
      const annexes = await db.all('SELECT x.id, x.titre, x.ordre, x.version, f.pages, f.size FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.acte_id = $1 AND x.publiable ORDER BY x.ordre, x.id', [id]);
      // Ce que la clé a le droit d'exposer (paramétrage de la clé) : l'acte seul, l'exposé des motifs, les annexes.
      const ct = contenus(key);
      const rep = { ...out, mention: cat === 'adoptes' ? 'Délibération adoptée, pas encore exécutoire (contrôle de légalité en cours ou à venir)' : null, liens: { self: base } };
      if (ct.acte) {
        rep.deliberations = delibs.map((d) => ({ id: d.id, ordre: d.ordre, titre: d.titre, visas: txt('visas', d.id), dispositif: txt('dispositif', d.id), pdf: `${base}/pdf?deliberationId=${d.id}` }));
        rep.liens.pdf = `${base}/pdf`;
      }
      if (ct.expose) { rep.expose = txt('expose'); rep.liens.expose = `${base}/expose`; }
      if (ct.annexes) rep.annexes = annexes.map((a) => ({ id: a.id, titre: a.titre, ordre: a.ordre, version: a.version, pages: a.pages, taille: Number(a.size), url: `${base}/annexes/${a.id}` }));
      return rep;
    },

    /** PDF de l'exposé des motifs (si la clé expose les exposés). */
    async expose(key, id) {
      const { r, cat } = await svc.charger(key, id);
      if (!CATEGORIES[cat].contenu) throw E.forbidden('L\'exposé des motifs n\'est pas disponible pour un acte en cours de rédaction');
      if (!contenus(key).expose) throw E.forbidden('Cette clé n\'a pas le droit de télécharger l\'exposé des motifs');
      const out = await render.renderActe(SYS(r.organisme_id), r.organisme_id, id, { cible: 'expose', mode: 'propre', watermark: '' });
      return { buffer: out.buffer, name: `expose-${r.numero || r.numero_suivi}.pdf` };
    },

    /** PDF « propre » d'une délibération (par défaut la première). Jamais pour un acte en cours. */
    async pdf(key, id, deliberationId) {
      const { r, cat } = await svc.charger(key, id);
      if (!CATEGORIES[cat].contenu) throw E.forbidden('Le PDF n\'est pas disponible pour un acte en cours de rédaction');
      if (!contenus(key).acte) throw E.forbidden('Cette clé n\'a pas le droit de télécharger l\'acte');
      const d = deliberationId
        ? await db.get('SELECT id FROM deliberations WHERE id = $1 AND acte_id = $2', [deliberationId, id])
        : await db.get('SELECT id FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id LIMIT 1', [id]);
      if (!d) throw E.notFound('Délibération introuvable');
      const nom = `deliberation-${r.numero || r.numero_suivi}.pdf`;
      // 1. le document signé revenu du parapheur ; 2. le PDF de la délibération déjà figé ; 3. le document source joint (PDF).
      // Aucune conversion Word -> PDF à la demande : ce qui est publié est le document déjà produit.
      const signe = await render.documentSigne(r.organisme_id, id).catch(() => null);
      if (signe) return { buffer: signe.buffer, name: nom };
      const fige = await db.get(`SELECT f.storage_key FROM actes_documents_figes g JOIN files f ON f.id = g.file_id
        WHERE g.acte_id = $1 AND g.cible = 'deliberation' AND g.deliberation_id IS NOT DISTINCT FROM $2 ORDER BY g.id DESC LIMIT 1`, [id, d.id]);
      if (fige) return { buffer: await storage.get(fige.storage_key), name: nom };
      const acte = await db.get('SELECT document_source_pdf_file_id FROM actes WHERE id = $1', [id]);
      if (acte?.document_source_pdf_file_id) return { ...(await render.sourcePdf(acte)), name: nom };
      // Dernier recours (aucun document figé) : composition du PDF ; en cas d'échec (conversion indisponible), document non disponible.
      try {
        const out = await render.renderActe(SYS(r.organisme_id), r.organisme_id, id, { cible: 'deliberation', deliberationId: d.id, mode: 'propre', watermark: '' });
        return { buffer: out.buffer, name: nom };
      } catch (e) { throw E.notFound('Document non disponible'); }
    },

    /** Annexe publiable d'un acte exécutoire ou adopté. */
    async annexe(key, id, annexeId) {
      const { cat } = await svc.charger(key, id);
      if (!CATEGORIES[cat].contenu) throw E.forbidden('Les annexes ne sont pas disponibles pour un acte en cours de rédaction');
      if (!contenus(key).annexes) throw E.forbidden('Cette clé n\'a pas le droit de télécharger les annexes');
      const a = await db.get(`${ANNEXES_PDF} WHERE x.id = $1 AND x.acte_id = $2 AND x.publiable AND ${SEUL_PDF}`, [annexeId, id]);
      if (!a) throw E.notFound('Annexe introuvable');
      return { buffer: await storage.get(a.storage_key), name: a.original_name };
    },
  };
  return svc;
}

module.exports = { createExterne, CATEGORIES };
