/**
 * Annexes (section 13) : PDF, Word ou Excel (Word/Excel convertis en PDF), contrôlées (signature du fichier,
 * sans contenu actif pour un PDF), empreinte SHA-256, versionnées (même nom = version suivante, l'ancienne reste
 * consultable), ordonnables, avec drapeaux de communication, de publication et de transmission.
 */
const { E } = require('../../shared/errors');
const { inspectPdf } = require('../../shared/infra');
const { convertirEnPdf } = require('../../shared/convert');

const ZIP = [0x50, 0x4b]; const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const MIMES = {
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
const extOf = (name) => String(name || '').split('.').pop().toLowerCase();
const startsWith = (buf, magic) => magic.every((b, i) => buf[i] === b);
// eslint-disable-next-line no-control-regex -- on retire les caractères de contrôle des noms de fichiers
const cleanName = (name) => String(name || 'annexe').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);

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

function createAnnexes({ db, audit, storage, refs, actes, bus, uploadLimit }) {
  const svc = {
    async store(ctx, organismeId, file) {
      if (!file?.buffer) throw E.badRequest('Fichier manquant (champ « file »)');
      const maxMo = await uploadLimit.mb(organismeId);
      if (file.size > maxMo * 1048576) throw E.badRequest(`Fichier trop volumineux (maximum ${maxMo} Mo)`);
      const name = cleanName(file.originalname || 'annexe.pdf');
      const ext = extOf(name);
      const mime = MIMES[ext];
      if (!mime) throw E.badRequest(`Type de fichier non accepté (.${ext}) : PDF, Word (.docx, .doc), Excel (.xlsx, .xls), OpenDocument (.odt, .ods)`);
      let pages = null;
      if (ext === 'pdf') pages = (await inspectPdf(file.buffer)).pages;
      else if (!(startsWith(file.buffer, ZIP) || startsWith(file.buffer, OLE))) throw E.badRequest('Le contenu du fichier ne correspond pas à son extension');
      const put = await storage.put(file.buffer, { organismeId, ext });
      return db.get(
        `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [organismeId, put.key, name, mime, put.size, pages, put.sha256, ctx.username]);
    },

    /** PDF associé d'une annexe : le fichier lui-même s'il est déjà PDF, sinon conversion Word/Excel (mise en cache). */
    async ensurePdf(organismeId, annexeId) {
      const row = await db.get(`SELECT x.id, x.file_id, x.pdf_file_id, f.storage_key, f.mime, f.original_name FROM annexes x JOIN files f ON f.id = x.file_id WHERE x.id = $1`, [annexeId]);
      if (!row) throw E.notFound('Annexe introuvable');
      if (row.pdf_file_id) return row.pdf_file_id;
      if (row.mime === 'application/pdf') { await db.run('UPDATE annexes SET pdf_file_id = file_id WHERE id = $1', [annexeId]); return row.file_id; }
      const pdf = await convertirEnPdf(await storage.get(row.storage_key), extOf(row.original_name));
      if (!pdf) throw E.incomplete('Conversion en PDF indisponible sur le serveur (Word/Excel/LibreOffice requis)');
      const info = await inspectPdf(pdf);
      const put = await storage.put(pdf, { organismeId, ext: 'pdf' });
      const pf = await db.get(
        `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,'system') RETURNING *`,
        [organismeId, put.key, String(row.original_name).replace(/\.[^.]+$/, '') + '.pdf', put.size, info.pages, put.sha256]);
      await db.run('UPDATE annexes SET pdf_file_id = $2 WHERE id = $1', [annexeId, pf.id]);
      return pf.id;
    },

    /** À la validation finale : produit le PDF des annexes Word/Excel (celles déjà en PDF sont laissées telles quelles). */
    async finaliser(organismeId, acteId) {
      const rows = await db.all('SELECT id FROM annexes WHERE acte_id = $1', [acteId]);
      for (const r of rows) { try { await svc.ensurePdf(organismeId, r.id); } catch { /* conversion indisponible : l'annexe d'origine reste consultable */ } }
    },

    async list(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      return (await db.all(`${SELECT} WHERE a.acte_id = $1 ORDER BY a.ordre, a.id`, [a.id])).map(toAnnexe);
    },

    async add(ctx, organismeId, acteId, meta, file) {
      const a = await actes.load(ctx, organismeId, acteId, { attach: true });
      const typeId = meta.typeId ? (await refs.require('annexe_type', meta.typeId, a.organisme_id)).id : null;
      const f = await svc.store(ctx, a.organisme_id, file);
      // Ré-upload d'un fichier de même nom : c'est une nouvelle version de l'annexe existante, jamais un doublon (ANN-04).
      const same = await db.get(
        `SELECT x.id, x.version FROM annexes x JOIN files fx ON fx.id = x.file_id WHERE x.acte_id = $1 AND lower(fx.original_name) = lower($2) ORDER BY x.id DESC LIMIT 1`,
        [a.id, f.original_name]);
      if (same) {
        const version = same.version + 1;
        await db.run('UPDATE annexes SET file_id = $2, version = $3 WHERE id = $1', [same.id, f.id, version]);
        await db.run('INSERT INTO annexe_versions (annexe_id, version, file_id, replaced_by) VALUES ($1,$2,$3,$4)', [same.id, version, f.id, ctx.username]);
        const maj = toAnnexe(await db.get(`${SELECT} WHERE a.id = $1`, [same.id]));
        await audit.log(ctx, { organismeId: a.organisme_id, action: 'annexe.replace', entity: 'annexes', entityId: same.id, after: { titre: maj.titre, version, sha256: f.sha256 } });
        await bus.emit('annexe.replaced', { organismeId: a.organisme_id, acteId: a.id, annexeId: same.id, version, ctx });
        return maj;
      }
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
      const a = await actes.load(ctx, organismeId, acteId, { attach: true });
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
      const a = await actes.load(ctx, organismeId, acteId, { attach: true });
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
      const a = await actes.load(ctx, organismeId, acteId, { attach: true });
      const r = await db.get('DELETE FROM annexes WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id]);
      if (!r) throw E.notFound('Annexe introuvable');
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'annexe.delete', entity: 'annexes', entityId: id, before: { titre: r.titre } });
    },

    async reorder(ctx, organismeId, acteId, ids) {
      const a = await actes.load(ctx, organismeId, acteId, { attach: true });
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
        // Word/Excel : on produit (et met en cache) le PDF associé si nécessaire.
        row = await db.get('SELECT pf.* FROM annexes x JOIN files pf ON pf.id = x.pdf_file_id WHERE x.id = $1 AND x.acte_id = $2', [id, a.id]);
        if (!row) { try { await svc.ensurePdf(a.organisme_id, id); } catch { /* repli sur l'original ci-dessous */ } row = await db.get('SELECT pf.* FROM annexes x JOIN files pf ON pf.id = x.pdf_file_id WHERE x.id = $1 AND x.acte_id = $2', [id, a.id]); }
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
