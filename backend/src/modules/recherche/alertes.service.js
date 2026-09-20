/**
 * Alertes de recherche (REC-29, D98). Une recherche enregistrée peut prévenir son auteur quand de nouveaux actes correspondent.
 * La vérification se fait avec les DROITS DE LA PERSONNE (jamais ceux du système) : un acte qu'elle ne peut pas voir ne déclenche rien.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const NUM = ['typeId', 'natureId', 'matiereId', 'rubriqueId', 'rapporteurId', 'seanceId', 'annee'];
const TXT = ['statut', 'directionCode', 'resultat', 'du', 'au'];
const MAX_VUS = 5000;

/** Critères d'une recherche enregistrée → paramètres du moteur (seuls les critères connus passent). */
function criteres(requete) {
  const r = requete || {}; const f = {};
  if (typeof r.q === 'string' && r.q.trim()) f.q = r.q.trim().slice(0, 300);
  for (const k of NUM) if (r[k] !== undefined && r[k] !== '' && Number.isInteger(Number(r[k]))) f[k] = Number(r[k]);
  for (const k of TXT) if (typeof r[k] === 'string' && r[k]) f[k] = r[k];
  for (const k of ['annexes', 'incidence']) if (r[k] === 'true' || r[k] === true) f[k] = true; else if (r[k] === 'false' || r[k] === false) f[k] = false;
  return f;
}

function createAlertes({ db, access, recherche, log, notifications, config }) {
  const ids = async (ctx, org, requete) => {
    const f = criteres(requete);
    if (!Object.keys(f).length) return { ids: [], items: [], total: 0 };
    const r = await recherche.chercher(ctx, org, { ...f, tri: 'date', limit: 100, offset: 0 });
    return { ids: r.items.map((i) => i.acteId), items: r.items, total: r.total };
  };

  const svc = {
    criteres,

    /** État des alertes de l'utilisateur : par recherche enregistrée. */
    async etat(ctx, organismeId) {
      const rows = await db.all('SELECT id, alerte, alerte_mail, derniere_verif FROM search_saved WHERE organisme_id = $1 AND username = $2', [requireOrg(organismeId), ctx.username]);
      return { items: rows.map((r) => ({ id: r.id, alerte: r.alerte, alerteMail: r.alerte_mail, derniereVerif: r.derniere_verif })) };
    },

    /** Active ou coupe l'alerte : à l'activation, les résultats du moment sont mémorisés (aucun déluge de notifications). */
    /** « Me prévenir aussi par e-mail » (facultatif) : ne concerne qu'une recherche dont l'alerte est active. */
    async basculerMail(ctx, organismeId, id, actif) {
      const org = requireOrg(organismeId);
      const s = await db.get('SELECT alerte FROM search_saved WHERE id = $1 AND organisme_id = $2 AND username = $3', [id, org, ctx.username]);
      if (!s) throw E.notFound('Recherche introuvable');
      if (actif && !s.alerte) throw E.badRequest('Activez d\'abord l\'alerte de cette recherche');
      if (actif && !ctx.email) throw E.badRequest('Aucune adresse e-mail n\'est connue pour votre compte');
      await db.run('UPDATE search_saved SET alerte_mail = $2 WHERE id = $1', [id, !!actif]);
      return { id, alerteMail: !!actif };
    },

    async basculer(ctx, organismeId, id, actif) {
      const org = requireOrg(organismeId);
      const s = await db.get('SELECT * FROM search_saved WHERE id = $1 AND organisme_id = $2 AND username = $3', [id, org, ctx.username]);
      if (!s) throw E.notFound('Recherche introuvable');
      if (!actif) { await db.run("UPDATE search_saved SET alerte = false, alerte_mail = false, vus = '[]'::jsonb WHERE id = $1", [id]); return { id, alerte: false }; }
      if (!Object.keys(criteres(s.requete)).length) throw E.badRequest('Cette recherche n\'a aucun critère : une alerte n\'aurait pas de sens');
      const r = await ids(ctx, org, s.requete);
      await db.run('UPDATE search_saved SET alerte = true, vus = $2::jsonb, derniere_verif = now() WHERE id = $1', [id, JSON.stringify(r.ids)]);
      return { id, alerte: true, memorises: r.ids.length };
    },

    /**
     * Tâche planifiée : pour chaque alerte non vérifiée depuis une heure, cherche avec les droits de son auteur ; s'il y a du nouveau,
     * crée une notification dans l'application. Un échec sur une alerte n'arrête pas les autres. Renvoie le nombre de notifications créées.
     */
    async verifier(organismeId, { forcer = false } = {}) {
      const org = requireOrg(organismeId); let envoyees = 0;
      const rows = await db.all(`SELECT * FROM search_saved WHERE organisme_id = $1 AND alerte ${forcer ? '' : "AND (derniere_verif IS NULL OR derniere_verif < now() - interval '1 hour')"} ORDER BY id`, [org]);
      for (const s of rows) {
        try {
          const ctx = await access.loadContext(s.username);
          const r = await ids(ctx, org, s.requete);
          const vus = new Set(s.vus || []);
          const nouveaux = r.items.filter((i) => !vus.has(i.acteId));
          if (nouveaux.length) {
            const liste = nouveaux.slice(0, 3).map((i) => `« ${i.titre} »`).join(', ');
            const titre = `${nouveaux.length === 1 ? '1 nouvel acte correspond' : `${nouveaux.length} nouveaux actes correspondent`} à « ${s.nom} »`;
            await db.run('INSERT INTO notifications (organisme_id, username, family, rule_code, acte_id, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
              [org, s.username, 'recherche', 'recherche.alerte', nouveaux.length === 1 ? nouveaux[0].acteId : null, titre, `${liste}${nouveaux.length > 3 ? '…' : ''}`, `/recherche?${new URLSearchParams(Object.entries(criteres(s.requete)).map(([k, v]) => [k, String(v)])).toString()}`]);
            envoyees++;
            if (s.alerte_mail && ctx.email && notifications) { // même message par e-mail, à l'adresse de la personne (le mode recette redirige, comme pour les autres mails)
              const lien = `${config?.publicBaseUrl ?? ''}/recherche?${new URLSearchParams(Object.entries(criteres(s.requete)).map(([k, v]) => [k, String(v)])).toString()}`;
              await notifications.sendMail(org, ctx.email, titre, `${liste}${nouveaux.length > 3 ? '…' : ''}\n${lien}`).catch((e) => log?.warn?.({ err: e.message, recherche: s.id }, "alerte de recherche : e-mail non envoyé"));
            }
          }
          const tous = [...new Set([...(s.vus || []), ...r.ids])].slice(-MAX_VUS);
          await db.run('UPDATE search_saved SET vus = $2::jsonb, derniere_verif = now() WHERE id = $1', [s.id, JSON.stringify(tous)]);
        } catch (e) { log?.warn?.({ err: e.message, recherche: s.id }, 'alerte de recherche en échec'); await db.run('UPDATE search_saved SET derniere_verif = now() WHERE id = $1', [s.id]).catch(() => undefined); }
      }
      return envoyees;
    },
  };
  return svc;
}

module.exports = { createAlertes, criteres };
