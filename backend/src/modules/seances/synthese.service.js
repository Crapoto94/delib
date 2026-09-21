/**
 * Synthèse de la liste des séances (SEA-15, D108) : pour chaque séance affichée, les indicateurs de la carte (compte à rebours, dossiers instruits,
 * directions en retard, étape du workflow), et le bandeau du haut de page. Réservé à l'administration et au SCC (comme les indicateurs de séance).
 */
const { requireOrg } = require('../../db/pool');

function createSynthese({ db, kpis, parcours }) {
  const jours = (d) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null);
  return {
    async resume(ctx, organismeId, ids) {
      const org = requireOrg(organismeId); const liste = [...new Set(ids)].slice(0, 40);
      const items = await Promise.all(liste.map(async (id) => {
        try {
          const [k, p] = await Promise.all([kpis.get(ctx, org, id), parcours.get(ctx, org, id)]);
          const etape = p.etapes.find((e) => e.etat === 'en_cours') || null;
          const cloture = k.compteARebours.jalons.find((j) => j.code === 'redaction') || null;
          return {
            seanceId: id, jours: k.compteARebours.jours, cloture: cloture ? { date: cloture.date, jours: cloture.jours, passe: cloture.passe } : null, jalons: k.compteARebours.jalons,
            dossiers: k.avancement.total, prets: k.avancement.prets, dansOdj: k.avancement.dansOdj, tauxRealisation: k.avancement.tauxRealisation,
            aTerminer: k.aTerminer.total, enRetard: k.aTerminer.enRetard, directionsEnRetard: k.directions.enRetard,
            directionsATerminer: k.directions.items.filter((d) => d.aTerminer > 0).length,
            etape: etape ? { cle: etape.cle, label: etape.label, retient: etape.retient } : null, terminee: !!p.terminee,
          };
        } catch { return { seanceId: id, indisponible: true }; }
      }));
      // bandeau : actes en instruction et prochaine clôture des dépôts
      const enInstruction = items.reduce((n, x) => n + (x.aTerminer || 0), 0);
      const clotures = items.filter((x) => x.cloture && !x.cloture.passe).sort((a, b) => a.cloture.jours - b.cloture.jours);
      const prochaine = clotures[0] || null;
      const nom = prochaine ? (await db.get('SELECT i.nom FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1', [prochaine.seanceId]))?.nom : null;
      const tlt = await db.get("SELECT count(*) FILTER (WHERE etat = 'poste' AND ar_id IS NULL AND status NOT IN (0, 6, -1))::int AS sans_ar, count(*) FILTER (WHERE etat = 'prepare')::int AS a_envoyer FROM tlt_transactions WHERE organisme_id = $1", [org]);
      return { items, bandeau: { actesEnInstruction: enInstruction, prochaineCloture: prochaine ? { seanceId: prochaine.seanceId, jours: prochaine.cloture.jours, instance: nom, date: prochaine.cloture.date } : null, transmissionsSansAr: tlt.sans_ar, transmissionsAEnvoyer: tlt.a_envoyer } };
    },
    jours,
  };
}

module.exports = { createSynthese };
