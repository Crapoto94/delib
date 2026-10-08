/**
 * Arrêtés publics (page publique en DMZ) : les arrêtés SIGNÉS et non confidentiels, qu'ils viennent du site de la Ville (actes « site »),
 * d'un arrêté déjà signé saisi dans l'application ou d'un arrêté qui a suivi son parcours. Document = le PDF de l'arrêté (signé, ou joint) ;
 * annexes publiables en PDF seulement. Les liens sont des jetons chiffrés : aucun numéro d'acte n'est exposé.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { createJetons } = require('../externe/jeton');

function createArretesPublics({ db, storage, render, config }) {
  const jetons = createJetons(config?.jwt?.secret);
  const base = '/api/v1/public/arretes';
  const lien = (j) => `${base}/f/${j}`;
  const REF = 'COALESCE(a.signe_at, a.created_at)';

  /** Arrêtés signés, publiables, avec un document ; `mois` null = sans limite de durée. */
  const cadre = (org, mois) => {
    const p = [org]; const add = (v) => { p.push(v); return `$${p.length}`; };
    const w = ["a.organisme_id = $1", "t.code = 'arrete'", "a.statut = 'signe'", "a.confidentialite = 'normale'",
      `(a.document_source_pdf_file_id IS NOT NULL OR EXISTS (SELECT 1 FROM parapheur_envois pe WHERE pe.acte_id = a.id AND pe.document_signe_file_id IS NOT NULL))`];
    if (mois !== null) w.push(`${REF} >= now() - make_interval(months => ${add(mois)})`);
    return { p, w, add };
  };
  const DEPUIS = 'FROM actes a JOIN ref_items t ON t.id = a.type_id';

  const svc = {
    async lister(organismeId, mois, { q, annee, dateDebut, dateFin, limit = 10, offset = 0 } = {}) {
      const org = requireOrg(organismeId); const { p, w, add } = cadre(org, mois);
      if (annee) w.push(`extract(year FROM ${REF} AT TIME ZONE 'Europe/Paris') = ${add(annee)}`);
      if (dateDebut) w.push(`(${REF} AT TIME ZONE 'Europe/Paris')::date >= ${add(dateDebut)}::date`);
      if (dateFin) w.push(`(${REF} AT TIME ZONE 'Europe/Paris')::date <= ${add(dateFin)}::date`);
      if (q) {
        const t = add(String(q).trim()); const like = add(`%${String(q).trim().replace(/[%_\\]/g, '\\$&')}%`);
        w.push(`(to_tsvector('fr_unaccent', a.titre) @@ websearch_to_tsquery('fr_unaccent', ${t}) OR unaccent(a.titre) ILIKE unaccent(${like})
          OR COALESCE(a.custom->'site'->>'numero', a.custom->'dejaSigne'->>'numeroArrete', '') ILIKE ${like})`);
      }
      const where = w.join(' AND ');
      const total = (await db.get(`SELECT count(*)::int AS n ${DEPUIS} WHERE ${where}`, p)).n;
      const rows = await db.all(
        `SELECT a.id, a.titre, ${REF} AS date, a.signe_par, COALESCE(a.custom->'site'->>'numero', a.custom->'dejaSigne'->>'numeroArrete') AS numero ${DEPUIS} WHERE ${where}
         ORDER BY ${REF} DESC, a.id DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`, p);
      const ids = rows.map((r) => r.id);
      const annexes = ids.length ? await db.all(
        `SELECT x.acte_id, x.id, x.titre FROM annexes x JOIN files f ON f.id = x.file_id LEFT JOIN files pf ON pf.id = x.pdf_file_id AND pf.mime = 'application/pdf'
         WHERE x.acte_id = ANY($1::int[]) AND x.publiable AND (pf.id IS NOT NULL OR f.mime = 'application/pdf') ORDER BY x.ordre, x.id`, [ids]) : [];
      return {
        mois, total, limit, offset,
        items: rows.map((r) => ({
          numero: r.numero || null, titre: r.titre, date: r.date, signataire: r.signe_par || null, pdf: lien(jetons.creer({ type: 'r', acteId: r.id })),
          annexes: annexes.filter((a) => a.acte_id === r.id).map((a) => ({ titre: a.titre, url: lien(jetons.creer({ type: 'a', acteId: r.id, annexeId: a.id })) })),
        })),
      };
    },

    /** Listes de choix du moteur de recherche : années (avec le nombre d'arrêtés). */
    async filtres(organismeId) {
      const { p, w } = cadre(requireOrg(organismeId), null);
      const rows = await db.all(`SELECT extract(year FROM ${REF} AT TIME ZONE 'Europe/Paris')::int AS annee, count(*)::int AS nb ${DEPUIS} WHERE ${w.join(' AND ')} GROUP BY 1 ORDER BY 1 DESC`, p);
      return { annees: rows.map((r) => ({ annee: r.annee, nb: r.nb })) };
    },

    /** Document désigné par un lien public : l'arrêté (PDF signé, ou document joint) ou une annexe publiable. */
    async document(organismeId, mois, jeton) {
      const org = requireOrg(organismeId); const j = jetons.lire(jeton);
      if (!j) throw E.notFound('Document introuvable');
      const { p, w, add } = cadre(org, mois);
      const a = await db.get(`SELECT a.id, a.titre, a.document_source_pdf_file_id AS src ${DEPUIS} WHERE ${w.join(' AND ')} AND a.id = ${add(j.acteId)}`, p);
      if (!a) throw E.notFound('Document introuvable');
      if (j.type === 'a') {
        const x = await db.get(`SELECT COALESCE(pf.storage_key, f.storage_key) AS storage_key, COALESCE(pf.original_name, f.original_name) AS name FROM annexes x JOIN files f ON f.id = x.file_id
          LEFT JOIN files pf ON pf.id = x.pdf_file_id AND pf.mime = 'application/pdf' WHERE x.id = $1 AND x.acte_id = $2 AND x.publiable AND (pf.id IS NOT NULL OR f.mime = 'application/pdf')`, [j.annexeId, a.id]);
        if (!x) throw E.notFound('Document introuvable');
        return { buffer: await storage.get(x.storage_key), name: x.name };
      }
      if (j.type !== 'r') throw E.notFound('Document introuvable');
      const nom = `arrete-${String(a.titre).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || a.id}.pdf`;
      const signe = await render.documentSigne(org, a.id).catch(() => null);
      if (signe) return { buffer: signe.buffer, name: nom };
      if (a.src) return { ...(await render.sourcePdf({ document_source_pdf_file_id: a.src })), name: nom };
      throw E.notFound('Document introuvable');
    },
  };
  return svc;
}

module.exports = { createArretesPublics };
