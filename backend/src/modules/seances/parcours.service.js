/**
 * Workflow de la séance (SEA-13, D105) : Rédaction → Préparation → Convocation → Séance → Après la séance → Clôture.
 * L'étape se DÉDUIT DES FAITS (dossiers, ordre du jour, cahier, convocation, tenue, transmissions, GED) : personne ne coche l'avancement.
 * Chaque étape a un état (`fait`, `en_cours`, `a_venir`), une date quand elle est connue, et la liste de ce qui la retient.
 */
const { requireOrg } = require('../../db/pool');

const ETAPES = [
  { cle: 'redaction', label: 'Rédaction', lien: '' },
  { cle: 'preparation', label: 'Préparation', lien: '' },
  { cle: 'convocation', label: 'Convocation', lien: '/convocation' },
  { cle: 'seance', label: 'Séance', lien: '/suivi' },
  { cle: 'post', label: 'Après la séance', lien: '/suivi' },
  { cle: 'cloture', label: 'Clôture', lien: '' },
];
const VALIDES = ['valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu', 'inscrit_odj', 'adopte', 'rejete', 'ajourne', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis', 'ar_recu', 'publie', 'executoire', 'archive'];
const plur = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function createParcours({ db, seances }) {
  return {
    ETAPES,

    async get(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const s = await seances.get(org, seanceId); // 404 si la séance n'est pas de cet organisme
      const raw = await db.get('SELECT statut, odj_statut, date_seance, date_envoi_convocation FROM seances WHERE id = $1', [seanceId]);
      if (raw.statut === 'annulee') return { seanceId, annulee: true, etapes: ETAPES.map((e) => ({ ...e, etat: 'a_venir', date: null, retient: [] })), courante: null };

      const dossiers = await db.all("SELECT statut FROM actes WHERE organisme_id = $1 AND (seance_visee_id = $2 OR seance_id = $2) AND statut NOT IN ('abandonne', 'retire')", [org, seanceId]);
      const nonValides = dossiers.filter((d) => !VALIDES.includes(d.statut)).length;
      const odjArrete = ['arrete', 'convoque', 'tenue'].includes(raw.odj_statut);
      const cahier = await db.get("SELECT max(created_at) AS le, count(*)::int AS n FROM cahier_builds WHERE seance_id = $1 AND statut = 'done'", [seanceId]).catch(() => ({ n: 0, le: null }));
      const convoc = await db.get("SELECT max(finished_at) AS le, count(*)::int AS n FROM convocations WHERE seance_id = $1 AND statut = 'envoyee'", [seanceId]);
      const tenue = await db.get('SELECT statut, ouverte_at, close_at FROM seance_tenue WHERE seance_id = $1', [seanceId]);
      const close = tenue?.statut === 'close' || raw.statut === 'close';

      // après la séance : ce qu'il reste à faire pour les délibérations adoptées
      const adoptees = close ? await db.all("SELECT it.id, it.acte_id FROM seance_points p JOIN seance_items it ON it.id = p.item_id WHERE p.seance_id = $1 AND p.etat = 'traite' AND p.resultat LIKE 'adopte%' AND it.kind = 'deliberation' AND it.acte_id IS NOT NULL", [seanceId]) : [];
      const tx = close ? await db.all("SELECT acte_id, etat, ar_id, status FROM tlt_transactions WHERE seance_id = $1 AND etat IN ('prepare', 'poste')", [seanceId]) : [];
      const txParActe = new Map(tx.map((x) => [x.acte_id, x]));
      const aPreparer = adoptees.filter((a) => !txParActe.has(a.acte_id)).length;
      const aEnvoyer = tx.filter((x) => x.etat === 'prepare').length;
      const sansAr = tx.filter((x) => x.etat === 'poste' && !x.ar_id).length;
      const gedActif = !!(await db.get('SELECT 1 AS x FROM ged_config WHERE organisme_id = $1 AND actif', [org]));
      const gedRestant = close && gedActif ? (await db.get("SELECT count(*)::int AS n FROM ged_documents WHERE seance_id = $1 AND statut <> 'ok'", [seanceId])).n + (((await db.get('SELECT count(*)::int AS n FROM ged_documents WHERE seance_id = $1', [seanceId])).n) === 0 ? 1 : 0) : 0;

      const etapes = [
        { ...ETAPES[0], fait: dossiers.length > 0 ? nonValides === 0 || odjArrete : odjArrete, date: null,
          retient: [...(dossiers.length ? [] : ['aucun dossier ne vise encore cette séance']), ...(nonValides && !odjArrete ? [`${plur(nonValides, 'dossier pas encore validé', 'dossiers pas encore validés')}`] : [])] },
        { ...ETAPES[1], fait: odjArrete && (cahier.n > 0 || convoc.n > 0 || !!tenue), date: cahier.le,
          retient: [...(!odjArrete ? ["l'ordre du jour n'est pas arrêté"] : []), ...(odjArrete && !cahier.n && !convoc.n && !tenue ? ["le cahier de séance n'est pas construit"] : [])] },
        { ...ETAPES[2], fait: convoc.n > 0 || !!raw.date_envoi_convocation || !!tenue, date: convoc.le || raw.date_envoi_convocation,
          retient: convoc.n > 0 || raw.date_envoi_convocation || tenue ? [] : ["la convocation n'est pas envoyée"] },
        { ...ETAPES[3], fait: close, date: tenue?.close_at || (tenue ? tenue.ouverte_at : raw.date_seance),
          retient: close ? [] : tenue ? ['la séance est en cours : points et votes à clôturer'] : [`la séance n'est pas ouverte (prévue le ${new Date(raw.date_seance).toLocaleDateString('fr-FR')})`] },
        { ...ETAPES[4], fait: close && aPreparer === 0 && aEnvoyer === 0 && sansAr === 0, date: null,
          retient: !close ? [] : [...(aPreparer ? [`${plur(aPreparer, 'délibération à préparer pour le contrôle de légalité', 'délibérations à préparer pour le contrôle de légalité')}`] : []),
            ...(aEnvoyer ? [`${plur(aEnvoyer, 'transmission préparée à envoyer', 'transmissions préparées à envoyer')}`] : []), ...(sansAr ? [`${plur(sansAr, 'transmission sans accusé de réception', 'transmissions sans accusé de réception')}`] : [])] },
        { ...ETAPES[5], fait: false, date: null, retient: [] },
      ];
      etapes[5].fait = etapes[4].fait && etapes[3].fait && gedRestant === 0;
      etapes[5].retient = etapes[3].fait && etapes[4].fait && gedRestant ? ["les documents de la séance ne sont pas tous archivés en GED"] : [];
      if (!etapes[3].fait) etapes[5].retient = [];

      // l'étape courante est la première qui n'est pas faite ; les suivantes sont « à venir »
      const premiere = etapes.findIndex((e) => !e.fait);
      const out = etapes.map((e, i) => {
        const etat = premiere === -1 || i < premiere ? 'fait' : i === premiere ? 'en_cours' : 'a_venir';
        return { cle: e.cle, label: e.label, lien: e.lien, etat, date: etat === 'fait' ? e.date : null, retient: etat === 'en_cours' ? e.retient : [] };
      });
      const courante = premiere;
      return { seanceId, annulee: false, etapes: out, courante: courante === -1 ? null : out[courante].cle, terminee: courante === -1, instance: s.instance };
    },
  };
}

module.exports = { createParcours, ETAPES };
