/**
 * Bandeau d'information : messages que le SCC ou l'administrateur affiche, en défilement rouge, à tous les utilisateurs (agents et élus) entre deux dates.
 * Un message est affiché s'il est actif et si l'instant présent est dans [début, fin].
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const toBandeau = (r) => {
  const now = Date.now(); const d = new Date(r.debut).getTime(); const f = new Date(r.fin).getTime();
  return {
    id: r.id, message: r.message, debut: r.debut, fin: r.fin, actif: r.actif, creePar: r.created_by, creeLe: r.created_at, modifiePar: r.updated_by ?? null,
    etat: !r.actif ? 'desactive' : now < d ? 'programme' : now > f ? 'termine' : 'en_cours',
  };
};

function createBandeaux({ db, audit }) {
  const dateOu = (v, nom) => { const t = new Date(v); if (!v || Number.isNaN(t.getTime())) throw E.badRequest(`${nom} invalide`); return t; };
  const verifier = (b, cur = {}) => {
    const message = String(b.message ?? cur.message ?? '').replace(/\s+/g, ' ').trim();
    if (message.length < 3 || message.length > 500) throw E.badRequest('Le message doit faire de 3 à 500 caractères');
    const debut = dateOu(b.debut ?? cur.debut, 'La date de début'); const fin = dateOu(b.fin ?? cur.fin, 'La date de fin');
    if (fin <= debut) throw E.badRequest('La date de fin doit être postérieure à la date de début');
    return { message, debut: debut.toISOString(), fin: fin.toISOString(), actif: b.actif ?? cur.actif ?? true };
  };

  const svc = {
    /** Messages à afficher maintenant (tous les utilisateurs). */
    async actifs(organismeId) {
      const rows = await db.all('SELECT * FROM bandeaux_info WHERE organisme_id = $1 AND actif AND debut <= now() AND fin >= now() ORDER BY debut, id', [requireOrg(organismeId)]);
      return { items: rows.map((r) => ({ id: r.id, message: r.message, fin: r.fin })) };
    },

    /** Tous les messages, y compris programmés et terminés (administration). */
    async lister(organismeId) {
      return { items: (await db.all('SELECT * FROM bandeaux_info WHERE organisme_id = $1 ORDER BY fin DESC, id DESC LIMIT 200', [requireOrg(organismeId)])).map(toBandeau) };
    },

    async creer(ctx, organismeId, b) {
      const org = requireOrg(organismeId); const v = verifier(b);
      const r = await db.get('INSERT INTO bandeaux_info (organisme_id, message, debut, fin, actif, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [org, v.message, v.debut, v.fin, v.actif, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'bandeau.creation', entity: 'bandeaux_info', entityId: r.id, after: { message: v.message, debut: v.debut, fin: v.fin, actif: v.actif } });
      return toBandeau(r);
    },

    async modifier(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const cur = await db.get('SELECT * FROM bandeaux_info WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!cur) throw E.notFound('Message introuvable');
      const v = verifier(b, cur);
      const r = await db.get('UPDATE bandeaux_info SET message = $3, debut = $4, fin = $5, actif = $6, updated_by = $7 WHERE id = $1 AND organisme_id = $2 RETURNING *', [id, org, v.message, v.debut, v.fin, v.actif, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'bandeau.modification', entity: 'bandeaux_info', entityId: id, before: { message: cur.message, debut: cur.debut, fin: cur.fin, actif: cur.actif }, after: v });
      return toBandeau(r);
    },

    async supprimer(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const r = await db.get('DELETE FROM bandeaux_info WHERE id = $1 AND organisme_id = $2 RETURNING *', [id, org]);
      if (!r) throw E.notFound('Message introuvable');
      await audit.log(ctx, { organismeId: org, action: 'bandeau.suppression', entity: 'bandeaux_info', entityId: id, before: { message: r.message } });
      return { id, supprime: true };
    },
  };
  return svc;
}

module.exports = { createBandeaux };
