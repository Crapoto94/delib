/**
 * API externe en lecture seule (EXT-02 à EXT-04, D97). Les portées de la clé décident de ce qui est visible :
 *  - executoires : actes revenus du contrôle de légalité — métadonnées, texte adopté, PDF, annexes publiables ;
 *  - adoptes     : délibérations adoptées avant ou pendant la transmission — mêmes contenus, marqués « pas encore exécutoire » ;
 *  - encours     : actes en rédaction ou en circuit — métadonnées seulement, jamais de texte, de PDF ni d'annexe.
 * Jamais exposés : abandonnés, retirés, rejetés, ajournés ; actes confidentiels ou à huis clos ; annexes non publiables ; circuit, notes, commentaires, agents.
 */
const { E } = require('../../shared/errors');

const CATEGORIES = {
  executoires: { statuts: ['ar_recu', 'publie', 'executoire', 'archive'], etiquette: 'executoire', contenu: true },
  adoptes: { statuts: ['adopte', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis'], etiquette: 'adopte', contenu: true },
  encours: { statuts: ['brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu', 'inscrit_odj'], etiquette: 'encours', contenu: false },
};
const RESULTATS = { adopte_unanimite: 'Adoptée à l\'unanimité', adopte_majorite: 'Adoptée à la majorité', adopte_preponderante: 'Adoptée (voix prépondérante du président)', rejete: 'Rejetée', rejete_preponderante: 'Rejetée (voix prépondérante du président)' };
const SYS = (org) => ({ username: 'api-externe', kind: 'system', isPlatformAdmin: true, organismes: [], roles: [], orgIds: [org], agent: null, displayName: 'API externe' });
const categorieDe = (statut) => Object.entries(CATEGORIES).find(([, c]) => c.statuts.includes(statut))?.[0] || null;

function createExterne({ db, render, storage }) {
  /** Catégories accessibles à la clé, d'après ses portées. */
  const permises = (key) => Object.keys(CATEGORIES).filter((c) => key.portees.includes(`actes:${c}`));

  const SELECT = `
    SELECT a.id, a.numero_suivi, a.titre, a.statut, a.created_at, a.updated_at, a.organisme_id,
           t.libelle AS type, n.libelle AS nature, m.libelle AS matiere, ru.libelle AS rubrique, e.prenom AS rapp_prenom, e.nom AS rapp_nom,
           d.numero, d.seance_id, d.date_seance, d.instance_nom, d.resultat, tx.ar_at, tx.envoye_le
    FROM actes a
    LEFT JOIN ref_items t ON t.id = a.type_id LEFT JOIN ref_items n ON n.id = a.nature_id LEFT JOIN ref_items m ON m.id = a.matiere_id LEFT JOIN ref_items ru ON ru.id = a.rubrique_id
    LEFT JOIN elus e ON e.id = a.rapporteur_id
    LEFT JOIN LATERAL (
      SELECT it.numero, se.id AS seance_id, se.date_seance, i.nom AS instance_nom, sp.resultat
      FROM seance_items it JOIN seances se ON se.id = it.seance_id JOIN instances i ON i.id = se.instance_id LEFT JOIN seance_points sp ON sp.item_id = it.id
      WHERE it.acte_id = a.id AND it.statut = 'a_traiter' ORDER BY se.date_seance DESC LIMIT 1) d ON true
    LEFT JOIN LATERAL (SELECT max(x.ar_at) AS ar_at, max(x.sent_at) AS envoye_le FROM tlt_transactions x WHERE x.acte_id = a.id) tx ON true`;

  const item = (r) => ({
    id: r.id, numeroSuivi: r.numero_suivi, numeroDeliberation: r.numero || null, titre: r.titre, categorie: CATEGORIES[categorieDe(r.statut)]?.etiquette ?? null, statut: r.statut,
    type: r.type, nature: r.nature, matiere: r.matiere, rubrique: r.rubrique, rapporteur: r.rapp_nom ? `${r.rapp_prenom || ''} ${r.rapp_nom}`.trim() : null,
    seance: r.seance_id ? { id: r.seance_id, date: r.date_seance, instance: r.instance_nom } : null,
    resultat: r.resultat ? { code: r.resultat, libelle: RESULTATS[r.resultat] || r.resultat } : null,
    transmisLe: r.envoye_le || null, dateAr: r.ar_at || null, creeLe: r.created_at, majLe: r.updated_at,
  });

  const svc = {
    CATEGORIES, categorieDe,

    cle(key) { return { nom: key.nom, organismeId: key.organismeId, portees: key.portees, categoriesAccessibles: permises(key) }; },

    async lister(key, f = {}) {
      const ok = permises(key);
      if (!ok.length) throw E.forbidden('Cette clé n\'a aucun droit de lecture des actes');
      let cats = ok;
      if (f.categorie) { if (!ok.includes(f.categorie)) throw E.forbidden(`Cette clé n'a pas le droit de lire les actes « ${f.categorie} »`); cats = [f.categorie]; }
      const statuts = cats.flatMap((c) => CATEGORIES[c].statuts);
      const p = [key.organismeId, statuts]; const add = (v) => { p.push(v); return `$${p.length}`; };
      const w = ['a.organisme_id = $1', "a.confidentialite = 'normale'", 'a.statut = ANY($2::text[])'];
      if (f.annee) w.push(`extract(year FROM d.date_seance AT TIME ZONE 'Europe/Paris') = ${add(f.annee)}`);
      if (f.seanceId) w.push(`d.seance_id = ${add(f.seanceId)}`);
      if (f.type) w.push(`t.code = ${add(f.type)}`);
      if (f.matiere) w.push(`m.code = ${add(f.matiere)}`);
      if (f.q) w.push(`(a.titre ILIKE ${add(`%${String(f.q).replace(/[%_\\]/g, '\\$&')}%`)} OR a.numero_suivi::text = ${add(f.q)} OR d.numero = ${add(f.q)})`);
      if (f.modifieDepuis) w.push(`a.updated_at >= ${add(f.modifieDepuis)}`);
      const where = w.join(' AND ');
      const total = (await db.get(`SELECT count(*)::int AS n FROM actes a LEFT JOIN ref_items t ON t.id = a.type_id LEFT JOIN ref_items m ON m.id = a.matiere_id
        LEFT JOIN LATERAL (SELECT it.numero, se.id AS seance_id, se.date_seance FROM seance_items it JOIN seances se ON se.id = it.seance_id WHERE it.acte_id = a.id AND it.statut = 'a_traiter' ORDER BY se.date_seance DESC LIMIT 1) d ON true WHERE ${where}`, p)).n;
      const ordre = f.tri === 'seance' ? 'd.date_seance ASC NULLS LAST, d.numero ASC NULLS LAST, a.id' : 'a.updated_at DESC, a.id DESC';
      const limit = f.limit || 50; const offset = f.offset || 0;
      const rows = await db.all(`${SELECT} WHERE ${where} ORDER BY ${ordre} LIMIT ${add(limit)} OFFSET ${add(offset)}`, p);
      return { total, limit, offset, items: rows.map(item) };
    },

    /** Un acte : 404 s'il n'existe pas OU si la clé n'a pas le droit de le voir (on ne révèle pas son existence). */
    async charger(key, id) {
      const r = await db.get(`${SELECT} WHERE a.id = $1 AND a.organisme_id = $2 AND a.confidentialite = 'normale'`, [id, key.organismeId]);
      const cat = r && categorieDe(r.statut);
      if (!r || !cat || !permises(key).includes(cat)) throw E.notFound('Acte introuvable');
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
      return {
        ...out,
        mention: cat === 'adoptes' ? 'Délibération adoptée, pas encore exécutoire (contrôle de légalité en cours ou à venir)' : null,
        expose: txt('expose'),
        deliberations: delibs.map((d) => ({ id: d.id, ordre: d.ordre, titre: d.titre, visas: txt('visas', d.id), dispositif: txt('dispositif', d.id), pdf: `${base}/pdf?deliberationId=${d.id}` })),
        annexes: annexes.map((a) => ({ id: a.id, titre: a.titre, ordre: a.ordre, version: a.version, pages: a.pages, taille: Number(a.size), url: `${base}/annexes/${a.id}` })),
        liens: { self: base, pdf: `${base}/pdf` },
      };
    },

    /** PDF « propre » d'une délibération (par défaut la première). Jamais pour un acte en cours. */
    async pdf(key, id, deliberationId) {
      const { r, cat } = await svc.charger(key, id);
      if (!CATEGORIES[cat].contenu) throw E.forbidden('Le PDF n\'est pas disponible pour un acte en cours de rédaction');
      const d = deliberationId
        ? await db.get('SELECT id FROM deliberations WHERE id = $1 AND acte_id = $2', [deliberationId, id])
        : await db.get('SELECT id FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id LIMIT 1', [id]);
      if (!d) throw E.notFound('Délibération introuvable');
      const out = await render.renderActe(SYS(r.organisme_id), r.organisme_id, id, { cible: 'deliberation', deliberationId: d.id, mode: 'propre', watermark: '' });
      return { buffer: out.buffer, name: `deliberation-${r.numero || r.numero_suivi}.pdf` };
    },

    /** Annexe publiable d'un acte exécutoire ou adopté. */
    async annexe(key, id, annexeId) {
      const { cat } = await svc.charger(key, id);
      if (!CATEGORIES[cat].contenu) throw E.forbidden('Les annexes ne sont pas disponibles pour un acte en cours de rédaction');
      const a = await db.get('SELECT x.titre, f.storage_key, f.original_name FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.id = $1 AND x.acte_id = $2 AND x.publiable', [annexeId, id]);
      if (!a) throw E.notFound('Annexe introuvable');
      return { buffer: await storage.get(a.storage_key), name: a.original_name };
    },
  };
  return svc;
}

module.exports = { createExterne, CATEGORIES };
