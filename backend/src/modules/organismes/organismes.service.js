/**
 * Organismes (Ville, CCAS…), rattachement direction -> organisme, rôles par organisme (MOR-01, MOR-03, MOR-05).
 * Toute écriture est auditée avec l'état avant / après.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const ORG_ROLES = ['org_admin', 'scc', 'teletransmission', 'lecteur'];
const json = (v) => JSON.stringify(v ?? {});

const toOrg = (r) => r && ({
  id: r.id, code: r.code, nom: r.nom, type: r.type, siren: r.siren, adresse: r.adresse, contact: r.contact || {}, hasLogo: !!r.logo_path, logoVersion: r.logo_sha256 ? r.logo_sha256.slice(0, 12) : null,
  couleurs: r.couleurs, vocabulaire: r.vocabulaire, isDefault: r.is_default, actif: r.actif, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toRole = (r) => ({ id: r.id, username: r.username, organismeId: r.organisme_id, role: r.role, createdBy: r.created_by, createdAt: r.created_at });

const LOGO_MAX = 1.5 * 1024 * 1024;
const CONTACT_KEYS = ['adresse2', 'codePostal', 'ville', 'telephone', 'email', 'siteWeb', 'signataire', 'signataireQualite'];
const mimeOf = (b) => (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : null);

function createOrganismes({ db, audit, storage }) {
  const svc = {
    ORG_ROLES,
    async getById(id) { return toOrg(await db.get('SELECT * FROM organismes WHERE id = $1', [id])); },
    async getByCode(code) { return toOrg(await db.get('SELECT * FROM organismes WHERE code = $1', [code])); },

    async create(ctx, d) {
      try {
        const r = await db.get(
          `INSERT INTO organismes (code, nom, type, siren, adresse, couleurs, vocabulaire)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING *`,
          [d.code, d.nom, d.type, d.siren || null, d.adresse || null, json(d.couleurs), json(d.vocabulaire)]);
        const org = toOrg(r);
        await audit.log(ctx, { organismeId: org.id, action: 'organisme.create', entity: 'organismes', entityId: org.id, after: org });
        return org;
      } catch (e) {
        if (e.code === '23505') throw E.conflict(`Le code d'organisme « ${d.code} » existe déjà`);
        throw e;
      }
    },

    async update(ctx, id, d) {
      const before = await svc.getById(id);
      if (!before) throw E.notFound('Organisme introuvable');
      if (d.actif === false && before.isDefault) throw E.conflict("L'organisme par défaut ne peut pas être désactivé");
      const r = await db.get(
        `UPDATE organismes SET nom = COALESCE($2, nom), type = COALESCE($3, type), siren = COALESCE($4, siren),
           adresse = COALESCE($5, adresse), couleurs = COALESCE($6::jsonb, couleurs), vocabulaire = COALESCE($7::jsonb, vocabulaire),
           actif = COALESCE($8, actif), contact = CASE WHEN $9::jsonb IS NULL THEN contact ELSE contact || $9::jsonb END WHERE id = $1 RETURNING *`,
        [id, d.nom ?? null, d.type ?? null, d.siren ?? null, d.adresse ?? null,
          d.couleurs ? json(d.couleurs) : null, d.vocabulaire ? json(d.vocabulaire) : null, d.actif ?? null,
          d.contact ? json(Object.fromEntries(Object.entries(d.contact).filter(([k]) => CONTACT_KEYS.includes(k)))) : null]);
      const after = toOrg(r);
      await audit.log(ctx, { organismeId: id, action: 'organisme.update', entity: 'organismes', entityId: id, before, after });
      return after;
    },

    /** Logo (PNG ou JPEG, 1,5 Mo au plus) : logo de l'application ET des PDF. Signature vérifiée, jamais l'extension. */
    async setLogo(ctx, id, file) {
      const org = await svc.getById(id);
      if (!org) throw E.notFound('Organisme introuvable');
      if (!file?.buffer) throw E.badRequest('Fichier manquant (champ « file »)');
      if (file.buffer.length > LOGO_MAX) throw E.badRequest('Logo trop lourd (1,5 Mo au maximum)');
      const mime = mimeOf(file.buffer);
      if (!mime) throw E.badRequest('Le logo doit être une image PNG ou JPEG');
      const { PDFDocument } = require('pdf-lib');
      try { const d = await PDFDocument.create(); if (mime === 'image/png') await d.embedPng(file.buffer); else await d.embedJpg(file.buffer); } catch { throw E.badRequest('Image illisible ou corrompue'); }
      const put = await storage.put(file.buffer, { organismeId: id, ext: mime === 'image/png' ? 'png' : 'jpg', categorie: 'logos', nom: `logo.${mime === 'image/png' ? 'png' : 'jpg'}`, titre: `Logo — ${org.nom}`, auteur: ctx.username });
      const old = await db.get('SELECT logo_path FROM organismes WHERE id = $1', [id]);
      await db.run('UPDATE organismes SET logo_path = $2, logo_mime = $3, logo_sha256 = $4, logo_updated_at = now() WHERE id = $1', [id, put.key, mime, put.sha256]);
      if (old?.logo_path) await storage.remove(old.logo_path).catch(() => {});
      await audit.log(ctx, { organismeId: id, action: 'organisme.logo', entity: 'organismes', entityId: id, after: { mime, taille: file.buffer.length, sha256: put.sha256 } });
      return svc.getById(id);
    },
    async removeLogo(ctx, id) {
      const old = await db.get('SELECT logo_path FROM organismes WHERE id = $1', [id]);
      if (!old) throw E.notFound('Organisme introuvable');
      await db.run('UPDATE organismes SET logo_path = NULL, logo_mime = NULL, logo_sha256 = NULL, logo_updated_at = now() WHERE id = $1', [id]);
      if (old.logo_path) await storage.remove(old.logo_path).catch(() => {});
      await audit.log(ctx, { organismeId: id, action: 'organisme.logo.remove', entity: 'organismes', entityId: id });
      return svc.getById(id);
    },
    /** { buffer, mime, sha256 } ou null. */
    async getLogo(id) {
      const r = await db.get('SELECT logo_path, logo_mime, logo_sha256 FROM organismes WHERE id = $1 AND actif', [id]);
      if (!r?.logo_path) return null;
      try { return { buffer: await storage.get(r.logo_path), mime: r.logo_mime, sha256: r.logo_sha256 }; } catch { return null; }
    },
    /** Identité publique de l'application (page de connexion) : organisme par défaut, sans donnée sensible. */
    async branding() {
      const r = await db.get('SELECT id, nom, logo_sha256, logo_path FROM organismes WHERE is_default');
      return r ? { organismeId: r.id, nom: r.nom, hasLogo: !!r.logo_path, logoVersion: r.logo_sha256 ? r.logo_sha256.slice(0, 12) : null } : { organismeId: null, nom: 'VibeDélib', hasLogo: false, logoVersion: null };
    },

    /** Amorçage : garantit l'existence de l'organisme par défaut (Ville). */
    async ensureDefault(name) {
      const existing = await db.get('SELECT * FROM organismes WHERE is_default');
      if (existing) return toOrg(existing);
      const r = await db.get(
        `INSERT INTO organismes (code, nom, type, is_default) VALUES ('ville', $1, 'commune', true)
         ON CONFLICT (code) DO UPDATE SET is_default = true RETURNING *`, [name]);
      const org = toOrg(r);
      await audit.log({ username: 'system' }, { organismeId: org.id, action: 'organisme.bootstrap', entity: 'organismes', entityId: org.id, after: org });
      return org;
    },

    // ---- rattachement direction -> organisme --------------------------------------------------------------------
    async directions(ctx, organismeId) {
      const id = requireOrg(organismeId);
      return db.withCtx(ctx, (q) => q.all(
        'SELECT direction_code AS code, direction_label AS label FROM organisme_directions WHERE organisme_id = $1 ORDER BY direction_label, direction_code', [id]));
    },

    /** Remplace l'ensemble des directions d'un organisme. Une direction ne peut appartenir qu'à UN organisme. */
    async setDirections(ctx, organismeId, items) {
      const id = requireOrg(organismeId);
      const codes = [...new Set(items.map((i) => i.code))];
      const conflicts = codes.length
        ? await db.all(
          `SELECT d.direction_code AS code, o.code AS organisme FROM organisme_directions d JOIN organismes o ON o.id = d.organisme_id
           WHERE d.direction_code = ANY($1::text[]) AND d.organisme_id <> $2`, [codes, id])
        : [];
      if (conflicts.length) throw E.conflict('Des directions sont déjà rattachées à un autre organisme', conflicts);
      const before = await svc.directions({ isPlatformAdmin: true }, id);
      await db.tx(async (q) => {
        await q.run('DELETE FROM organisme_directions WHERE organisme_id = $1 AND NOT (direction_code = ANY($2::text[]))', [id, codes]);
        for (const it of items) {
          await q.run(
            `INSERT INTO organisme_directions (organisme_id, direction_code, direction_label) VALUES ($1,$2,$3)
             ON CONFLICT (organisme_id, direction_code) DO UPDATE SET direction_label = EXCLUDED.direction_label`, [id, it.code, it.label || null]);
        }
      }, { bypass: true });
      const after = await svc.directions({ isPlatformAdmin: true }, id);
      await audit.log(ctx, { organismeId: id, action: 'organisme.directions', entity: 'organisme_directions', entityId: id, before, after });
      return after;
    },

    // ---- rôles ------------------------------------------------------------------------------------------------------
    async listRoles(ctx, organismeId) {
      const id = requireOrg(organismeId);
      return (await db.withCtx(ctx, (q) => q.all('SELECT * FROM user_org_roles WHERE organisme_id = $1 ORDER BY username, role', [id]))).map(toRole);
    },

    async addRole(ctx, organismeId, username, role) {
      const id = requireOrg(organismeId);
      if (!ORG_ROLES.includes(role)) throw E.badRequest(`Rôle inconnu : ${role}`);
      const u = String(username).trim().toLowerCase();
      const r = await db.get(
        'INSERT INTO user_org_roles (username, organisme_id, role, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *',
        [u, id, role, ctx.username]);
      if (!r) throw E.conflict('Ce rôle est déjà attribué à cet utilisateur');
      await audit.log(ctx, { organismeId: id, action: 'role.add', entity: 'user_org_roles', entityId: r.id, after: toRole(r) });
      return toRole(r);
    },

    async removeRole(ctx, organismeId, roleId) {
      const id = requireOrg(organismeId);
      const r = await db.get('DELETE FROM user_org_roles WHERE id = $1 AND organisme_id = $2 RETURNING *', [roleId, id]);
      if (!r) throw E.notFound('Rôle introuvable dans cet organisme');
      await audit.log(ctx, { organismeId: id, action: 'role.remove', entity: 'user_org_roles', entityId: roleId, before: toRole(r) });
    },

    // ---- administrateurs de plateforme -------------------------------------------------------------------------------
    async listPlatformAdmins() {
      return (await db.all("SELECT * FROM user_org_roles WHERE role = 'platform_admin' ORDER BY username")).map(toRole);
    },
    async addPlatformAdmin(ctx, username) {
      const u = String(username).trim().toLowerCase();
      const r = await db.get(
        "INSERT INTO user_org_roles (username, organisme_id, role, created_by) VALUES ($1, NULL, 'platform_admin', $2) ON CONFLICT DO NOTHING RETURNING *",
        [u, ctx.username]);
      if (!r) throw E.conflict('Cet utilisateur est déjà administrateur de plateforme');
      await audit.log(ctx, { action: 'role.platform_admin.add', entity: 'user_org_roles', entityId: r.id, after: toRole(r) });
      return toRole(r);
    },
    async removePlatformAdmin(ctx, roleId) {
      const left = (await db.get("SELECT count(*)::int AS n FROM user_org_roles WHERE role = 'platform_admin'")).n;
      if (left <= 1) throw E.conflict('Le dernier administrateur de plateforme ne peut pas être retiré');
      const r = await db.get("DELETE FROM user_org_roles WHERE id = $1 AND role = 'platform_admin' RETURNING *", [roleId]);
      if (!r) throw E.notFound('Rôle introuvable');
      await audit.log(ctx, { action: 'role.platform_admin.remove', entity: 'user_org_roles', entityId: roleId, before: toRole(r) });
    },
  };
  return svc;
}

module.exports = { createOrganismes, ORG_ROLES };
