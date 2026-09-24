/**
 * Service de rendu PDF (RenderPort, section 12) : PDF de fond + gabarit paramétrable, même pipeline pour l'aperçu et le
 * document final (PRE-09) ; cache par empreinte du contenu et de la version du gabarit (PRE-11).
 */
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { inspectPdf } = require('../../shared/infra');
const { resolveConfig, DEFAULTS } = require('./defaults');
const { convertirEnPdf } = require('../../shared/convert');
const D = require('./docx.service');
const T = require('./typeset');
const { numeroAffiche, odjContent, odjMarkdown, odjInterneContent } = require('../seances/odj.service');

const DOC_TYPES = Object.keys(DEFAULTS);
const FINAL = ['adopte', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis', 'ar_recu', 'publie', 'executoire', 'archive'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const A4_TOL = 6; // points

// ---- mise en forme des listes d'élus (présences) ----------------------------------------------------------------
const sansAccent = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const CIV_FEMININ = new Set(['mehadee', 'fenda', 'kheira', 'farida', 'ouarda', 'alexandra', 'audrey', 'fabienne', 'malika', 'marie', 'claire', 'sophie', 'nathalie', 'isabelle', 'sandrine', 'celine', 'valerie', 'caroline', 'emilie', 'julie', 'aurelie', 'helene', 'chantal', 'michele', 'francoise', 'monique', 'christine', 'patricia', 'catherine', 'sylvie', 'veronique', 'laurence', 'anne', 'brigitte', 'nicole', 'danielle', 'martine', 'josette', 'colette', 'genevieve', 'yvette', 'odette', 'eva', 'sarah', 'lea', 'emma', 'nora', 'amira', 'ines', 'lucie', 'camille', 'charlotte', 'manon', 'juliette', 'oceane', 'elodie', 'anais', 'margaux', 'coralie', 'amelie', 'pauline', 'mathilde', 'clara', 'lise', 'lisa', 'agathe', 'alice', 'louise', 'jade', 'lina', 'rose', 'anna', 'laura', 'nina', 'zoe']);
const CIV_MASCULIN = new Set(['pierre', 'philippe', 'antoine', 'baptiste', 'alexandre', 'guillaume', 'jerome', 'frederic', 'olivier', 'paul', 'pascal', 'michel', 'daniel', 'gabriel', 'samuel', 'emile', 'raphael', 'thibault', 'thibaut', 'claude', 'dominique', 'maxime', 'charles', 'georges', 'jacques', 'francois', 'nicolas', 'vincent', 'simon', 'sebastien', 'karim', 'ayoub', 'malik', 'jubaid', 'laurent', 'stephane', 'christophe', 'david', 'julien', 'benjamin', 'mathieu', 'romain', 'florian', 'quentin', 'lucas', 'hugo', 'theo', 'nathan', 'adrien', 'fabien', 'damien', 'cyril', 'gregory', 'arnaud', 'bertrand', 'clement', 'remi', 'yann', 'gael', 'loic', 'sacha', 'jean-francois']);
/** Genre : la civilité du Hub DSI (« Mme ») fait foi ; à défaut, déduit du prénom (masculin par défaut). */
function femininElu(m) {
  const c = sansAccent(m?.civilite);
  if (c) { if (/^(mme|mlle|mle|f|femme|madame)/.test(c)) return true; if (/^(m\.?|mr|monsieur|homme)/.test(c)) return false; }
  const p = sansAccent(m?.prenom);
  return CIV_FEMININ.has(p) || (!CIV_MASCULIN.has(p) && /(?:a|ie|ine|ette|elle|enne|yne|ise|ande|ude)$/.test(p));
}
/** Civilité : « Mme NOM » ou « M. NOM ». */
const civElu = (m) => `${femininElu(m) ? 'Mme' : 'M.'} ${String(m?.nom || '').trim()}`.trim();
/** Absent représenté : accord au féminin (« Mme X, représentée par M. Y »). */
const representePar = (mandant, mandataire) => `${civElu(mandant)}, ${femininElu(mandant) ? 'représentée' : 'représenté'} par ${civElu(mandataire)}`;
const GROUPE_ROLE = (m) => { const r = sansAccent(m?.role); return (r.includes('maire') && !r.includes('adjoint')) ? 0 : r.includes('adjoint') ? 1 : r.includes('conseiller') ? 2 : 3; };
const LIBELLE_GROUPE = { 0: 'Maire', 1: 'adjoints au Maire', 2: 'conseillers municipaux.', 3: 'membres' };
/** Liste des élus groupés par rôle : « M. X, Maire » puis les adjoints, puis les conseillers (lignes séparées). */
function listeParRole(membres) {
  const groupes = new Map();
  for (const m of membres || []) { const g = GROUPE_ROLE(m); if (!groupes.has(g)) groupes.set(g, []); groupes.get(g).push(civElu(m)); }
  return [...groupes.keys()].sort((a, b) => a - b).map((g) => `${groupes.get(g).join(', ')}, ${LIBELLE_GROUPE[g]}`).join('\n\n');
}

/** Points fictifs pour l'aperçu d'un ordre du jour (aucune séance) : deux dossiers par commission, puis questions diverses. */
function odjSampleItems(noms) {
  const items = [];
  noms.forEach((nom, idx) => {
    const base = idx * 2 + 1;
    items.push({ numero: `EX-${String(base).padStart(3, '0')}`, titre: `Dossier d'exemple ${base} — point de ${nom}`, kind: 'deliberation', rapporteur: 'Rapporteur·e (exemple)', rubrique: 'EXEMPLE', commissionPrincipale: { id: idx + 1, nom }, commissions: [{ nom, principale: true }, ...(idx === 0 && noms[1] ? [{ nom: noms[1], principale: false }] : [])] });
    items.push({ numero: `EX-${String(base + 1).padStart(3, '0')}`, titre: `Dossier d'exemple ${base + 1} — second point de ${nom}`, kind: 'deliberation', rapporteur: 'Rapporteur·e (exemple)', rubrique: 'EXEMPLE', commissionPrincipale: { id: idx + 1, nom }, commissions: [{ nom, principale: true }] });
  });
  items.push({ numero: null, titre: 'Questions diverses', kind: 'libre', numerote: false, commissionPrincipale: null, commissions: [] });
  return items;
}

function createRender({ db, audit, storage, actes, config, annexes }) {
  const measures = new Map();
  const measure = (family = 'interstate') => { if (!measures.has(family)) measures.set(family, T.createMeasure(family, config.fontsDir)); return measures.get(family); };
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
        bgFirstFileId: r?.bg_first_file_id ?? null, bgNextFileId: r?.bg_next_file_id ?? null,
        docxFileId: r?.docx_file_id ?? null, docx: !!r?.docx_file_id, personnalise: !!r,
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

    // ---- modèles Word (.docx) -----------------------------------------------------------------------------------------
    /** Dépose le modèle Word (.docx) d'un gabarit : c'est lui qui est fusionné avec les zones à la génération. */
    async setDocxTemplate(ctx, organismeId, docType, file) {
      const org = requireOrg(organismeId);
      if (!file?.buffer) throw E.badRequest('Fichier manquant (champ « file »)');
      const nom = String(file.originalname || 'modele.docx');
      const zip = file.buffer.length > 3 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
      if (!/\.docx$/i.test(nom) || !zip) throw E.badRequest('Le modèle doit être un fichier Word .docx');
      const put = await storage.put(file.buffer, { organismeId: org, ext: 'docx' });
      const f = await db.get(
        `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7) RETURNING *`,
        [org, put.key, nom.slice(0, 200), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', put.size, put.sha256, ctx.username]);
      const r = await db.get(
        `INSERT INTO render_templates (organisme_id, doc_type, config, docx_file_id, updated_by) VALUES ($1,$2,'{}'::jsonb,$3,$4)
         ON CONFLICT (organisme_id, doc_type) DO UPDATE SET docx_file_id = EXCLUDED.docx_file_id, version = render_templates.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
        [org, docType, f.id, ctx.username]);
      await db.run('INSERT INTO render_template_versions (template_id, version, config, bg_first_file_id, bg_next_file_id, docx_file_id, saved_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7)',
        [r.id, r.version, JSON.stringify(r.config), r.bg_first_file_id, r.bg_next_file_id, r.docx_file_id, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'gabarit.docx', entity: 'render_templates', entityId: r.id, after: { docType, sha256: f.sha256, nom: f.original_name } });
      return svc.getTemplate(org, docType);
    },
    async removeDocxTemplate(ctx, organismeId, docType) {
      const org = requireOrg(organismeId);
      await db.run('UPDATE render_templates SET docx_file_id = NULL, version = version + 1 WHERE organisme_id = $1 AND doc_type = $2', [org, docType]);
      await audit.log(ctx, { organismeId: org, action: 'gabarit.docx_retire', entity: 'render_templates', after: { docType } });
      return svc.getTemplate(org, docType);
    },
    async docxBytes(fileId) {
      if (!fileId) return null;
      const f = await db.get('SELECT storage_key, original_name, sha256 FROM files WHERE id = $1', [fileId]);
      return f ? { bytes: await storage.get(f.storage_key), name: f.original_name, sha256: f.sha256 } : null;
    },

    // ---- acte rédigé hors application (document source PDF / Word) ---------------------------------------------------
    /** Document source d'un acte (rédigé hors application) : { fileId, pdfId, trame } ou null. */
    sourceOf(a) { return a?.document_source_file_id ? { fileId: a.document_source_file_id, pdfId: a.document_source_pdf_file_id, trame: a.document_source_trame || null } : null; },

    /** Le PDF de consultation du document source (Word converti, trame éventuellement ajoutée). */
    async sourcePdf(acte) {
      const f = await db.get('SELECT storage_key, original_name, pages FROM files WHERE id = $1', [acte.document_source_pdf_file_id]);
      if (!f) throw E.notFound('Document source introuvable');
      return { buffer: await storage.get(f.storage_key), pageCount: f.pages, name: f.original_name };
    },

    /**
     * Pose la trame de la collectivité (en-tête et pied de page du gabarit) dans les marges d'un document PDF
     * rédigé hors application. Le document lui-même n'est pas modifié en profondeur : on ajoute l'habillage dans
     * les marges (l'en-tête ne peut pas être placé « sous » un contenu existant). `a` = acte source.
     */
    async apposerTrame(organismeId, buffer, a, docType) {
      const org = requireOrg(organismeId);
      const tpl = await svc.getTemplate(org, docType || 'deliberation');
      const cfg = tpl.cfg; const vars = await svc.varsFor(a, null);
      const doc = await PDFDocument.load(buffer, { updateMetadata: false });
      const times = (cfg.police?.famille === 'times');
      const font = await doc.embedFont(times ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
      const bold = await doc.embedFont(times ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
      const M = cfg.marges || {}; const mm = (v, d) => (v ?? d) * T.MM;
      const remplace = (s) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      const pages = doc.getPages();
      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        let y = height - 6;
        for (const b of cfg.entete || []) {
          const txt = remplace(b.texte); if (!txt.trim()) { y -= 10; continue; }
          const size = Number(b.taille) || 10; const f = b.gras ? bold : font;
          const w = f.widthOfTextAtSize(txt, size);
          const x = b.align === 'center' ? (width - w) / 2 : b.align === 'right' ? width - mm(M.droite, 22) - w : mm(M.gauche, 22);
          page.drawText(txt, { x, y: y - size, size, font: f, color: rgb(0, 0, 0) });
          y -= size * 1.6;
        }
        const pied = remplace(cfg.pied?.texte); const yb = mm(M.bas, 25) - 16;
        if (pied.trim()) { const size = 8; page.drawText(pied, { x: mm(M.gauche, 22), y: yb, size, font, color: rgb(0.25, 0.25, 0.25) }); }
        if (cfg.pied?.pagination !== false) { const t = `${i + 1}/${pages.length}`; const w = font.widthOfTextAtSize(t, 8); page.drawText(t, { x: width - mm(M.droite, 22) - w, y: yb, size: 8, font, color: rgb(0.25, 0.25, 0.25) }); }
      });
      return Buffer.from(await doc.save());
    },

    /** Joint (ou remplace) le document source d'un acte : PDF conservé tel quel, Word converti en PDF. */
    async setSource(ctx, organismeId, acteId, { trame = 'presente' }, file) {
      const org = requireOrg(organismeId);
      const a = await actes.load(ctx, org, acteId, { edit: true });
      if (!file?.buffer) throw E.badRequest('Fichier manquant (champ « file »)');
      if (!['presente', 'a_ajouter'].includes(trame)) throw E.badRequest('Réponse attendue sur la trame : « presente » ou « a_ajouter »');
      // eslint-disable-next-line no-control-regex
      const nom = String(file.originalname || 'document').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
      const isDocx = /\.docx$/i.test(nom) || (file.buffer[0] === 0x50 && file.buffer[1] === 0x4b);
      const put = await storage.put(file.buffer, { organismeId: org, ext: isDocx ? 'docx' : 'pdf' });
      let pages = null;
      if (!isDocx) { const info = await inspectPdf(file.buffer); pages = info.pages; }
      const src = await db.get(
        `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [org, put.key, nom, isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', put.size, pages, put.sha256, ctx.username]);
      // PDF de consultation : conversion du Word si besoin, puis pose de la trame si elle manque.
      let pdfBuffer = isDocx ? await convertirEnPdf(file.buffer, 'docx') : file.buffer;
      if (!pdfBuffer) throw E.incomplete('Conversion Word → PDF indisponible sur le serveur (LibreOffice absent)');
      const meta = (await db.get('SELECT code FROM ref_items WHERE id = $1', [a.type_id]))?.code || null;
      const docType = meta === 'decision' ? 'decision' : meta === 'arrete' ? 'arrete' : 'deliberation';
      if (trame === 'a_ajouter') pdfBuffer = await svc.apposerTrame(org, pdfBuffer, a, docType);
      const info2 = await inspectPdf(pdfBuffer); pages = info2.pages;
      let pdfId = src.id;
      if (isDocx || trame === 'a_ajouter') {
        const p2 = await storage.put(pdfBuffer, { organismeId: org, ext: 'pdf' });
        const pf = await db.get(
          `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7) RETURNING *`,
          [org, p2.key, nom.replace(/\.docx$/i, '') + '.pdf', p2.size, pages, p2.sha256, ctx.username]);
        pdfId = pf.id;
      }
      await db.run('UPDATE actes SET document_source_file_id = $2, document_source_pdf_file_id = $3, document_source_trame = $4 WHERE id = $1', [a.id, src.id, pdfId, trame]);
      await audit.log(ctx, { organismeId: org, action: 'acte.document_source', entity: 'actes', entityId: a.id, after: { nom, mime: src.mime, trame, pages } });
      return svc.sourcePdf({ document_source_pdf_file_id: pdfId });
    },

    async removeSource(ctx, organismeId, acteId) {
      const org = requireOrg(organismeId);
      const a = await actes.load(ctx, org, acteId, { edit: true });
      await db.run('UPDATE actes SET document_source_file_id = NULL, document_source_pdf_file_id = NULL, document_source_trame = NULL WHERE id = $1', [a.id]);
      await audit.log(ctx, { organismeId: org, action: 'acte.document_source_retire', entity: 'actes', entityId: a.id });
    },

    /** Le PDF de consultation du document joint (contrôle de visibilité de l'acte). */
    async sourceFile(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      if (!a.document_source_pdf_file_id) throw E.notFound('Aucun document joint à cet acte');
      return svc.sourcePdf(a);
    },

    /**
     * État de présence d'une séance (saisi à la tenue de séance) : membres, présents, absents représentés (pouvoirs),
     * absents excusés et non excusés, et les listes de noms. Mêmes règles que l'extrait du registre (pv.service).
     */
    async presenceSeance(organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const vide = { membres: 0, presents: 0, representes: 0, excuses: 0, nonExcuses: 0, listePresents: '', listeRepresentes: '', listeExcuses: '', listeNonExcuses: '' };
      if (!seanceId) return vide;
      const s = await db.get('SELECT s.id, i.commission_id FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1', [seanceId]);
      if (!s) return vide;
      const membres = s.commission_id
        ? await db.all('SELECT e.id, e.nom, e.prenom FROM commission_membres cm JOIN elus e ON e.id = cm.elu_id WHERE cm.commission_id = $1 AND e.actif', [s.commission_id])
        : await db.all('SELECT id, nom, prenom FROM elus WHERE organisme_id = $1 AND actif', [org]);
      const presences = new Map((await db.all('SELECT elu_id, statut FROM seance_presences WHERE seance_id = $1', [seanceId])).map((r) => [r.elu_id, r.statut]));
      const procs = await db.all('SELECT mandant_elu_id AS mandant, mandataire_elu_id AS mandataire FROM seance_procurations WHERE seance_id = $1', [seanceId]);
      const ids = new Set(membres.map((m) => m.id));
      const parId = new Map(membres.map((m) => [m.id, m]));
      const presents = membres.filter((m) => presences.get(m.id) === 'present');
      const excuses = membres.filter((m) => presences.get(m.id) === 'excuse');
      const absents = membres.filter((m) => !presences.get(m.id) || presences.get(m.id) === 'absent');
      const pouvoirs = procs.filter((p) => ids.has(p.mandant) && ids.has(p.mandataire));
      const representes = new Set(pouvoirs.map((p) => p.mandant));
      const exNrep = excuses.filter((m) => !representes.has(m.id));
      const abNrep = absents.filter((m) => !representes.has(m.id));
      return {
        membres: membres.length, presents: presents.length, representes: pouvoirs.length, excuses: exNrep.length, nonExcuses: abNrep.length,
        listePresents: listeParRole(presents),
        listeRepresentes: pouvoirs.map((p) => representePar(parId.get(p.mandant), parId.get(p.mandataire))).join('\n'),
        listeExcuses: exNrep.map((m) => civElu(m)).join(', '),
        listeNonExcuses: abNrep.map((m) => civElu(m)).join(', '),
      };
    },

    /**
     * Mentions de transmission à la préfecture (télégransmission) : numéro transmis, dates de transmission, d'accusé de
     * réception (préfecture) et de publication par voie d'affichage. Mêmes règles que l'extrait du registre (pv.service).
     */
    async prefecture(organismeId, acteId) {
      requireOrg(organismeId);
      const tx = await db.get("SELECT numero_transmis, ar_id, ar_at, sent_at, date_affichage FROM tlt_transactions WHERE acte_id = $1 AND etat = 'poste' AND ar_id IS NOT NULL ORDER BY id DESC LIMIT 1", [acteId]);
      const jourFr = (x) => (x ? new Date(x).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }) : '');
      const affichage = jourFr(tx?.date_affichage ? `${String(tx.date_affichage).slice(0, 10)}T12:00:00Z` : tx?.ar_at);
      const transmis = jourFr(tx?.sent_at); const recu = jourFr(tx?.ar_at);
      const mention = (transmis || recu || affichage)
        ? `TRANSMIS EN PRÉFECTURE LE ${transmis}\nREÇU EN PRÉFECTURE LE ${recu}\nPUBLIÉ PAR VOIE D'AFFICHAGE LE ${affichage}`
        : '';
      return { numero: tx?.numero_transmis || '', transmis, recu, affichage, mention };
    },

    /** Variables du modèle Word : métadonnées de l'acte (varsFor) + zones de la délibération (exposé, visas, dispositif). */
    async docxVariables(ctx, organismeId, acteId, { deliberationId } = {}) {
      const org = requireOrg(organismeId);
      const acte = await actes.load(ctx, org, acteId);
      const { pick, delibs } = await svc.textsFor(ctx, acte);
      const d = delibs.find((x) => x.id === Number(deliberationId)) || (delibs.length === 1 ? delibs[0] : null);
      const base = await svc.varsFor(acte, d);
      const md = (row) => D.markdownToRich(row?.markdown || '');
      const out = {};
      for (const [k, v] of Object.entries(base)) out[`{${k}}`] = v === null || v === undefined ? '' : String(v);
      out['{titre}'] = acte.titre || '';
      out['{numero_suivi}'] = String(acte.numero_suivi ?? '');
      out['{deliberation}'] = d?.titre || '';
      out['{expose}'] = md(pick('expose', null));
      out['{visas}'] = md(pick('visas', d?.id));
      out['{considere}'] = md(pick('visas', d?.id));
      out['{visas_considerants}'] = md(pick('visas', d?.id));
      out['{dispositif}'] = md(pick('dispositif', d?.id));
      out['{delibere}'] = md(pick('dispositif', d?.id));
      // État de présence de la séance (tenue de séance) : membres, présents, représentés, excusés, non excusés.
      const p = await svc.presenceSeance(org, acte.seance_id || acte.seance_visee_id);
      out['{membres_conseil}'] = String(p.membres);
      out['{conseillers_exercice}'] = String(p.membres);
      out['{presents}'] = String(p.presents);
      out['{absents_representes}'] = String(p.representes);
      out['{absents_excuses}'] = String(p.excuses);
      out['{absents_non_excuses}'] = String(p.nonExcuses);
      out['{liste_presents}'] = p.listePresents;
      out['{liste_absents_representes}'] = p.listeRepresentes;
      out['{liste_absents_excuses}'] = p.listeExcuses;
      out['{liste_absents_non_excuses}'] = p.listeNonExcuses;
      // Mentions de transmission à la préfecture (télégransmission).
      const tx = await svc.prefecture(org, acteId);
      out['{numero_transmis}'] = tx.numero;
      out['{transmis_prefecture}'] = tx.transmis;
      out['{recu_prefecture}'] = tx.recu;
      out['{publie_affichage}'] = tx.affichage;
      out['{mention_transmission}'] = tx.mention;
      return out;
    },

    /** Modèle Word fusionné pour un acte : renvoie un tampon .docx. */
    async renderDocx(ctx, organismeId, acteId, { docType = 'deliberation', deliberationId } = {}) {
      const org = requireOrg(organismeId);
      const tpl = await svc.getTemplate(org, docType);
      if (!tpl.docxFileId) throw E.badRequest(`Aucun modèle Word n'est défini pour le gabarit « ${docType} »`);
      const modele = await svc.docxBytes(tpl.docxFileId);
      const vars = await svc.docxVariables(ctx, org, acteId, { deliberationId });
      const buffer = await D.remplir(modele.bytes, vars);
      return { buffer, name: `modele-${docType}-${acteId}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    },

    /** Modèle Word fusionné puis converti en PDF (LibreOffice). */
    async renderDocxPdf(ctx, organismeId, acteId, opts) {
      const d = await svc.renderDocx(ctx, organismeId, acteId, opts);
      const pdf = await convertirEnPdf(d.buffer, 'docx');
      if (!pdf) throw E.incomplete('Conversion Word → PDF indisponible sur le serveur (LibreOffice absent)');
      const info = await inspectPdf(pdf);
      return { buffer: pdf, pageCount: info.pages, name: d.name.replace(/\.docx$/, '.pdf') };
    },

    /** Aperçu du modèle Word avec des DONNÉES DE TEST (aucun acte réel) : sert à contrôler le gabarit. */
    async docxSample(ctx, organismeId, docType) {
      const org = requireOrg(organismeId);
      const tpl = await svc.getTemplate(org, docType);
      if (!tpl.docxFileId) throw E.badRequest(`Aucun modèle Word n'est défini pour le gabarit « ${docType} »`);
      const visas = 'Vu le code général des collectivités territoriales, notamment ses articles L. 2121-29 et suivants ;\nConsidérant que la subvention demandée correspond aux objectifs de la politique municipale ;';
      // Présences : les VRAIS élus de la collectivité, répartis (la plupart présents, quelques absents) pour juger la mise en page.
      const elus = await db.all(`SELECT id, nom, prenom, role FROM elus WHERE organisme_id = $1 AND actif
        ORDER BY (role = 'Maire') DESC, (role ILIKE 'Adjoint%') DESC, nom, prenom`, [org]);
      let pres = { liste_presents: 'M. Exemple, Maire', liste_absents_representes: '', liste_absents_excuses: '', liste_absents_non_excuses: '', membres_conseil: '1', presents: '1', absents_representes: '0', absents_excuses: '0', absents_non_excuses: '0' };
      if (elus.length >= 5) {
        const nRep = 2; const nExc = 1; const nNon = 1;
        const pList = elus.slice(0, elus.length - (nRep + nExc + nNon));
        const rList = elus.slice(pList.length, pList.length + nRep);
        const eList = elus.slice(pList.length + nRep, pList.length + nRep + nExc);
        const nList = elus.slice(pList.length + nRep + nExc);
        pres = {
          liste_presents: listeParRole(pList),
          liste_absents_representes: rList.map((m, i) => `${civElu(m)}, représenté par ${civElu(pList[i % pList.length])}`).join('\n'),
          liste_absents_excuses: eList.map((m) => civElu(m)).join(', '),
          liste_absents_non_excuses: nList.map((m) => civElu(m)).join(', '),
          membres_conseil: String(elus.length), presents: String(pList.length),
          absents_representes: String(rList.length), absents_excuses: String(eList.length), absents_non_excuses: String(nList.length),
        };
      }
      const variables = {
        organisme: 'Ville d’Ivry-sur-Seine', adresse: 'Esplanade Georges Marrane — 94200 Ivry-sur-Seine', ville: 'Ivry-sur-Seine', code_postal: '94200',
        telephone: '01 49 60 20 00', email: 'contact@ivry94.fr', site_web: 'www.ivry94.fr', signataire: 'Le Maire',
        titre: 'Attribution d’une subvention à l’association Les Amis du Sport (exemple)', numero_suivi: '1', numero: '2030-01-001',
        deliberation: 'Délibération (exemple)', date_seance: '1ER JANVIER 2030', date_du_jour: new Date().toLocaleDateString('fr-FR'),
        direction: 'Direction des finances', service: 'Budget', redacteur: 'agent', matiere: '7.5 Subventions', rubrique: 'SPORTS', nature: 'Délibérations', statut: 'brouillon',
        expose: 'Il est proposé d’attribuer une subvention de fonctionnement de 1 500 € à l’association « Les Amis du Sport ».',
        visas, considere: visas, visas_considerants: visas,
        dispositif: 'Article 1 : une subvention de 1 500 € est attribuée à l’association « Les Amis du Sport ».\nArticle 2 : la présente délibération sera transmise au contrôle de légalité.',
        ...pres, conseillers_exercice: pres.membres_conseil,
        numero_transmis: 'PR-2030-001', transmis_prefecture: '02/01/2030', recu_prefecture: '06/01/2030', publie_affichage: '06/01/2030',
        mention_transmission: "TRANSMIS EN PRÉFECTURE LE 02/01/2030\nREÇU EN PRÉFECTURE LE 06/01/2030\nPUBLIÉ PAR VOIE D'AFFICHAGE LE 06/01/2030",
      };
      // Ordre du jour : le modèle Word reçoit la liste des points fictifs (sections par commission) via {ordre_du_jour}.
      if (docType === 'odj') {
        const coms = await db.all("SELECT nom FROM commissions WHERE organisme_id = $1 AND actif AND type = 'actes' ORDER BY ordre, nom LIMIT 4", [org]);
        variables.ordre_du_jour = D.markdownToRich(odjMarkdown(odjSampleItems(coms.length ? coms.map((c) => c.nom) : ['La Ville qui débat', 'La Ville en transition'])));
      }
      const vars = Object.fromEntries(Object.entries(variables).map(([k, v]) => [`{${k}}`, String(v ?? '')]));
      const modele = await svc.docxBytes(tpl.docxFileId);
      const buffer = await D.remplir(modele.bytes, vars);
      return { buffer, name: `apercu-${docType}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    },

    /** Aperçu du modèle Word (données de test) converti en PDF. */
    async docxSamplePdf(ctx, organismeId, docType) {
      const d = await svc.docxSample(ctx, organismeId, docType);
      const pdf = await convertirEnPdf(d.buffer, 'docx');
      if (!pdf) throw E.incomplete('Conversion Word → PDF indisponible sur le serveur (LibreOffice absent)');
      const info = await inspectPdf(pdf);
      return { buffer: pdf, pageCount: info.pages, name: d.name.replace(/\.docx$/, '.pdf') };
    },

    // ---- composition --------------------------------------------------------------------------------------------------
    /** Logo de l'organisme à poser en tête de la première page, mis à l'échelle (points) ; null si non demandé ou absent. */
    async logoFor(organismeId, cfg, hasBackground) {
      const opt = cfg.logo?.afficher;
      if (opt === false || (opt !== true && hasBackground)) return null;
      const r = await db.get('SELECT logo_path, logo_mime, logo_sha256 FROM organismes WHERE id = $1', [organismeId]);
      if (!r?.logo_path) return null;
      let bytes; try { bytes = await storage.get(r.logo_path); } catch { return null; }
      const d = await PDFDocument.create();
      const img = r.logo_mime === 'image/png' ? await d.embedPng(bytes) : await d.embedJpg(bytes);
      const w = (cfg.logo?.largeur ?? 28) * T.MM; const scaled = img.scale(w / img.width);
      return { bytes, mime: r.logo_mime, sha256: r.logo_sha256, w: scaled.width, h: scaled.height };
    },

    async varsFor(acte, delib) {
      const org = requireOrg(acte.organisme_id);
      const [orgRow, rub, mat, nat] = await Promise.all([
        db.get('SELECT nom, adresse, contact FROM organismes WHERE id = $1', [org]),
        acte.rubrique_id ? db.get('SELECT libelle FROM ref_items WHERE id = $1', [acte.rubrique_id]) : null,
        acte.matiere_id ? db.get('SELECT code, libelle FROM ref_items WHERE id = $1', [acte.matiere_id]) : null,
        acte.nature_id ? db.get('SELECT libelle FROM ref_items WHERE id = $1', [acte.nature_id]) : null,
      ]);
      const seance = acte.seance_id || acte.seance_visee_id ? await db.get('SELECT date_seance FROM seances WHERE id = $1', [acte.seance_id || acte.seance_visee_id]).catch(() => null) : null;
      // Numéro du dossier au conseil, dans l'ordre de passage (numéro du point à l'ordre du jour) : figé après l'arrêt, provisoire avant.
      const numeroPoint = await numeroAffiche(db, org, { acteId: acte.id, deliberationId: delib?.id }).catch(() => '');
      return {
        organisme: orgRow?.nom || '', adresse: orgRow?.adresse || '', ville: orgRow?.contact?.ville || '', code_postal: orgRow?.contact?.codePostal || '', telephone: orgRow?.contact?.telephone || '',
        email: orgRow?.contact?.email || '', site_web: orgRow?.contact?.siteWeb || '', signataire: orgRow?.contact?.signataire || '', numero_suivi: acte.numero_suivi, titre: delib?.titre || acte.titre, titre_dossier: acte.titre,
        rubrique: rub?.libelle || '', matiere: mat ? `${mat.code} ${mat.libelle}` : '', nature: nat?.libelle || '',
        direction: acte.direction_label || acte.direction_code, service: acte.service_label || '', redacteur: acte.redacteur, statut: acte.statut,
        date_seance: seance?.date_seance ? new Date(seance.date_seance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase() : '[date de séance à définir]',
        date_du_jour: new Date().toLocaleDateString('fr-FR'), numero: numeroPoint, numero_point: numeroPoint,
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
      const logo = await svc.logoFor(organismeId, cfg, !!bf);
      const key = sha(JSON.stringify({ docType, content, cfg, vars, wm, bf: bf?.sha256, bn: bn?.sha256, v: tpl.version, logo: logo?.sha256 }));
      if (cache.has(key)) return cache.get(key);
      const layout = T.layoutDocument({ content, cfg, vars, measure: await measure(cfg.police?.famille), logo });
      const out = await T.paintDocument({ layout, cfg, vars, bgFirst: bf?.bytes, bgNext: bn?.bytes, watermark: wm || null, title, fontsDir: config.fontsDir, logo });
      return remember(key, { ...out, layout, key });
    },

    async textsFor(ctx, acte) {
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
    async renderActe(ctx, organismeId, acteId, { cible = 'expose', deliberationId, mode = 'propre', brouillon = false, watermark: wmOverride, avecAnnexes = true, docType: docTypeForce }) {
      const acte = await actes.load(ctx, organismeId, acteId);
      // Acte rédigé hors application : le document joint tient lieu de texte (aucune recomposition).
      const source = acte.document_source_pdf_file_id ? await svc.sourcePdf(acte) : null;
      const { pick, delibs } = await svc.textsFor(ctx, acte, cible, deliberationId);
      const watermark = wmOverride !== undefined ? wmOverride : (FINAL.includes(acte.statut) ? '' : undefined);
      // Le gabarit de l'acte dépend de son TYPE : une décision (ou un arrêté) utilise son propre gabarit d'acte
      // signé, pas celui de la délibération. `docTypeForce` permet de forcer un gabarit depuis l'aperçu.
      const meta = (await db.get('SELECT code FROM ref_items WHERE id = $1', [acte.type_id]))?.code || null;
      const acteType = docTypeForce === 'deliberation' ? 'deliberation'
        : meta === 'decision' ? 'decision' : meta === 'arrete' ? 'arrete' : 'deliberation';
      // Libellé du bloc de dispositif : propre au type signé (décision/arrêté) ou « le conseil DÉCIDE ».
      const defautDispositif = acteType === 'deliberation' ? 'Après en avoir délibéré, le conseil DÉCIDE :' : 'DÉCIDE :';

      const runs = async (row) => {
        if (!row) return [{ text: '', type: 'text' }];
        if (brouillon) { const d = await svc.draftOf(ctx, row); if (d !== null) return [{ text: d, type: 'text' }]; }
        return svc.runsOf({ ...row, markdown: row.markdown }, mode);
      };

      // Si le gabarit correspondant a un modèle Word (.docx), c'est LUI le bon gabarit : on le fusionne puis on le
      // convertit en PDF. Sinon, on retombe sur la mise en page PDF (PDF de fond + en-tête/pied paramétrés).
      const docxPdf = async (docType, deliberationId) => {
        const t = await svc.getTemplate(acte.organisme_id, docType);
        return t.docxFileId ? svc.renderDocxPdf(ctx, acte.organisme_id, acteId, { docType, deliberationId }) : null;
      };

      const exposePdf = async () => {
        if (source) return source;
        const dx = await docxPdf('expose'); if (dx) return dx;
        const tpl = await svc.getTemplate(acte.organisme_id, 'expose');
        const vars = await svc.varsFor(acte, null);
        const content = [...svc.headerItems(tpl.cfg), { type: 'runs', runs: await runs(pick('expose', null)) }];
        return svc.build({ organismeId: acte.organisme_id, docType: 'expose', content, vars, watermark, title: `Exposé des motifs — ${acte.titre}` });
      };
      const delibPdf = async (d) => {
        if (source) return source;
        const dx = await docxPdf(acteType, d.id); if (dx) return dx;
        const tpl = await svc.getTemplate(acte.organisme_id, acteType);
        const vars = await svc.varsFor(acte, d);
        const dispLabel = tpl.cfg.sections?.dispositif ?? defautDispositif;
        const montrerVisas = meta !== 'decision'; // une décision n'a ni visas ni considérants
        const content = [
          ...svc.headerItems(tpl.cfg),
          ...(montrerVisas ? [{ type: 'runs', runs: await runs(pick('visas', d.id)) }, { type: 'space', h: 6 }] : []),
          ...(dispLabel ? [{ type: 'title', text: dispLabel, size: 11, bold: true, align: 'left', after: 4 }] : []),
          { type: 'runs', runs: await runs(pick('dispositif', d.id)) },
        ];
        return svc.build({ organismeId: acte.organisme_id, docType: acteType, content, vars, watermark, title: `${acteType === 'deliberation' ? 'Délibération' : acteType === 'decision' ? 'Décision' : 'Arrêté'} — ${d.titre}` });
      };
      const visasPdf = async (d) => {
        if (source) return source;
        const dx = await docxPdf('deliberation', d.id); if (dx) return dx;
        const tpl = await svc.getTemplate(acte.organisme_id, 'deliberation');
        const vars = await svc.varsFor(acte, d);
        const content = [...svc.headerItems(tpl.cfg), { type: 'runs', runs: await runs(pick('visas', d.id)) }];
        return svc.build({ organismeId: acte.organisme_id, docType: 'deliberation', content, vars, watermark, title: `Visas et considérants — ${d.titre}` });
      };
      const dispositifPdf = async (d) => {
        if (source) return source;
        const dx = await docxPdf(acteType, d.id); if (dx) return dx;
        const tpl = await svc.getTemplate(acte.organisme_id, acteType);
        const vars = await svc.varsFor(acte, d);
        const dispLabel = tpl.cfg.sections?.dispositif ?? defautDispositif;
        const content = [
          ...svc.headerItems(tpl.cfg),
          ...(dispLabel ? [{ type: 'title', text: dispLabel, size: 11, bold: true, align: 'left', after: 4 }] : []),
          { type: 'runs', runs: await runs(pick('dispositif', d.id)) },
        ];
        return svc.build({ organismeId: acte.organisme_id, docType: acteType, content, vars, watermark, title: `Délibéré — ${d.titre}` });
      };

      if (cible === 'expose') return exposePdf();
      if (cible === 'deliberation' || cible === 'visas' || cible === 'dispositif') {
        const d = delibs.find((x) => x.id === Number(deliberationId)) || (delibs.length === 1 ? delibs[0] : null);
        if (!d) throw E.badRequest('deliberationId requis (le dossier comporte plusieurs délibérations)');
        if (cible === 'visas') return visasPdf(d);
        if (cible === 'dispositif') return dispositifPdf(d);
        return delibPdf(d);
      }
      if (cible === 'dossier') {
        // Un modèle Word « dossier complet » (s'il est défini) remplace l'assemblage par parties.
        if (!source) { const dxDossier = await docxPdf('dossier'); if (dxDossier) return dxDossier; }
        const parts = source
          ? [{ titre: acte.titre, pdf: source }]
          : [{ titre: 'Exposé des motifs', pdf: await exposePdf() }];
        if (!source) for (const d of delibs) parts.push({ titre: `Délibération : ${d.titre}`, pdf: await delibPdf(d) });
        // `avecAnnexes=false` : la visionneuse affiche les annexes à part (documents navigables), pas fusionnées ici.
        if (avecAnnexes !== false) parts.push(...(await svc.annexParts(acte)));
        return svc.assemble({ organismeId: acte.organisme_id, titre: `Dossier n° ${acte.numero_suivi} — ${acte.titre}`, parts, vars: await svc.varsFor(acte, null), watermark });
      }
      throw E.badRequest('cible inconnue');
    },


    /**
     * Annexes d'un acte sous forme de pièces PDF (dossier complet, cahier de séance). Une annexe dont le fichier est introuvable
     * est remplacée par une page d'avertissement : le document reste imprimable. `onlyCommunicable` : profils « élus » et « public ».
     */
    async annexParts(acte, { onlyCommunicable = false } = {}) {
      // Word/Excel : on s'assure du PDF associé avant de composer le dossier (conversion mise en cache).
      if (annexes) {
        const ids = await db.all(`SELECT id FROM annexes WHERE acte_id = $1 ${onlyCommunicable ? 'AND communicable' : ''}`, [acte.id]);
        for (const r of ids) { try { await annexes.ensurePdf(acte.organisme_id, r.id); } catch { /* conversion indisponible : page d'avertissement ci-dessous */ } }
      }
      const rows = await db.all(`SELECT a.titre, a.ordre, COALESCE(pf.storage_key, f.storage_key) AS storage_key, COALESCE(pf.pages, f.pages) AS pages FROM annexes a JOIN files f ON f.id = a.file_id LEFT JOIN files pf ON pf.id = a.pdf_file_id WHERE a.acte_id = $1 ${onlyCommunicable ? 'AND a.communicable' : ''} ORDER BY a.ordre, a.id`, [acte.id]);
      const parts = [];
      for (const [i, a] of rows.entries()) {
        try { parts.push({ titre: `Annexe ${i + 1} : ${a.titre}`, pdf: { buffer: await storage.get(a.storage_key), pageCount: a.pages } }); }
        catch {
          const doc = await PDFDocument.create(); const pg = doc.addPage([T.A4.w, T.A4.h]);
          pg.drawText(`Annexe ${i + 1} : ${String(a.titre).replace(/[^ -~\u00A0-\u00FF]/g, '?')}`, { x: 56, y: 760, size: 14 });
          pg.drawText('Fichier indisponible sur le serveur : redeposez cette annexe.', { x: 56, y: 730, size: 11 });
          parts.push({ titre: `Annexe ${i + 1} : ${a.titre} (indisponible)`, pdf: { buffer: Buffer.from(await doc.save()), pageCount: 1 }, manquante: true });
        }
      }
      return parts;
    },

    /** Sommaire paginé + fusion des pièces (pdf-lib), utilisé par le dossier complet et repris par le cahier de séance. */
    async assemble({ organismeId, titre, parts, vars }) {
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
      out.setProducer('VibeDélib');
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

    /**
     * Ordre du jour composé au gabarit « odj » : si un MODÈLE WORD est défini, il est fusionné (variable
     * {ordre_du_jour} = liste des points, avec rupture par commission) puis converti en PDF ; sinon la mise en page
     * PDF interne est utilisée. Sert à la convocation (SCC) comme à l'aperçu.
     */
    async odjDocument({ organismeId, items, sousTitre = '', title = 'Ordre du jour' }) {
      const org = requireOrg(organismeId);
      const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
      const organisme = orgRow?.nom || '';
      const tpl = await svc.getTemplate(org, 'odj');
      if (tpl.docxFileId) {
        const variables = { organisme, instance: sousTitre, date_seance: sousTitre, ordre_du_jour: D.markdownToRich(odjMarkdown(items)) };
        const vars = Object.fromEntries(Object.entries(variables).map(([k, v]) => [`{${k}}`, String(v ?? '')]));
        const modele = await svc.docxBytes(tpl.docxFileId);
        const buffer = await D.remplir(modele.bytes, vars);
        const pdf = await convertirEnPdf(buffer, 'docx');
        if (!pdf) throw E.incomplete('Conversion Word → PDF indisponible sur le serveur (LibreOffice absent)');
        const info = await inspectPdf(pdf);
        return { buffer: pdf, pageCount: info.pages };
      }
      return svc.build({ organismeId: org, docType: 'odj', vars: {}, watermark: '', title, content: odjContent({ organisme, sousTitre, items }) });
    },

    /** Ordre du jour INTERNE (document de travail du SCC) : délibérations prévues, avancement, annexes, dernier passage. */
    async odjInterneDocument({ organismeId, items, sousTitre = '', title = 'Ordre du jour interne', tri = 'commission' }) {
      const org = requireOrg(organismeId);
      const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
      return svc.build({ organismeId: org, docType: 'odj-interne', vars: {}, watermark: '', title, content: odjInterneContent({ organisme: orgRow?.nom || '', sousTitre, items, tri }) });
    },

    /**
     * Aperçu d'un ordre du jour À BLANC : points fictifs répartis sur les commissions de l'organisme. Sert à vérifier
     * la mise en page du gabarit « odj » (rupture par commission, sections, pied de page) sans dépendre d'une séance.
     */
    async odjSample(organismeId) {
      const org = requireOrg(organismeId);
      const coms = await db.all("SELECT nom FROM commissions WHERE organisme_id = $1 AND actif AND type = 'actes' ORDER BY ordre, nom LIMIT 4", [org]);
      const noms = coms.length ? coms.map((c) => c.nom) : ['La Ville qui débat', 'La Ville en transition'];
      const doc = await svc.odjDocument({ organismeId: org, items: odjSampleItems(noms), sousTitre: 'Séance d\'exemple — 18h30 (aperçu)', title: 'Aperçu — Ordre du jour (exemple)' });
      return { ...doc, name: 'apercu-odj.pdf' };
    },

    /** Le nom du fichier PDF d'un rendu, pour que le parapheur affiche le vrai titre du document (jamais « blob »). */
    nomFichier(titre, suffixe = 'pdf') {
      const base = String(titre || 'document')
        .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
        .replace(/[^\x20-\x7E\u00C0-\u017F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'document';
      return `${base}.${suffixe}`;
    },

    /**
     * Document d'essai pour le parapheur : une pièce courte « SANS VALEUR », au gabarit de la collectivité, pour
     * vérifier qu'un envoi en signature arrive bien au bon endroit sans engager de circuit ni de vrai acte.
     */
    async documentEssai(organismeId, { titre = 'Document de test — parapheur', signataire = null } = {}) {
      const tpl = await svc.getTemplate(organismeId, 'deliberation');
      const texte = [
        '**Ce document est un essai technique.** Il ne correspond à aucun acte : aucune délibération, décision ou arrêté.',
        'Il sert à vérifier, depuis les paramétrages, que VibeDélib remet bien un document au parapheur et que le signataire le reçoit.',
        'Si vous recevez ce document, l’envoi en signature est correctement configuré. Vous pouvez l’ignorer ou le refuser sans conséquence.',
      ].join('\n\n');
      const vars = {
        organisme: '', titre, rubrique: 'PARAPHEUR', matiere: 'Test de connexion', numero_suivi: '—', numero: '—',
        direction: '—', service: '', redacteur: 'VibeDélib', nature: '—', statut: 'test', date_du_jour: new Date().toLocaleDateString('fr-FR'),
      };
      const doc = await svc.build({
        organismeId, docType: 'deliberation', vars, watermark: 'SANS VALEUR', title: titre,
        content: [...svc.headerItems(tpl.cfg), { type: 'title', text: 'DOCUMENT DE TEST — SANS VALEUR', size: 14, align: 'center', bold: true, after: 10 },
          { type: 'runs', runs: [{ text: texte, type: 'text' }] },
          ...(signataire ? [{ type: 'space', h: 8 }, { type: 'title', text: `Destinataire de l’essai : ${signataire}`, size: 10, align: 'left', after: 4 }] : [])],
      });
      return { ...doc, name: svc.nomFichier(titre) };
    },
  };
  return svc;
}

module.exports = { createRender, DOC_TYPES, listeParRole, civElu };
