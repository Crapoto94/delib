/**
 * Annexes (section 13) : PDF uniquement, contrôlés (signature %PDF, non chiffré, sans contenu actif), empreinte SHA-256,
 * versionnées (remplacer = nouvelle version, l'ancienne reste consultable), ordonnables, avec drapeaux de communication,
 * de publication et de transmission.
 */
const { E } = require('../../shared/errors');
const { inspectPdf } = require('../../shared/infra');

const toAnnexe = (r) => ({
  id: r.id, acteId: r.acte_id, titre: r.titre, typeId: r.type_id, ordre: r.ordre, version: r.version,
  communicable: r.communicable, publiable: r.publiable, transmissible: r.transmissible,
  fichier: { id: r.file_id, nom: r.original_name, mime: r.mime, taille: Number(r.size), pages: r.pages, sha256: r.sha256 },
  pdf: r.pdf_file_id ? { id: r.pdf_file_id, nom: r.pdf_name, mime: r.pdf_mime, taille: Number(r.pdf_size), pages: r.pdf_pages, sha256: r.pdf_sha } : null,
  createdBy: r.created_by, createdAt: r.created_at,
});
const SELECT = `SELECT a.*, f.original_name, f.mime, f.size, f.pages, f.sha256,
    pf.original_name AS pdf_name, pf.mime AS pdf_mime, pf.size AS pdf_size, pf.pages AS pdf_pages, pf.sha256 AS pdf_sha
  FROM annexes a JOIN files f ON f.id = a.file_id LEFT JOIN files pf ON pf.id = a.pdf_file_id`;

function createAnnexes({ db, audit, storage, refs, actes, config, bus }) {
  const svc = {
    async store(ctx, organismeId, file) {
      if (!file?.buffer) throw E.badRequest('Fichier manquant (champ « file »)');
      if (file.size > config.storage.maxUploadBytes) throw E.badRequest(`Fichier trop volumineux (maximum ${Math.round(config.storage.maxUploadBytes / 1048576)} Mo)`);
      const info = await inspectPdf(file.buffer);
      const put = await storage.put(file.buffer, { organismeId, ext: 'pdf' });
      // eslint-disable-next-line no-control-regex
      const name = String(file.originalname || 'annexe.pdf').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
      const f = await db.get(
        `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7) RETURNING *`,
        [organismeId, put.key, name, put.size, info.pages, put.sha256, ctx.username]);
      return f;
    },

    async list(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      return (await db.all(`${SELECT} WHERE a.acte_id = $1 ORDER BY a.ordre, a.id`, [a.id])).map(toAnnexe);
    },

    async add(ctx, organismeId, acteId, meta, file) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const typeId = meta.typeId ? (await refs.require('annexe_type', meta.typeId, a.organisme_id)).id : null;
      const f = await svc.store(ctx, a.organisme_id, file);
      const ordre = meta.ordre ?? (await db.get('SELECT COALESCE(MAX(ordre), 0) + 1 AS n FROM annexes WHERE acte_id = $1', [a.id])).n;
      const r = await db.get(
        `INSERT INTO annexes (acte_id, titre, type_id, ordre, file_id, communicable, publiable, transmissible, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [a.id, meta.titre, typeId, ordre, f.id, meta.communicable ?? true, meta.publiable ?? true, meta.transmissible ?? true, ctx.username]);
      await db.run('INSERT INTO annexe_versions (annexe_id, version, file_id, replaced_by) VALUES ($1, 1, $2, $3)', [r.id, f.id, ctx.username]);
      const out = toAnnexe(await db.get(`${SELECT} WHERE a.id = $1`, [r.id]));
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'annexe.add', entity: 'annexes', entityId: r.id, after: { titre: out.titre, sha256: f.sha256, pages: f.pages } });
      await bus.emit('annexe.added', { organismeId: a.organisme_id, acteId: a.id, annexeId: r.id, ctx });
      return out;
    },

    async update(ctx, organismeId, acteId, id, patch) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const typeId = patch.typeId === undefined ? undefined : (patch.typeId === null ? null : (await refs.require('annexe_type', patch.typeId, a.organisme_id)).id);
      const r = await db.get(
        `UPDATE annexes SET titre = COALESCE($3, titre), type_id = CASE WHEN $4 THEN $5 ELSE type_id END,
           communicable = COALESCE($6, communicable), publiable = COALESCE($7, publiable), transmissible = COALESCE($8, transmissible)
         WHERE id = $1 AND acte_id = $2 RETURNING id`,
        [id, a.id, patch.titre ?? null, typeId !== undefined, typeId ?? null, patch.communicable ?? null, patch.publiable ?? null, patch.transmissible ?? null]);
      if (!r) throw E.notFound('Annexe introuvable');
      return toAnnexe(await db.get(`${SELECT} WHERE a.id = $1`, [id]));
    },

    /** Remplace le fichier : nouvelle version, l'ancienne reste consultable (ANN-04). */
    async replaceFile(ctx, organismeId, acteId, id, file) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const cur = await db.get('SELECT * FROM annexes WHERE id = $1 AND acte_id = $2', [id, a.id]);
      if (!cur) throw E.notFound('Annexe introuvable');
      const f = await svc.store(ctx, a.organisme_id, file);
      const version = cur.version + 1;
      await db.run('UPDATE annexes SET file_id = $2, version = $3 WHERE id = $1', [id, f.id, version]);
      await db.run('INSERT INTO annexe_versions (annexe_id, version, file_id, replaced_by) VALUES ($1,$2,$3,$4)', [id, version, f.id, ctx.username]);
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'annexe.replace', entity: 'annexes', entityId: id, before: { version: cur.version }, after: { version, sha256: f.sha256 } });
      await bus.emit('annexe.replaced', { organismeId: a.organisme_id, acteId: a.id, annexeId: id, version, ctx });
      return toAnnexe(await db.get(`${SELECT} WHERE a.id = $1`, [id]));
    },

    async versions(ctx, organismeId, acteId, id) {
      const a = await actes.load(ctx, organismeId, acteId);
      const rows = await db.all(
        `SELECT v.version, v.replaced_by, v.replaced_at, f.id AS file_id, f.original_name, f.size, f.pages, f.sha256
         FROM annexe_versions v JOIN files f ON f.id = v.file_id JOIN annexes x ON x.id = v.annexe_id
         WHERE v.annexe_id = $1 AND x.acte_id = $2 ORDER BY v.version DESC`, [id, a.id]);
      return rows.map((r) => ({ version: r.version, by: r.replaced_by, at: r.replaced_at, fichier: { id: r.file_id, nom: r.original_name, taille: Number(r.size), pages: r.pages, sha256: r.sha256 } }));
    },

    async remove(ctx, organismeId, acteId, id) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const r = await db.get('DELETE FROM annexes WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id]);
      if (!r) throw E.notFound('Annexe introuvable');
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'annexe.delete', entity: 'annexes', entityId: id, before: { titre: r.titre } });
    },

    async reorder(ctx, organismeId, acteId, ids) {
      const a = await actes.load(ctx, organismeId, acteId, { edit: true });
      const cur = (await db.all('SELECT id FROM annexes WHERE acte_id = $1', [a.id])).map((x) => x.id);
      if (ids.length !== cur.length || !ids.every((i) => cur.includes(i))) throw E.badRequest("La liste doit contenir exactement les annexes de l'acte");
      await db.tx(async (q) => { for (const [i, id] of ids.entries()) await q.run('UPDATE annexes SET ordre = $2 WHERE id = $1', [id, i + 1]); });
      return svc.list(ctx, organismeId, acteId);
    },

    /** Contenu d'un fichier d'annexe : original (défaut), sa version, ou le PDF associé (`format = 'pdf'`) ; contrôle de visibilité de l'acte. */
    async content(ctx, organismeId, acteId, id, version, format) {
      const a = await actes.load(ctx, organismeId, acteId);
      let row;
      if (format === 'pdf') {
        row = await db.get('SELECT pf.* FROM annexes x JOIN files pf ON pf.id = x.pdf_file_id WHERE x.id = $1 AND x.acte_id = $2', [id, a.id]);
        if (!row) row = await db.get("SELECT f.* FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.id = $1 AND x.acte_id = $2 AND f.mime = 'application/pdf'", [id, a.id]);
      } else if (version) {
        row = await db.get(`SELECT f.* FROM annexe_versions v JOIN files f ON f.id = v.file_id JOIN annexes x ON x.id = v.annexe_id WHERE v.annexe_id = $1 AND v.version = $2 AND x.acte_id = $3`, [id, version, a.id]);
      } else {
        row = await db.get('SELECT f.* FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.id = $1 AND x.acte_id = $2', [id, a.id]);
      }
      if (!row) throw E.notFound('Annexe introuvable');
      return { buffer: await storage.get(row.storage_key), name: row.original_name, sha256: row.sha256, mime: row.mime || 'application/octet-stream' };
    },
  };
  return svc;
}

module.exports = { createAnnexes };
