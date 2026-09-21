/**
 * Relancer les services d'une séance (SEA-16, D108) : le SCC relance d'un coup les détenteurs des dossiers qui ne sont pas terminés, direction par direction.
 * Chaque relance réutilise la relance manuelle d'un dossier (notification + e-mail). Garde-fou : un dossier déjà relancé depuis moins de
 * `seances.relance_delai_h` heures (24 par défaut) est ignoré, sauf demande contraire. Tout est journalisé.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

function createRelance({ db, audit, kpis, notifications, settings }) {
  const delai = async (org) => { const v = Number((await settings.resolve(org))['seances.relance_delai_h']?.value); return Number.isFinite(v) && v >= 0 ? v : 24; };

  /** Dossiers à relancer, regroupés par direction. `cible` : `retard` (ceux dont une échéance est dépassée) ou `tous` (tous les dossiers non terminés). */
  async function candidats(ctx, org, seanceId, cible) {
    const k = await kpis.get(ctx, org, seanceId);
    const h = await delai(org);
    const derniere = new Map((await db.all('SELECT acte_id, max(at) AS at FROM seance_relances WHERE organisme_id = $1 AND seance_id = $2 GROUP BY acte_id', [org, seanceId])).map((r) => [r.acte_id, r.at]));
    const items = k.aTerminer.items.filter((a) => cible === 'tous' || a.enRetard);
    const dirs = new Map();
    for (const a of items) {
      const d = dirs.get(a.directionCode) || { code: a.directionCode, direction: a.direction, dossiers: [] };
      const last = derniere.get(a.acteId) || null;
      d.dossiers.push({
        acteId: a.acteId, numeroSuivi: a.numeroSuivi, numero: a.numero, titre: a.titre, etat: a.etat, etape: a.etape, enRetard: a.enRetard, motifRetard: a.motifRetard,
        destinataires: a.holders?.length ? a.holders : [a.redacteur ?? null].filter(Boolean), aRedacteur: !a.holders?.length, derniereRelance: last,
        recemmentRelance: !!last && (Date.now() - new Date(last).getTime()) < h * 3600000,
      });
      dirs.set(a.directionCode, d);
    }
    return { delaiHeures: h, directions: [...dirs.values()].sort((x, y) => Number(y.dossiers.some((d) => d.enRetard)) - Number(x.dossiers.some((d) => d.enRetard)) || String(x.direction).localeCompare(String(y.direction), 'fr')), kpis: k };
  }

  return {
    /** Ce que la relance toucherait : par direction, les dossiers, leurs détenteurs, la dernière relance. */
    async apercu(ctx, organismeId, seanceId, { cible = 'retard' } = {}) {
      const org = requireOrg(organismeId); const c = await candidats(ctx, org, seanceId, cible);
      const tous = c.directions.flatMap((d) => d.dossiers);
      return { seanceId, cible, delaiHeures: c.delaiHeures, directions: c.directions, total: tous.length, enRetard: tous.filter((d) => d.enRetard).length, dejaRelances: tous.filter((d) => d.recemmentRelance).length };
    },

    /**
     * Envoie les relances. `directions` restreint à certaines directions (codes) ; `forcer` relance aussi les dossiers relancés récemment.
     * Renvoie, dossier par dossier : relancé (avec les destinataires) ou ignoré (avec la raison).
     */
    async relancer(ctx, organismeId, seanceId, { cible = 'retard', directions, message, forcer = false } = {}) {
      const org = requireOrg(organismeId); const c = await candidats(ctx, org, seanceId, cible);
      const choisies = c.directions.filter((d) => !directions?.length || directions.includes(d.code));
      if (!choisies.length) throw E.conflict(cible === 'retard' ? 'Aucun dossier en retard à relancer' : 'Aucun dossier à relancer');
      const resultats = [];
      for (const d of choisies) for (const a of d.dossiers) {
        const ligne = { acteId: a.acteId, numeroSuivi: a.numeroSuivi, titre: a.titre, direction: d.direction, relance: false, destinataires: [], raison: null };
        if (a.recemmentRelance && !forcer) { ligne.raison = `Déjà relancé il y a moins de ${c.delaiHeures} h`; resultats.push(ligne); continue; }
        try {
          const r = await notifications.remind(ctx, org, a.acteId, { message, to: a.aRedacteur ? 'redacteur' : 'holders' });
          ligne.relance = true; ligne.destinataires = r.recipients;
          await db.run('INSERT INTO seance_relances (organisme_id, seance_id, acte_id, destinataires, message, par) VALUES ($1,$2,$3,$4::jsonb,$5,$6)', [org, seanceId, a.acteId, JSON.stringify(r.recipients), message || null, ctx.username]);
        } catch (e) { ligne.raison = e.message; }
        resultats.push(ligne);
      }
      const ok = resultats.filter((x) => x.relance);
      await audit.log(ctx, { organismeId: org, action: 'seance.relance', entity: 'seances', entityId: seanceId, after: { cible, directions: choisies.map((d) => d.code), relances: ok.length, ignores: resultats.length - ok.length, forcer } });
      return { relances: ok.length, ignores: resultats.length - ok.length, personnesPrevenues: [...new Set(ok.flatMap((x) => x.destinataires))].length, items: resultats };
    },
  };
}

module.exports = { createRelance };
