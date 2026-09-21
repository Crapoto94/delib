/**
 * Organisation (organigramme) : liste des directions et services = organigramme du Hub DSI FUSIONNÉ avec les surcharges
 * locales (organisation_entites : ajouter une direction/service absent, corriger un libellé). Rafraîchissement depuis le Hub.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

function createOrganigramme({ db, dir, audit }) {
  const svc = {
    async list(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const [hub, locaux] = await Promise.all([
        dir.hubDirections().catch(() => []),
        db.all('SELECT * FROM organisation_entites WHERE organisme_id = $1 ORDER BY ordre, label', [org]),
      ]);
      const hubDir = new Map(hub.map((d) => [d.code, d]));
      const localDir = new Map(); const localSvc = new Map();
      for (const e of locaux) { if (e.type === 'direction') localDir.set(e.code, e); else localSvc.set(`${e.parent_code}|${e.code}`, e); }
      const items = hub.map((d) => {
        const ld = localDir.get(d.code);
        return {
          code: d.code, id: ld?.id ?? null, label: ld?.label || d.label, actif: ld ? ld.actif : true,
          source: ld ? 'mixte' : 'hub',
          services: (d.services || []).map((s) => {
            const e = localSvc.get(`${d.code}|${s.code}`);
            return { code: s.code, id: e?.id ?? null, label: e?.label || s.label, actif: e ? e.actif : true, source: e ? 'mixte' : 'hub' };
          }),
        };
      });
      // directions purement locales
      for (const e of locaux.filter((x) => x.type === 'direction' && !hubDir.has(x.code))) {
        items.push({
          code: e.code, id: e.id, label: e.label, actif: e.actif, source: 'local',
          services: locaux.filter((s) => s.type === 'service' && s.parent_code === e.code).map((s) => ({ code: s.code, id: s.id, label: s.label, actif: s.actif, source: 'local' })),
        });
      }
      // services locaux rattachés à une direction du Hub
      for (const s of locaux.filter((x) => x.type === 'service' && hubDir.has(x.parent_code))) {
        const d = items.find((x) => x.code === s.parent_code);
        if (d && !d.services.some((y) => y.code === s.code)) d.services.push({ code: s.code, id: s.id, label: s.label, actif: s.actif, source: 'local' });
      }
      items.sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr'));
      const masquees = items.filter((d) => !d.actif).length + items.reduce((n, d) => n + d.services.filter((s) => !s.actif).length, 0);
      return { items, resume: { directions: items.length, services: items.reduce((n, d) => n + d.services.length, 0), locales: locaux.length, masquees } };
    },

    /** Met à jour l'organigramme depuis le Hub DSI (vide le cache) et renvoie la liste fusionnée. */
    async rafraichir(ctx, organismeId) {
      const org = requireOrg(organismeId);
      await dir.hubDirections({ force: true }).catch(() => null);
      await dir.organisationChart().catch(() => null);
      await audit.log(ctx, { organismeId: org, action: 'organisation.rafraichir', entity: 'organisation' });
      return svc.list(ctx, org);
    },

    /**
     * Ajoute, **renomme** ou **masque** une direction/service (surcharge locale, `actif`). Le libellé peut être omis
     * pour masquer une entité du Hub qui a déjà une surcharge (on garde le libellé existant).
     */
    async ajouter(ctx, organismeId, { type, code, label, parentCode, ordre, actif }) {
      const org = requireOrg(organismeId);
      if (!['direction', 'service'].includes(type)) throw E.badRequest('Type attendu : direction ou service');
      const c = String(code || '').trim().toUpperCase().slice(0, 40);
      if (!c) throw E.badRequest('Code obligatoire');
      const exist = await db.get('SELECT label FROM organisation_entites WHERE organisme_id = $1 AND type = $2 AND code = $3', [org, type, c]);
      const l = String(label ?? exist?.label ?? '').trim().slice(0, 200);
      if (!l) throw E.badRequest('Libellé obligatoire');
      if (type === 'service' && !String(parentCode || '').trim()) throw E.badRequest('Un service doit être rattaché à une direction');
      const on = actif === undefined ? true : !!actif;
      const r = await db.get(
        `INSERT INTO organisation_entites (organisme_id, type, code, label, parent_code, ordre, actif, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (organisme_id, type, code) DO UPDATE SET label = EXCLUDED.label, parent_code = EXCLUDED.parent_code, ordre = EXCLUDED.ordre, actif = EXCLUDED.actif, updated_at = now() RETURNING *`,
        [org, type, c, l, type === 'service' ? String(parentCode).trim().toUpperCase() : null, Number(ordre) || 0, on, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'organisation.entite', entity: 'organisation_entites', entityId: r.id, after: { type, code: c, label: l, actif: on } });
      return svc.list(ctx, org);
    },

    async modifier(ctx, organismeId, id, body) {
      const org = requireOrg(organismeId);
      const e = await db.get('SELECT * FROM organisation_entites WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!e) throw E.notFound('Entité locale introuvable');
      const label = body.label !== undefined ? String(body.label).trim().slice(0, 200) : e.label;
      const ordre = body.ordre !== undefined ? Number(body.ordre) || 0 : e.ordre;
      const actif = body.actif !== undefined ? !!body.actif : e.actif;
      await db.run('UPDATE organisation_entites SET label = $3, ordre = $4, actif = $5, updated_at = now() WHERE id = $1 AND organisme_id = $2', [id, org, label, ordre, actif]);
      await audit.log(ctx, { organismeId: org, action: 'organisation.entite.modif', entity: 'organisation_entites', entityId: id, after: { label, ordre, actif } });
      return svc.list(ctx, org);
    },

    async supprimer(ctx, organismeId, id) {
      const org = requireOrg(organismeId);
      const e = await db.get('SELECT * FROM organisation_entites WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!e) throw E.notFound('Entité locale introuvable');
      await db.run('DELETE FROM organisation_entites WHERE id = $1 AND organisme_id = $2', [id, org]);
      await audit.log(ctx, { organismeId: org, action: 'organisation.entite.suppr', entity: 'organisation_entites', entityId: id, before: { type: e.type, code: e.code } });
      return svc.list(ctx, org);
    },
  };
  return svc;
}

module.exports = { createOrganigramme };
