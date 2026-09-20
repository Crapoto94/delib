/**
 * Export / import de la configuration d'un organisme (PAR-01, PAR-11, D91) : sauvegarde, transfert recette → production,
 * duplication vers une autre commune. Format `vibedelib.configuration/1`.
 *
 * Jamais dans le fichier : secrets (mots de passe chiffrés, clés), personnes (titulaires, élus, comptes), actes.
 * L'import se fait en deux temps (aperçu puis application), est idempotent, ne supprime rien et n'écrase jamais un circuit :
 * les circuits importés arrivent en brouillon.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const FORMAT = 'vibedelib.configuration/1';
const SECRET = /mot_de_passe|password|passwd|secret|token|cle_|_key$/i;
const CLE = /^[a-z0-9_.-]{1,80}$/;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function createConfiguration({ db, audit, settings, circuits, champs }) {
  const typeCode = async (id) => (id ? (await db.get('SELECT code FROM ref_items WHERE id = $1', [id]))?.code ?? null : null);
  const typeId = async (code) => (code ? (await db.get("SELECT id FROM ref_items WHERE kind = 'type_acte' AND code = $1 ORDER BY organisme_id NULLS LAST LIMIT 1", [code]))?.id ?? null : null);

  const svc = {
    FORMAT,

    async exporter(ctx, organismeId) {
      const org = requireOrg(organismeId);
      const o = await db.get('SELECT code, nom, type, vocabulaire, couleurs FROM organismes WHERE id = $1', [org]);
      const parametres = {};
      for (const r of await db.all("SELECT key, value FROM settings WHERE scope = 'organisme' AND scope_id = $1 ORDER BY key", [String(org)])) if (!SECRET.test(r.key)) parametres[r.key] = r.value;
      const propres = (await db.all('SELECT kind, code, libelle, parent_code, niveau, ordre, actif, meta FROM ref_items WHERE organisme_id = $1 ORDER BY kind, ordre, code', [org]))
        .map((r) => ({ kind: r.kind, code: r.code, libelle: r.libelle, parentCode: r.parent_code, niveau: r.niveau, ordre: r.ordre, actif: r.actif, meta: r.meta }));
      const surcharges = (await db.all('SELECT i.kind, i.code, x.actif, x.libelle FROM ref_overrides x JOIN ref_items i ON i.id = x.ref_id WHERE x.organisme_id = $1 ORDER BY i.kind, i.code', [org]))
        .map((r) => ({ kind: r.kind, code: r.code, actif: r.actif, libelle: r.libelle }));
      const cs = [];
      for (const c of await champs.list(org, { inclureInactifs: true })) cs.push({ code: c.code, libelle: c.libelle, aide: c.aide, kind: c.kind, options: c.options, obligatoire: c.obligatoire, typeActeCode: await typeCode(c.typeActeId), visibleSi: c.visibleSi, rolesSaisie: c.rolesSaisie, etapesSaisie: c.etapesSaisie, ordre: c.ordre, actif: c.actif });
      const cir = [];
      for (const d of await db.all('SELECT * FROM circuit_definitions WHERE organisme_id = $1 ORDER BY code', [org])) {
        const v = (d.active_version_id && await db.get('SELECT graph FROM circuit_versions WHERE id = $1', [d.active_version_id])) || await db.get('SELECT graph FROM circuit_versions WHERE definition_id = $1 ORDER BY version_no DESC LIMIT 1', [d.id]);
        if (v) cir.push({ code: d.code, nom: d.nom, typeActeCode: await typeCode(d.type_acte_id), directionCode: d.direction_code, graph: v.graph });
      }
      const instances = (await db.all('SELECT code, nom, kind, numbering, actif FROM instances WHERE organisme_id = $1 ORDER BY code', [org]))
        .map((r) => ({ code: r.code, nom: r.nom, kind: r.kind, numbering: r.numbering, actif: r.actif }));
      await audit.log(ctx, { organismeId: org, action: 'configuration.export', entity: 'organismes', entityId: org });
      return { format: FORMAT, exporteLe: new Date().toISOString(), source: { code: o.code, nom: o.nom, type: o.type }, organisme: { vocabulaire: o.vocabulaire, couleurs: o.couleurs }, parametres, referentiels: { propres, surcharges }, champs: cs, circuits: cir, instances };
    },

    /**
     * Aperçu (`appliquer: false`) ou application d'un fichier de configuration. Renvoie, par section, ce qui est créé, modifié ou identique,
     * et des avertissements ; rien n'est jamais supprimé.
     */
    async importer(ctx, organismeId, doc, { appliquer = false } = {}) {
      const org = requireOrg(organismeId);
      if (!doc || doc.format !== FORMAT) throw E.badRequest(`Fichier non reconnu : format « ${FORMAT} » attendu`);
      const arr = (x, nom) => { if (x !== undefined && !Array.isArray(x)) throw E.badRequest(`« ${nom} » doit être une liste`); return x || []; };
      const plan = {}; const avert = [];
      const section = (n) => (plan[n] = plan[n] || { creer: 0, modifier: 0, identique: 0, ignorer: 0 });
      const ops = []; // actions différées, exécutées seulement à l'application

      // ------------------------------------------------------------------------ vocabulaire, couleurs
      if (doc.organisme) {
        const o = await db.get('SELECT vocabulaire, couleurs FROM organismes WHERE id = $1', [org]); const s = section('organisme');
        const v = doc.organisme.vocabulaire ?? o.vocabulaire; const c = doc.organisme.couleurs ?? o.couleurs;
        if (typeof v !== 'object' || typeof c !== 'object') throw E.badRequest('Vocabulaire ou couleurs invalides');
        if (same(v, o.vocabulaire) && same(c, o.couleurs)) s.identique++; else { s.modifier++; ops.push(() => db.run('UPDATE organismes SET vocabulaire = $2::jsonb, couleurs = $3::jsonb WHERE id = $1', [org, JSON.stringify(v), JSON.stringify(c)])); }
      }

      // ------------------------------------------------------------------------ paramètres (jamais de secret)
      const courants = new Map((await db.all("SELECT key, value FROM settings WHERE scope = 'organisme' AND scope_id = $1", [String(org)])).map((r) => [r.key, r.value]));
      for (const [k, val] of Object.entries(doc.parametres || {})) {
        const s = section('parametres');
        if (!CLE.test(k)) { s.ignorer++; avert.push(`Paramètre « ${k} » ignoré : nom invalide`); continue; }
        if (SECRET.test(k)) { s.ignorer++; avert.push(`Paramètre « ${k} » ignoré : les secrets ne se transfèrent pas`); continue; }
        if (!courants.has(k)) { s.creer++; } else if (same(courants.get(k), val)) { s.identique++; continue; } else s.modifier++;
        ops.push(() => settings.put(ctx, { scope: 'organisme', organismeId: org, key: k, val }));
      }

      // ------------------------------------------------------------------------ référentiels propres et surcharges
      for (const r of arr(doc.referentiels?.propres, 'referentiels.propres')) {
        const s = section('referentiels');
        if (!['nature', 'rubrique', 'matiere', 'annexe_type', 'type_acte'].includes(r.kind) || !r.code || !r.libelle) { s.ignorer++; avert.push(`Référentiel « ${r.kind}/${r.code} » ignoré : incomplet`); continue; }
        const ex = await db.get('SELECT * FROM ref_items WHERE kind = $1 AND organisme_id = $2 AND code = $3', [r.kind, org, r.code]);
        if (ex && ex.libelle === r.libelle && (ex.parent_code ?? null) === (r.parentCode ?? null) && ex.actif === (r.actif !== false) && same(ex.meta, r.meta || {})) { s.identique++; continue; }
        if (ex) s.modifier++; else s.creer++;
        ops.push(() => db.run(
          `INSERT INTO ref_items (kind, organisme_id, code, libelle, parent_code, niveau, ordre, actif, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT (kind, COALESCE(organisme_id, 0), code) DO UPDATE SET libelle = EXCLUDED.libelle, parent_code = EXCLUDED.parent_code, niveau = EXCLUDED.niveau, ordre = EXCLUDED.ordre, actif = EXCLUDED.actif, meta = EXCLUDED.meta`,
          [r.kind, org, r.code, r.libelle, r.parentCode ?? null, r.niveau ?? null, r.ordre ?? 0, r.actif !== false, JSON.stringify(r.meta || {})]));
      }
      for (const r of arr(doc.referentiels?.surcharges, 'referentiels.surcharges')) {
        const s = section('surcharges');
        const ref = await db.get('SELECT id FROM ref_items WHERE kind = $1 AND code = $2 AND (organisme_id IS NULL OR organisme_id = $3) ORDER BY organisme_id NULLS LAST LIMIT 1', [r.kind, r.code, org]);
        if (!ref) { s.ignorer++; avert.push(`Surcharge « ${r.kind}/${r.code} » ignorée : la valeur n'existe pas dans cet organisme (importez d'abord ses référentiels)`); continue; }
        const ex = await db.get('SELECT actif, libelle FROM ref_overrides WHERE ref_id = $1 AND organisme_id = $2', [ref.id, org]);
        if (ex && (ex.actif ?? null) === (r.actif ?? null) && (ex.libelle ?? null) === (r.libelle ?? null)) { s.identique++; continue; }
        if (ex) s.modifier++; else s.creer++;
        ops.push(() => db.run('INSERT INTO ref_overrides (ref_id, organisme_id, actif, libelle) VALUES ($1,$2,$3,$4) ON CONFLICT (ref_id, organisme_id) DO UPDATE SET actif = EXCLUDED.actif, libelle = EXCLUDED.libelle', [ref.id, org, r.actif ?? null, r.libelle ?? null]));
      }

      // ------------------------------------------------------------------------ champs personnalisés
      for (const c of arr(doc.champs, 'champs')) {
        const s = section('champs');
        if (!/^[a-z][a-z0-9_]{1,40}$/.test(c.code || '') || !c.libelle || !(champs.KINDS || []).includes(c.kind)) { s.ignorer++; avert.push(`Champ « ${c.code} » ignoré : définition invalide`); continue; }
        const tid = c.typeActeCode ? await typeId(c.typeActeCode) : null;
        if (c.typeActeCode && !tid) { s.ignorer++; avert.push(`Champ « ${c.code} » ignoré : le type d'acte « ${c.typeActeCode} » n'existe pas ici`); continue; }
        const ex = await db.get('SELECT * FROM champs_personnalises WHERE organisme_id = $1 AND code = $2', [org, c.code]);
        if (ex && ex.kind !== c.kind) { s.ignorer++; avert.push(`Champ « ${c.code} » ignoré : il existe déjà avec un autre type (les valeurs saisies y sont rattachées)`); continue; }
        const corps = { libelle: c.libelle, aide: c.aide ?? null, options: c.options || [], obligatoire: !!c.obligatoire, visibleSi: c.visibleSi ?? null, rolesSaisie: c.rolesSaisie || [], etapesSaisie: c.etapesSaisie || [], ordre: c.ordre ?? 0, actif: c.actif !== false };
        if (ex) {
          const identique = ex.libelle === corps.libelle && (ex.aide ?? null) === corps.aide && same(ex.options, corps.options) && ex.obligatoire === corps.obligatoire && same(ex.visible_si, corps.visibleSi)
            && same(ex.roles_saisie, corps.rolesSaisie) && same(ex.etapes_saisie, corps.etapesSaisie) && ex.ordre === corps.ordre && ex.actif === corps.actif;
          if (identique) { s.identique++; continue; }
          s.modifier++; ops.push(() => champs.update(ctx, org, ex.id, corps));
        } else { s.creer++; ops.push(() => champs.create(ctx, org, { code: c.code, kind: c.kind, typeActeId: tid, ...corps }).then((n) => (corps.actif ? n : champs.update(ctx, org, n.id, { actif: false })))); }
      }

      // ------------------------------------------------------------------------ circuits (brouillons, jamais d'écrasement)
      for (const c of arr(doc.circuits, 'circuits')) {
        const s = section('circuits');
        if (!/^[a-z0-9_-]{2,40}$/.test(c.code || '') || !c.nom || !c.graph?.steps) { s.ignorer++; avert.push(`Circuit « ${c.code} » ignoré : définition invalide`); continue; }
        if (await db.get('SELECT 1 AS x FROM circuit_definitions WHERE organisme_id = $1 AND code = $2', [org, c.code])) { s.ignorer++; avert.push(`Circuit « ${c.code} » déjà présent : conservé tel quel (modifiez-le dans l'éditeur de circuits)`); continue; }
        const tid = c.typeActeCode ? await typeId(c.typeActeCode) : null;
        if (c.typeActeCode && !tid) avert.push(`Circuit « ${c.code} » : le type d'acte « ${c.typeActeCode} » n'existe pas ici, le circuit sera importé sans type`);
        s.creer++; ops.push(() => circuits.create(ctx, org, { code: c.code, nom: c.nom, typeActeId: tid, directionCode: c.directionCode ?? null, graph: c.graph }));
      }

      // ------------------------------------------------------------------------ instances
      for (const i of arr(doc.instances, 'instances')) {
        const s = section('instances');
        if (!/^[a-z0-9_-]{2,40}$/.test(i.code || '') || !i.nom || !['conseil', 'commission', 'autre'].includes(i.kind || 'conseil')) { s.ignorer++; avert.push(`Instance « ${i.code} » ignorée : définition invalide`); continue; }
        const ex = await db.get('SELECT * FROM instances WHERE organisme_id = $1 AND code = $2', [org, i.code]);
        if (ex && ex.nom === i.nom && ex.kind === (i.kind || 'conseil') && same(ex.numbering, i.numbering ?? ex.numbering) && ex.actif === (i.actif !== false)) { s.identique++; continue; }
        if (ex) s.modifier++; else s.creer++;
        ops.push(() => db.run(
          `INSERT INTO instances (organisme_id, code, nom, kind, numbering, actif) VALUES ($1,$2,$3,$4,COALESCE($5::jsonb, '{"pattern":"{ANNEE}-{N_SEANCE}-{ORDRE:03}"}'::jsonb),$6)
           ON CONFLICT (organisme_id, code) DO UPDATE SET nom = EXCLUDED.nom, kind = EXCLUDED.kind, numbering = COALESCE($5::jsonb, instances.numbering), actif = EXCLUDED.actif`,
          [org, i.code, i.nom, i.kind || 'conseil', i.numbering ? JSON.stringify(i.numbering) : null, i.actif !== false]));
      }

      if (appliquer) {
        for (const op of ops) await op();
        await audit.log(ctx, { organismeId: org, action: 'configuration.import', entity: 'organismes', entityId: org, after: { source: doc.source?.code ?? null, sections: plan, avertissements: avert.length } });
      }
      return { appliquee: !!appliquer, source: doc.source || null, sections: plan, avertissements: avert, aDesEffets: Object.values(plan).some((s) => s.creer || s.modifier) };
    },
  };
  return svc;
}

module.exports = { createConfiguration, FORMAT };
