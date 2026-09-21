/**
 * Indicateurs d'une séance (SEA-KPI) : où en est la préparation, compte à rebours, taux de réalisation, directions en retard,
 * actes à terminer (avec le détail), et avancement de chaque commission (actes terminés / prévus, compte à rebours de sa réunion).
 * Population : les dossiers qui VISENT la séance ou sont déjà à son ordre du jour (hors abandonnés, retirés, archivés).
 * Un dossier est « terminé » (prêt) quand son circuit est achevé.
 */
const { requireOrg } = require('../../db/pool');

const DAY = 86400000;
const NON_PRETS = ['brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs'];
/** État de validation : pret | en_circuit | a_corriger | brouillon (mêmes libellés que l'écran de l'ordre du jour). */
const etatOf = (statut, step) => {
  if (statut === 'modification_demandee') return 'a_corriger';
  if (statut === 'brouillon') return 'brouillon';
  if (NON_PRETS.includes(statut) || (statut === 'en_attente_scc' && step)) return 'en_circuit';
  return 'pret';
};
const jours = (date, now) => Math.ceil((new Date(date).getTime() - now) / DAY);

function createKpis({ db, odj, seances }) {
  return {
    async get(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const s = await seances.get(org, seanceId); // 404 si la séance n'est pas de cet organisme
      const now = Date.now();
      const limite = (code) => s.jalons.find((j) => j.code === code)?.date ?? null;
      const dateRedaction = limite('redaction'); const dateDgs = limite('dgs');
      const numeros = new Map();
      for (const it of (await odj.get(ctx, org, seanceId)).items) if (it.statut === 'a_traiter' && it.acte && it.numero && !numeros.has(it.acte.id)) numeros.set(it.acte.id, it.numero);

      const rows = await db.all(
        `SELECT a.id, a.numero_suivi, a.titre, a.statut, a.current_step_key, a.direction_code, a.direction_label, a.redacteur,
                i.label AS etape, i.holders, i.due_at
         FROM actes a LEFT JOIN step_instances i ON i.acte_id = a.id AND i.status = 'current'
         WHERE a.organisme_id = $1 AND (a.seance_visee_id = $2 OR a.seance_id = $2) AND a.statut NOT IN ('abandonne', 'retire', 'archive')
         ORDER BY a.numero_suivi`, [org, seanceId]);
      const dansOdj = new Set((await db.all("SELECT DISTINCT acte_id FROM seance_items WHERE seance_id = $1 AND statut = 'a_traiter' AND acte_id IS NOT NULL", [seanceId])).map((r) => r.acte_id));

      const actes = rows.map((r) => {
        const etat = etatOf(r.statut, r.current_step_key);
        const echeance = r.due_at || null;
        const retardEtape = etat !== 'pret' && !!echeance && new Date(echeance).getTime() < now;
        const retardRedaction = (etat === 'brouillon' || etat === 'a_corriger') && !!dateRedaction && new Date(dateRedaction).getTime() < now;
        const retardDgs = etat !== 'pret' && !!dateDgs && new Date(dateDgs).getTime() < now;
        return {
          acteId: r.id, numeroSuivi: r.numero_suivi, numero: numeros.get(r.id) ?? null, redacteur: r.redacteur, titre: r.titre, statut: r.statut, etat, direction: r.direction_label || r.direction_code, directionCode: r.direction_code,
          etape: r.etape || null, holders: r.holders || [], echeance, dansOdj: dansOdj.has(r.id) || r.statut === 'inscrit_odj',
          enRetard: retardEtape || retardRedaction || retardDgs,
          motifRetard: retardEtape ? 'étape en retard' : retardRedaction ? 'date limite de rédaction dépassée' : retardDgs ? 'date limite DGS dépassée' : null,
        };
      });

      const count = (e) => actes.filter((a) => a.etat === e).length;
      const total = actes.length; const prets = count('pret');
      const aTerminer = actes.filter((a) => a.etat !== 'pret');

      const dirs = new Map();
      for (const a of actes) {
        const d = dirs.get(a.directionCode) || { code: a.directionCode, direction: a.direction, total: 0, prets: 0, aTerminer: 0, enRetard: 0 };
        d.total++; if (a.etat === 'pret') d.prets++; else d.aTerminer++; if (a.enRetard) d.enRetard++;
        dirs.set(a.directionCode, d);
      }
      const directions = [...dirs.values()].sort((x, y) => y.enRetard - x.enRetard || y.aTerminer - x.aTerminer || String(x.direction).localeCompare(String(y.direction), 'fr'));

      // commissions : dossiers de la séance soumis à avis
      const ids = actes.map((a) => a.acteId);
      const byId = new Map(actes.map((a) => [a.acteId, a]));
      const coms = ids.length ? await db.all(
        `SELECT ac.commission_id, c.nom, ac.acte_id, ac.avis
         FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id
         WHERE ac.acte_id = ANY($1::int[]) AND ac.retiree_at IS NULL ORDER BY c.nom, ac.acte_id`, [ids]) : [];
      const groups = new Map();
      for (const r of coms) {
        const g = groups.get(r.commission_id) || { id: r.commission_id, nom: r.nom, prevus: 0, termines: 0, restants: [] };
        g.prevus++;
        if (r.avis) g.termines++; else g.restants.push(byId.get(r.acte_id));
        groups.set(r.commission_id, g);
      }
      const commissions = [];
      for (const g of groups.values()) {
        const next = await db.get(
          `SELECT s.id, s.date_seance FROM seances s JOIN instances i ON i.id = s.instance_id
           WHERE i.commission_id = $1 AND i.organisme_id = $2 AND s.statut <> 'annulee' AND s.date_seance >= now() ORDER BY s.date_seance LIMIT 1`, [g.id, org]);
        commissions.push({ ...g, tauxRealisation: g.prevus ? Math.round((g.termines / g.prevus) * 100) : 0,
          prochaineReunion: next ? { seanceId: next.id, date: next.date_seance, jours: jours(next.date_seance, now) } : null });
      }
      commissions.sort((a, b) => (a.prochaineReunion ? new Date(a.prochaineReunion.date).getTime() : Infinity) - (b.prochaineReunion ? new Date(b.prochaineReunion.date).getTime() : Infinity) || a.nom.localeCompare(b.nom, 'fr'));

      const jalons = s.jalons.map((j) => ({ code: j.code, label: j.label, date: j.date, passe: j.passe, jours: jours(j.date, now) }));
      const prochain = jalons.find((j) => !j.passe && j.code !== 'seance') || null;
      return {
        seance: { id: s.id, instance: s.instance ?? null, dateSeance: s.dateSeance, statut: s.statut },
        compteARebours: { jours: jours(s.dateSeance, now), date: s.dateSeance, prochainJalon: prochain, jalons },
        avancement: { total, prets, enCircuit: count('en_circuit'), aCorriger: count('a_corriger'), brouillons: count('brouillon'), dansOdj: actes.filter((a) => a.dansOdj).length, tauxRealisation: total ? Math.round((prets / total) * 100) : 100 },
        aTerminer: { total: aTerminer.length, enRetard: aTerminer.filter((a) => a.enRetard).length, items: aTerminer.sort((a, b) => Number(b.enRetard) - Number(a.enRetard) || a.numeroSuivi - b.numeroSuivi) },
        directions: { enRetard: directions.filter((d) => d.enRetard > 0).length, items: directions },
        commissions,
      };
    },
  };
}

module.exports = { createKpis, etatOf };
