/**
 * Champs personnalisés (PAR-10, D91). Les définitions sont propres à l'organisme (et éventuellement à un type d'acte) ;
 * les valeurs vivent dans `actes.custom`. Validation côté serveur : type, liste, existence de l'élu, droits de saisie par rôle et par étape,
 * caractère obligatoire (complétude) et condition d'affichage.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const KINDS = ['texte', 'nombre', 'date', 'liste', 'booleen', 'elu', 'agent'];
const vide = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

const toChamp = (r) => ({
  id: r.id, code: r.code, libelle: r.libelle, aide: r.aide, kind: r.kind, options: r.options, obligatoire: r.obligatoire, typeActeId: r.type_acte_id,
  visibleSi: r.visible_si, rolesSaisie: r.roles_saisie, etapesSaisie: r.etapes_saisie, ordre: r.ordre, actif: r.actif,
});

function createChamps({ db, audit, access }) {
  /** Une condition « champ = valeur » est satisfaite par les valeurs courantes ? */
  const visible = (def, valeurs) => !def.visible_si || String(valeurs?.[def.visible_si.champ] ?? '') === String(def.visible_si.egal ?? '');

  async function defs(org, typeActeId) {
    return db.all('SELECT * FROM champs_personnalises WHERE organisme_id = $1 AND actif AND (type_acte_id IS NULL OR type_acte_id = $2) ORDER BY ordre, id', [org, typeActeId ?? null]);
  }

  function droitDeSaisie(ctx, acte, def) {
    const roles = def.roles_saisie || []; const etapes = def.etapes_saisie || [];
    if (ctx?.isPlatformAdmin || access.rolesIn(ctx, acte.organisme_id).includes('org_admin')) return true; // l'administrateur corrige toujours
    if (roles.length) {
      const mesRoles = new Set(access.rolesIn(ctx, acte.organisme_id));
      if (acte.redacteur === ctx.username || (acte.co_redacteurs || []).includes(ctx.username)) mesRoles.add('redacteur');
      if (!roles.some((r) => mesRoles.has(r))) return false;
    }
    if (etapes.length) {
      const etape = acte.statut === 'brouillon' || !acte.current_step_key ? 'brouillon' : acte.current_step_key;
      if (!etapes.includes(etape)) return false;
    }
    return true;
  }

  async function verifie(org, def, v) {
    const bad = (m) => { throw E.badRequest(`Champ « ${def.libelle} » : ${m}`); };
    switch (def.kind) {
      case 'texte': if (typeof v !== 'string' || v.length > 2000) bad('texte de 2 000 caractères au plus attendu'); return v;
      case 'nombre': { const n = typeof v === 'number' ? v : Number(v); if (!Number.isFinite(n)) bad('nombre attendu'); return n; }
      case 'date': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) bad('date AAAA-MM-JJ attendue'); return v;
      case 'booleen': if (typeof v !== 'boolean') bad('oui ou non attendu'); return v;
      case 'liste': if (!(def.options || []).some((o) => o.valeur === v)) bad('valeur hors de la liste'); return v;
      case 'elu': if (!Number.isInteger(v) || !(await db.get('SELECT 1 AS x FROM elus WHERE id = $1 AND organisme_id = $2', [v, org]))) bad('élu inconnu'); return v;
      case 'agent': if (typeof v !== 'string' || !/^[\w.@-]{1,128}$/.test(v)) bad('identifiant d’agent attendu'); return v;
      default: return v;
    }
  }

  const svc = {
    KINDS, visible,

    async list(organismeId, { typeActeId, inclureInactifs = false } = {}) {
      const org = requireOrg(organismeId);
      const rows = await db.all(`SELECT * FROM champs_personnalises WHERE organisme_id = $1 ${inclureInactifs ? '' : 'AND actif'} ${typeActeId ? 'AND (type_acte_id IS NULL OR type_acte_id = $2)' : ''} ORDER BY ordre, id`, typeActeId ? [org, typeActeId] : [org]);
      return rows.map(toChamp);
    },

    async create(ctx, organismeId, b) {
      const org = requireOrg(organismeId);
      if (b.kind === 'liste' && !(b.options || []).length) throw E.badRequest('Une liste comporte au moins une valeur');
      if (b.typeActeId && !(await db.get("SELECT 1 AS x FROM ref_items WHERE id = $1 AND kind = 'type_acte'", [b.typeActeId]))) throw E.badRequest("Type d'acte inconnu");
      try {
        const r = await db.get(
          `INSERT INTO champs_personnalises (organisme_id, code, libelle, aide, kind, options, obligatoire, type_acte_id, visible_si, roles_saisie, etapes_saisie, ordre)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12) RETURNING *`,
          [org, b.code, b.libelle, b.aide ?? null, b.kind, JSON.stringify(b.options || []), !!b.obligatoire, b.typeActeId ?? null, b.visibleSi ? JSON.stringify(b.visibleSi) : null,
            JSON.stringify(b.rolesSaisie || []), JSON.stringify(b.etapesSaisie || []), b.ordre ?? 0]);
        await audit.log(ctx, { organismeId: org, action: 'champ.create', entity: 'champs_personnalises', entityId: r.id, after: { code: b.code, kind: b.kind, obligatoire: !!b.obligatoire } });
        return toChamp(r);
      } catch (e) { if (e.code === '23505') throw E.conflict(`Le champ « ${b.code} » existe déjà`); throw e; }
    },

    async update(ctx, organismeId, id, b) {
      const org = requireOrg(organismeId);
      const before = await db.get('SELECT * FROM champs_personnalises WHERE id = $1 AND organisme_id = $2', [id, org]);
      if (!before) throw E.notFound('Champ introuvable');
      const set = []; const p = [id]; const add = (c, v, cast = '') => { p.push(v); set.push(`${c} = $${p.length}${cast}`); };
      if (b.libelle !== undefined) add('libelle', b.libelle);
      if (b.aide !== undefined) add('aide', b.aide);
      if (b.options !== undefined) add('options', JSON.stringify(b.options), '::jsonb');
      if (b.obligatoire !== undefined) add('obligatoire', b.obligatoire);
      if (b.visibleSi !== undefined) add('visible_si', b.visibleSi ? JSON.stringify(b.visibleSi) : null, '::jsonb');
      if (b.rolesSaisie !== undefined) add('roles_saisie', JSON.stringify(b.rolesSaisie), '::jsonb');
      if (b.etapesSaisie !== undefined) add('etapes_saisie', JSON.stringify(b.etapesSaisie), '::jsonb');
      if (b.ordre !== undefined) add('ordre', b.ordre);
      if (b.actif !== undefined) add('actif', b.actif);
      if (!set.length) return toChamp(before); // le code et le type d'un champ ne changent jamais : les valeurs déjà saisies y sont rattachées
      const r = await db.get(`UPDATE champs_personnalises SET ${set.join(', ')} WHERE id = $1 RETURNING *`, p);
      await audit.log(ctx, { organismeId: org, action: 'champ.update', entity: 'champs_personnalises', entityId: id, before: { obligatoire: before.obligatoire, actif: before.actif }, after: { obligatoire: r.obligatoire, actif: r.actif } });
      return toChamp(r);
    },

    /** Désactive : les valeurs déjà saisies sont conservées (un champ supprimé ne détruit jamais de données d'acte). */
    async remove(ctx, organismeId, id) { return svc.update(ctx, organismeId, id, { actif: false }); },

    /**
     * Valide et normalise les valeurs saisies d'un acte. `avant` = valeurs actuelles (null à la création).
     * Renvoie l'objet `custom` à enregistrer : les clés sans définition sont conservées telles quelles.
     */
    async valider(ctx, acte, valeurs, avant = {}) {
      const org = acte.organisme_id; const liste = await defs(org, acte.type_id);
      const out = { ...(valeurs || {}) };
      for (const def of liste) {
        const nouveau = valeurs?.[def.code]; const ancien = avant?.[def.code];
        if (JSON.stringify(nouveau ?? null) === JSON.stringify(ancien ?? null)) { if (nouveau === undefined) delete out[def.code]; continue; }
        if (!droitDeSaisie(ctx, acte, def)) throw E.forbidden(`Vous ne pouvez pas modifier le champ « ${def.libelle} » à ce stade`);
        if (vide(nouveau)) { delete out[def.code]; continue; }
        out[def.code] = await verifie(org, def, nouveau);
      }
      return out;
    },

    /** Champs obligatoires (et visibles) sans valeur : alimentent la complétude. */
    async manquants(acte) {
      const liste = await defs(acte.organisme_id, acte.type_id);
      return liste.filter((d) => d.obligatoire && visible(d, acte.custom) && vide(acte.custom?.[d.code])).map((d) => ({ code: `champ_${d.code}`, label: d.libelle }));
    },

    /** Vue pour la fiche : définitions applicables + droit de saisie pour moi + visibilité selon les valeurs. */
    async pourActe(ctx, acte) {
      return (await defs(acte.organisme_id, acte.type_id)).map((d) => ({ ...toChamp(d), visible: visible(d, acte.custom), modifiable: droitDeSaisie(ctx, acte, d), valeur: acte.custom?.[d.code] ?? null }));
    },
  };
  return svc;
}

module.exports = { createChamps, KINDS };
