/**
 * Service de rendu PDF (RenderPort, section 12) : PDF de fond + gabarit paramétrable, même pipeline pour l'aperçu et le
 * document final (PRE-09) ; cache par empreinte du contenu et de la version du gabarit (PRE-11).
 */
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { inspectPdf } = require('../../shared/infra');
const { resolveConfig, DEFAULTS } = require('./defaults');
const T = require('./typeset');

const DOC_TYPES = Object.keys(DEFAULTS);
const FINAL = ['adopte', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis', 'ar_recu', 'publie', 'executoire', 'archive'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const A4_TOL = 6; // points

function createRender({ db, audit, storage, refs, actes, textes, config }) {
  let measurePromise = null;
  const measure = () => (measurePromise ||= T.createMeasure());
  const cache = new Map();
  const remember = (k, v) => { cache.set(k, v); if (cache.size > 60) cache.delete(cache.keys().next().value); return v; };

  const svc = {
    DOC_TYPES,
    measure,

    // ---- gabarits ----------------------------------------------------------------------------------------------------
    async getTemplate(organismeId, docType) {
      const org = requireOrg(organismeId);
      const r = await db.get('SELECT * FROM render_templates WHERE organisme_id = $1 AND doc_type = $2', [org, docType]);
      return {
        docType, id: r?.id ?? null, version: r?.version ?? 0, cfg: resolveConfig(docType, r?.config || {}),
        bgFirstFileId: r?.bg_first_file_id ?? null, bgNextFileId: r?.bg_next_file_id ?? null, personnalise: !!r,
      };
    },
    async listTemplates(organismeId) { return Promise.all(DOC_TYPES.map((d) => svc.getTemplate(organismeId, d))); },

    async upsertTemplate(ctx, organismeId, docType, cfg) {
      const org = requireOrg(organismeId);
      const before = await svc.getTemplate(org, docType);
      const r = await db.get(
        `INSERT INTO render_templates (organisme_id, doc_type, config, updated_by) VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT (organisme_id, doc_type) DO UPDATE SET config = EXCLUDED.config, version = render_templates.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`, [org, docType, JSON.stringify(cfg), ctx.username]);
      await db.run('INSERT INTO render_template_versions (template_id, version, config, bg_first_file_id, bg_next_file_id, saved_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6)',
        [r.id, r.version, JSON.stringify(cfg), r.bg_first_file_id, r.bg_next_file_id, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'gabarit.update', entity: 'render_templates', entityId: r.id, before: { version: before.version, cfg: before.cfg }, after: { version: r.version, cfg } });
      return svc.getTemplate(org, docType);
    },

    /** Dépose un PDF de fond (PRE-10 : PDF valide, A4 si a4Strict). which = 'first' | 'next'. */
    async setBackground(ctx, organismeId, docType, which, file) {
      const org = requireOrg(organismeId);
      if (!file?.buffer) throw E.badRequest('Fichier manquant (champ « file »)');
      const info = await inspectPdf(file.buffer);
      const tpl = await svc.getTemplate(org, docType);
      if (tpl.cfg.a4Strict !== false && (Math.abs(info.width - T.A4.w) > A4_TOL || Math.abs(info.height - T.A4.h) > A4_TOL)) {
        throw E.badRequest(`Le fond doit être au format A4 (reçu ${Math.round(info.width)} × ${Math.round(info.height)} pt)`);
      }
      const put = await storage.put(file.buffer, { organismeId: org, ext: 'pdf' });
      const f = await db.get(
        `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7) RETURNING *`,
        [org, put.key, String(file.originalname || 'fond.pdf').slice(0, 200), put.size, info.pages, put.sha256, ctx.username]);
      const col = which === 'first' ? 'bg_first_file_id' : 'bg_next_file_id';
      const r = await db.get(
        `INSERT INTO render_templates (organisme_id, doc_type, config, ${col}, updated_by) VALUES ($1,$2,'{}'::jsonb,$3,$4)
         ON CONFLICT (organisme_id, doc_type) DO UPDATE SET ${col} = EXCLUDED.${col}, version = render_templates.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
        [org, docType, f.id, ctx.username]);
      await db.run('INSERT INTO render_template_versions (template_id, version, config, bg_first_file_id, bg_next_file_id, saved_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6)',
        [r.id, r.version, JSON.stringify(r.config), r.bg_first_file_id, r.bg_next_file_id, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'gabarit.fond', entity: 'render_templates', entityId: r.id, after: { docType, which, sha256: f.sha256, pages: info.pages } });
      return svc.getTemplate(org, docType);
    },
    async removeBackground(ctx, organismeId, docType, which) {
      const org = requireOrg(organismeId);
      const col = which === 'first' ? 'bg_first_file_id' : 'bg_next_file_id';
      await db.run(`UPDATE render_templates SET ${col} = NULL, version = version + 1 WHERE organisme_id = $1 AND doc_type = $2`, [org, docType]);
      await audit.log(ctx, { organismeId: org, action: 'gabarit.fond_retire', entity: 'render_templates', after: { docType, which } });
      return svc.getTemplate(org, docType);
    },
    async bgBytes(fileId) {
      if (!fileId) return null;
      const f = await db.get('SELECT storage_key, sha256 FROM files WHERE id = $1', [fileId]);
      return f ? { bytes: await storage.get(f.storage_key), sha256: f.sha256 } : null;
    },

    // ---- composition --------------------------------------------------------------------------------------------------
    async varsFor(acte, delib) {
      const org = requireOrg(acte.organisme_id);
      const [orgRow, rub, mat, nat] = await Promise.all([
        db.get('SELECT nom FROM organismes WHERE id = $1', [org]),
        acte.rubrique_id ? db.get('SELECT libelle FROM ref_items WHERE id = $1', [acte.rubrique_id]) : null,
        acte.matiere_id ? db.get('SELECT code, libelle FROM ref_items WHERE id = $1', [acte.matiere_id]) : null,
        acte.nature_id ? db.get('SELECT libelle FROM ref_items WHERE id = $1', [acte.nature_id]) : null,
      ]);
      const seance = acte.seance_id || acte.seance_visee_id ? await db.get('SELECT date_seance FROM seances WHERE id = $1', [acte.seance_id || acte.seance_visee_id]).catch(() => null) : null;
      return {
        organisme: orgRow?.nom || '', numero_suivi: acte.numero_suivi, titre: delib?.titre || acte.titre, titre_dossier: acte.titre,
        rubrique: rub?.libelle || '', matiere: mat ? `${mat.code} ${mat.libelle}` : '', nature: nat?.libelle || '',
        direction: acte.direction_label || acte.direction_code, service: acte.service_label || '', redacteur: acte.redacteur, statut: acte.statut,
        date_seance: seance?.date_seance ? new Date(seance.date_seance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase() : '[date de séance à définir]',
        date_du_jour: new Date().toLocaleDateString('fr-FR'), numero: delib?.numero || '',
      };
    },

    headerItems(cfg) {
      return (cfg.entete || []).map((b) => ({ type: 'title', text: b.texte, size: b.taille, align: b.align, bold: b.gras, boxed: !!b.encadre, after: b.apres }));
    },

    /** Les spans deviennent des runs colorés ; le texte propre un run unique. */
    runsOf(text, mode) {
      if (mode === 'suivi' && text.tracking && text.spans?.length) return text.spans.map((s) => ({ text: s.text, type: s.type, color: s.color }));
      return [{ text: text.markdown, type: 'text' }];
    },

    /** Compose et dessine un document ; utilisé par l'aperçu, le dossier, le cahier de séance et le registre. */
    async build({ organismeId, docType, content, vars, watermark, title, cfgOverride }) {
      const tpl = await svc.getTemplate(organismeId, docType);
      const cfg = { ...tpl.cfg, ...(cfgOverride || {}) };
      const [bf, bn] = await Promise.all([svc.bgBytes(tpl.bgFirstFileId), svc.bgBytes(tpl.bgNextFileId)]);
      const wm = watermark === undefined ? cfg.filigrane : watermark;
      const key = sha(JSON.stringify({ docType, content, cfg, vars, wm, bf: bf?.sha256, bn: bn?.sha256, v: tpl.version }));
      if (cache.has(key)) return cache.get(key);
      const layout = T.layoutDocument({ content, cfg, vars, measure: await measure() });
      const out = await T.paintDocument({ layout, cfg, vars, bgFirst: bf?.bytes, bgNext: bn?.bytes, watermark: wm || null, title });
      return remember(key, { ...out, layout, key });
    },

    async textsFor(ctx, acte, target, deliberationId) {
      const all = await db.all('SELECT * FROM tracked_texts WHERE acte_id = $1', [acte.id]);
      const pick = (kind, d) => all.find((t) => t.kind === kind && (t.deliberation_id ?? null) === (d ?? null));
      return { all, pick, expose: pick('expose', null), delibs: await db.all('SELECT * FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [acte.id]) };
    },

    async draftOf(ctx, textRow) {
      if (!textRow) return null;
      const d = await db.get('SELECT markdown FROM text_drafts WHERE text_id = $1 AND username = $2', [textRow.id, ctx.username]);
      return d ? d.markdown : null;
    },

    /**
     * Aperçu d'un acte : exposé, une délibération, ou dossier complet (exposé + délibérations + annexes, avec sommaire).
     * mode : 'propre' | 'suivi' ; brouillon : utilise mon brouillon non enregistré (PRE-02).
     */
    async renderActe(ctx, organismeId, acteId, { cible = 'expose', deliberationId, mode = 'propre', brouillon = false }) {
      const acte = await actes.load(ctx, organismeId, acteId);
      const { pick, delibs } = await svc.textsFor(ctx, acte, cible, deliberationId);
      const watermark = FINAL.includes(acte.statut) ? '' : undefined;

      const runs = async (row) => {
        if (!row) return [{ text: '', type: 'text' }];
        if (brouillon) { const d = await svc.draftOf(ctx, row); if (d !== null) return [{ text: d, type: 'text' }]; }
        return svc.runsOf({ ...row, markdown: row.markdown }, mode);
      };

      const exposePdf = async () => {
        const tpl = await svc.getTemplate(acte.organisme_id, 'expose');
        const vars = await svc.varsFor(acte, null);
        const content = [...svc.headerItems(tpl.cfg), { type: 'runs', runs: await runs(pick('expose', null)) }];
        return svc.build({ organismeId: acte.organisme_id, docType: 'expose', content, vars, watermark, title: `Exposé des motifs — ${acte.titre}` });
      };
      const delibPdf = async (d) => {
        const tpl = await svc.getTemplate(acte.organisme_id, 'deliberation');
        const vars = await svc.varsFor(acte, d);
        const dispLabel = tpl.cfg.sections?.dispositif ?? 'Après en avoir délibéré, le conseil DÉCIDE :';
        const content = [
          ...svc.headerItems(tpl.cfg),
          { type: 'runs', runs: await runs(pick('visas', d.id)) },
          { type: 'space', h: 6 },
          ...(dispLabel ? [{ type: 'title', text: dispLabel, size: 11, bold: true, align: 'left', after: 4 }] : []),
          { type: 'runs', runs: await runs(pick('dispositif', d.id)) },
        ];
        return svc.build({ organismeId: acte.organisme_id, docType: 'deliberation', content, vars, watermark, title: `Délibération — ${d.titre}` });
      };

      if (cible === 'expose') return exposePdf();
      if (cible === 'deliberation') {
        const d = delibs.find((x) => x.id === Number(deliberationId)) || (delibs.length === 1 ? delibs[0] : null);
        if (!d) throw E.badRequest('deliberationId requis (le dossier comporte plusieurs délibérations)');
        return delibPdf(d);
      }
      if (cible === 'dossier') {
        const parts = [{ titre: 'Exposé des motifs', pdf: await exposePdf() }];
        for (const d of delibs) parts.push({ titre: `Délibération : ${d.titre}`, pdf: await delibPdf(d) });
        const annexes = await db.all('SELECT a.titre, a.ordre, f.storage_key, f.pages FROM annexes a JOIN files f ON f.id = a.file_id WHERE a.acte_id = $1 ORDER BY a.ordre, a.id', [acte.id]);
        for (const [i, a] of annexes.entries()) parts.push({ titre: `Annexe ${i + 1} : ${a.titre}`, pdf: { buffer: await storage.get(a.storage_key), pageCount: a.pages } });
        return svc.assemble({ organismeId: acte.organisme_id, titre: `Dossier n° ${acte.numero_suivi} — ${acte.titre}`, parts, vars: await svc.varsFor(acte, null), watermark });
      }
      throw E.badRequest('cible inconnue');
    },

    /** Sommaire paginé + fusion des pièces (pdf-lib), utilisé par le dossier complet et repris par le cahier de séance. */
    async assemble({ organismeId, titre, parts, vars, watermark }) {
      let page = 2; const lines = [];
      for (const p of parts) { lines.push({ titre: p.titre, page }); page += p.pdf.pageCount; }
      const content = [
        { type: 'title', text: 'SOMMAIRE', size: 16, align: 'center', bold: true, boxed: true, after: 14 },
        { type: 'runs', runs: [{ type: 'text', text: lines.map((l) => `${l.titre} — page ${l.page}`).join('\n') }] },
      ];
      const sommaire = await svc.build({ organismeId, docType: 'sommaire', content, vars, watermark: '', title: `Sommaire — ${titre}` });
      const merged = await svc.mergePdfs([sommaire.buffer, ...parts.map((p) => p.pdf.buffer)]);
      return { buffer: merged.buffer, pageCount: merged.pageCount, sommaire: lines };
    },

    async mergePdfs(buffers) {
      const out = await PDFDocument.create();
      for (const b of buffers) {
        const src = await PDFDocument.load(b, { updateMetadata: false });
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      }
      out.setProducer('IvryDélib');
      return { buffer: Buffer.from(await out.save()), pageCount: out.getPageCount() };
    },

    /** Aperçu d'étalonnage d'un gabarit : texte d'exemple sur le fond, pour régler les marges (PRE-04). */
    async sample(ctx, organismeId, docType) {
      const tpl = await svc.getTemplate(organismeId, docType);
      const lorem = '# Visa et considérants\nVu le code général des collectivités territoriales, notamment ses articles L. 2121-29 et suivants ;\nConsidérant que la **subvention** demandée correspond aux objectifs de la politique municipale ;\n- premier point à retenir ;\n- second point à retenir ;\n\n'
        + 'Le conseil municipal, après en avoir délibéré, décide d\'attribuer une subvention de fonctionnement. '.repeat(14);
      const vars = { organisme: 'Nom de la collectivité', titre: 'Titre de l\'acte (exemple)', rubrique: 'RUBRIQUE', matiere: '7.5 Subventions', date_seance: '1ER JANVIER 2030', numero_suivi: 1, numero: '2030-01-001', direction: 'Direction', service: 'Service', redacteur: 'agent', nature: 'Délibérations', statut: 'brouillon', date_du_jour: new Date().toLocaleDateString('fr-FR') };
      return svc.build({ organismeId, docType, content: [...svc.headerItems(tpl.cfg), { type: 'runs', runs: [{ text: lorem, type: 'text' }] }], vars, title: 'Aperçu du gabarit' });
    },
  };
  return svc;
}

module.exports = { createRender, DOC_TYPES };
