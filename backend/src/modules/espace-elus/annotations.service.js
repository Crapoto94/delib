/**
 * Annotations des élus sur les PDF (ELU-71 à ELU-76, D90).
 *
 * - Privées par défaut ; partage par annotation, document ou séance : avec mon groupe (membres figés à l'instant du partage) ou des élus nommés.
 * - Contenu chiffré au repos ; AUCUNE route ne le restitue à un agent : le SCC et l'administrateur ne voient que des compteurs.
 * - Ancrage : document + version + page + zones relatives + citation ; à l'ouverture d'une nouvelle version, le client ré-ancre par citation
 *   ou déclare l'annotation « orpheline » (conservée).
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { createSecretBox } = require('../../shared/secretbox');

const cap = (x) => String(x || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const nomOf = (e) => `${cap(e.prenom)} ${String(e.nom || '').toUpperCase()}`.trim();
const hex = (c) => { const n = parseInt(String(c || '#facc15').slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
/** Le PDF n'embarque qu'une police standard : les caractères hors WinAnsi sont remplacés par « ? » plutôt que de faire échouer l'export. */
const winAnsi = (font, s) => Array.from(String(s || '').replace(/\s+/g, ' ')).map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
const coupe = (font, texte, size, largeur) => {
  const lignes = []; let ligne = '';
  for (const mot of winAnsi(font, texte).split(' ')) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (font.widthOfTextAtSize(essai, size) > largeur && ligne) { lignes.push(ligne); ligne = mot; } else ligne = essai;
  }
  if (ligne) lignes.push(ligne);
  return lignes;
};

function createAnnotations({ db, audit, config, espace, settings }) {
  const box = createSecretBox(config?.jwt?.secret || 'dev', 'annotations');

  async function seanceAccessible(elu, seanceId) {
    if (!(await espace.seanceIds(elu)).includes(Number(seanceId))) throw E.notFound('Séance introuvable');
  }
  async function seanceDeCle(key) {
    const [k, a] = String(key).split(':');
    if (['v', 'o', 'c'].includes(k)) return Number(a);
    if (['p', 'a', 'f'].includes(k)) return (await db.get('SELECT seance_id FROM seance_items WHERE id = $1', [Number(a)]))?.seance_id ?? null;
    return null;
  }
  async function miennes(elu, id) {
    const a = await db.get('SELECT * FROM elu_annotations WHERE id = $1 AND elu_id = $2', [id, elu.id]);
    if (!a) throw E.notFound('Annotation introuvable');
    return a;
  }
  /** Destinataires possibles : élus actifs de l'organisme qui ont accès à cette séance (jamais l'auteur). */
  async function destinatairesValides(elu, seanceId, ids) {
    const rows = await db.all('SELECT id FROM elus WHERE organisme_id = $1 AND actif AND est_elu AND id = ANY($2::int[]) AND id <> $3', [elu.organismeId, ids, elu.id]);
    const ok = [];
    for (const r of rows) if ((await espace.seanceIds({ id: r.id, organismeId: elu.organismeId })).includes(Number(seanceId))) ok.push(r.id);
    return ok;
  }

  const vue = (a, elu, ctx) => ({
    id: a.id, seanceId: a.seance_id, docKey: a.doc_key, docVersion: a.doc_version, page: a.page, kind: a.kind, rects: a.rects, trace: a.trace, couleur: a.couleur,
    citation: box.dechiffre(a.citation_c), contenu: box.dechiffre(a.contenu_c), orpheline: a.orpheline, miennes: a.elu_id === elu.id,
    auteur: a.elu_id === elu.id ? null : ctx.noms.get(a.elu_id) || null,
    destinataires: a.elu_id === elu.id ? (ctx.partages.get(a.id) || []) : undefined,
    reponses: (ctx.reponses.get(a.id) || []).map((r) => ({ id: r.id, auteur: r.elu_id === elu.id ? null : ctx.noms.get(r.elu_id) || null, miennes: r.elu_id === elu.id, contenu: box.dechiffre(r.contenu_c), le: r.created_at })),
    creeLe: a.created_at, majLe: a.updated_at,
  });

  async function liste(elu, seanceId, { docKey } = {}) {
    const p = [seanceId, elu.id]; let w = '';
    if (docKey) { p.push(docKey); w = 'AND a.doc_key = $3'; }
    const rows = await db.all(
      `SELECT a.* FROM elu_annotations a
       WHERE a.seance_id = $1 ${w} AND (a.elu_id = $2 OR EXISTS (SELECT 1 FROM elu_annotation_partages p WHERE p.annotation_id = a.id AND p.elu_id = $2))
       ORDER BY a.doc_key, a.page, a.id`, p);
    const ids = rows.map((r) => r.id);
    const noms = new Map();
    const eids = new Set(rows.map((r) => r.elu_id));
    const reponses = new Map(); const partages = new Map();
    if (ids.length) {
      for (const r of await db.all('SELECT * FROM elu_annotation_reponses WHERE annotation_id = ANY($1::int[]) ORDER BY id', [ids])) { (reponses.get(r.annotation_id) || reponses.set(r.annotation_id, []).get(r.annotation_id)).push(r); eids.add(r.elu_id); }
      for (const r of await db.all('SELECT * FROM elu_annotation_partages WHERE annotation_id = ANY($1::int[])', [ids])) { (partages.get(r.annotation_id) || partages.set(r.annotation_id, []).get(r.annotation_id)).push({ eluId: r.elu_id, via: r.via }); eids.add(r.elu_id); }
    }
    if (eids.size) for (const e of await db.all('SELECT id, nom, prenom FROM elus WHERE id = ANY($1::int[])', [[...eids]])) noms.set(e.id, nomOf(e));
    for (const [, l] of partages) for (const d of l) d.nom = noms.get(d.eluId) || null;
    return rows.map((a) => vue(a, elu, { noms, reponses, partages }));
  }

  async function partagerUne(elu, a, { mode, eluIds = [] }) {
    if (mode === 'revoquer') {
      if (eluIds.length) await db.run('DELETE FROM elu_annotation_partages WHERE annotation_id = $1 AND elu_id = ANY($2::int[])', [a.id, eluIds]);
      else await db.run('DELETE FROM elu_annotation_partages WHERE annotation_id = $1', [a.id]);
      return;
    }
    let cibles; let via;
    if (mode === 'groupe') {
      if (!elu.groupeId) throw E.conflict("Vous n'appartenez à aucun groupe : partagez avec des élus nommés");
      via = 'groupe';
      cibles = (await db.all('SELECT id FROM elus WHERE organisme_id = $1 AND actif AND est_elu AND groupe_id = $2 AND id <> $3', [elu.organismeId, elu.groupeId, elu.id])).map((x) => x.id);
      cibles = await destinatairesValides(elu, a.seance_id, cibles);
    } else {
      via = 'elu';
      cibles = await destinatairesValides(elu, a.seance_id, eluIds);
      if (!cibles.length) throw E.badRequest('Indiquez au moins un élu destinataire (ayant accès à cette séance)');
    }
    for (const id of cibles) await db.run('INSERT INTO elu_annotation_partages (annotation_id, elu_id, via) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [a.id, id, via]);
    return cibles.length;
  }

  const svc = {
    async lister(elu, seanceId, q = {}) { await seanceAccessible(elu, seanceId); return liste(elu, seanceId, q); },

    async creer(elu, seanceId, b) {
      await seanceAccessible(elu, seanceId);
      if ((await seanceDeCle(b.docKey)) !== Number(seanceId)) throw E.badRequest('Ce document n\'appartient pas à cette séance');
      if (b.kind === 'surlignage' && !b.rects?.length) throw E.badRequest('Un surlignage porte sur au moins une zone');
      if (b.kind === 'dessin' && !b.trace?.length) throw E.badRequest('Un dessin comporte au moins un trait');
      if (b.kind === 'note' && !String(b.contenu || '').trim()) throw E.badRequest('Écrivez le texte de la note');
      const a = await db.get(
        `INSERT INTO elu_annotations (organisme_id, elu_id, seance_id, doc_key, doc_version, page, kind, rects, trace, couleur, citation_c, contenu_c)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12) RETURNING *`,
        [elu.organismeId, elu.id, seanceId, b.docKey, b.docVersion, b.page, b.kind, JSON.stringify(b.rects || []), JSON.stringify(b.trace || []), b.couleur || '#facc15', box.chiffre(b.citation || null), box.chiffre(b.contenu || null)]);
      await audit.log({ username: `elu:${elu.id}`, kind: 'elu' }, { organismeId: elu.organismeId, action: 'elu.annotation.create', entity: 'elu_annotations', entityId: a.id }); // jamais le contenu
      return (await liste(elu, seanceId, {})).find((x) => x.id === a.id);
    },

    async modifier(elu, id, b) {
      const a = await miennes(elu, id);
      const sets = []; const p = [id]; const add = (c, v) => { p.push(v); sets.push(`${c} = $${p.length}`); };
      if (b.contenu !== undefined) add('contenu_c', box.chiffre(b.contenu));
      if (b.couleur !== undefined) add('couleur', b.couleur);
      if (!sets.length) return { id };
      await db.run(`UPDATE elu_annotations SET ${sets.join(', ')} WHERE id = $1`, p);
      return (await liste(elu, a.seance_id, {})).find((x) => x.id === id);
    },

    /** Ré-ancrage à l'ouverture d'une nouvelle version (calculé par le client) ou déclaration « orpheline ». */
    async ancrer(elu, id, b) {
      const a = await miennes(elu, id);
      if (b.orpheline) { await db.run('UPDATE elu_annotations SET orpheline = true WHERE id = $1', [id]); return { id, orpheline: true }; }
      await db.run('UPDATE elu_annotations SET doc_version = $2, page = $3, rects = $4::jsonb, trace = $5::jsonb, orpheline = false WHERE id = $1',
        [id, b.docVersion, b.page, JSON.stringify(b.rects ?? a.rects), JSON.stringify(b.trace ?? a.trace)]);
      return { id, orpheline: false, docVersion: b.docVersion };
    },

    async supprimer(elu, id) {
      await miennes(elu, id);
      await db.run('DELETE FROM elu_annotations WHERE id = $1', [id]);
      await audit.log({ username: `elu:${elu.id}`, kind: 'elu' }, { organismeId: elu.organismeId, action: 'elu.annotation.delete', entity: 'elu_annotations', entityId: id });
      return { id };
    },

    /** Partage d'une annotation (« groupe », « elus », « revoquer »). */
    async partager(elu, id, b) {
      const a = await miennes(elu, id);
      const n = await partagerUne(elu, a, b);
      await audit.log({ username: `elu:${elu.id}`, kind: 'elu' }, { organismeId: elu.organismeId, action: 'elu.annotation.partage', entity: 'elu_annotations', entityId: id, after: { mode: b.mode, destinataires: n ?? 0 } });
      return { id, destinataires: (await liste(elu, a.seance_id, {})).find((x) => x.id === id)?.destinataires || [] };
    },

    /** Partage pour tout un document ou tout le carnet de la séance (mes annotations seulement). */
    async partagerLot(elu, seanceId, { portee, docKey, mode, eluIds }) {
      await seanceAccessible(elu, seanceId);
      const p = [elu.id, seanceId]; let w = '';
      if (portee === 'document') { if (!docKey) throw E.badRequest('Indiquez le document'); p.push(docKey); w = 'AND doc_key = $3'; }
      let n = 0;
      for (const a of await db.all(`SELECT * FROM elu_annotations WHERE elu_id = $1 AND seance_id = $2 ${w}`, p)) { await partagerUne(elu, a, { mode, eluIds }); n++; }
      await audit.log({ username: `elu:${elu.id}`, kind: 'elu' }, { organismeId: elu.organismeId, action: 'elu.annotation.partage_lot', entity: 'seances', entityId: seanceId, after: { portee, mode, annotations: n } });
      return { annotations: n };
    },

    /** Réponse sur une annotation : l'auteur ou un destinataire. */
    async repondre(elu, id, contenu) {
      const a = await db.get('SELECT * FROM elu_annotations WHERE id = $1', [id]);
      const ok = a && (a.elu_id === elu.id || await db.get('SELECT 1 AS x FROM elu_annotation_partages WHERE annotation_id = $1 AND elu_id = $2', [id, elu.id]));
      if (!ok) throw E.notFound('Annotation introuvable');
      await db.run('INSERT INTO elu_annotation_reponses (annotation_id, elu_id, contenu_c) VALUES ($1,$2,$3)', [id, elu.id, box.chiffre(contenu)]);
      return (await liste(elu, a.seance_id, {})).find((x) => x.id === id);
    },

    // ----------------------------------------------------------------------------------- côté administration : métadonnées seulement
    /** Compteurs : combien d'annotations, combien partagées, combien d'élus ont annoté. Jamais de contenu, jamais de nom. */
    async metadonnees(organismeId, seanceId) {
      const org = requireOrg(organismeId);
      const r = await db.get(
        `SELECT count(*)::int AS annotations, count(DISTINCT elu_id)::int AS elus,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM elu_annotation_partages p WHERE p.annotation_id = a.id))::int AS partagees
         FROM elu_annotations a WHERE a.organisme_id = $1 AND a.seance_id = $2`, [org, seanceId]);
      return r;
    },

    /** Purge de toutes les annotations d'un élu (fin de mandat, demande RGPD). */
    async purger(ctx, organismeId, eluId) {
      const org = requireOrg(organismeId);
      const r = await db.run('DELETE FROM elu_annotations WHERE organisme_id = $1 AND elu_id = $2', [org, eluId]);
      await audit.log(ctx, { organismeId: org, action: 'elu.annotation.purge', entity: 'elus', entityId: eluId, after: { supprimees: r.changes } });
      return { supprimees: r.changes };
    },

    // ----------------------------------------------------------------------------------- « mon dossier annoté » (ELU-75)
    async exporter(elu, seanceId, { avecPartagees = false } = {}) {
      await seanceAccessible(elu, seanceId);
      const cfg = await settings.resolve(elu.organismeId);
      if (cfg['elus.export_annote']?.value === false) throw E.forbidden("L'export du dossier annoté est désactivé");
      const manifeste = await espace.manifeste(elu, seanceId);
      const toutes = (await liste(elu, seanceId, {})).filter((a) => avecPartagees || a.miennes);
      const out = await PDFDocument.create(); const font = await out.embedFont(StandardFonts.Helvetica); const gras = await out.embedFont(StandardFonts.HelveticaBold);
      const notes = []; let n = 0;
      for (const d of manifeste.documents.filter((x) => x.type !== 'cahier')) { // le cahier duplique les autres documents
        const { buffer } = await espace.document(elu, d.key, { journal: false });
        const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        const debut = out.getPageCount() - pages.length;
        for (const a of toutes.filter((x) => x.docKey === d.key && !x.orpheline)) {
          const page = out.getPage(debut + Math.min(a.page, pages.length) - 1); const { width: W, height: H } = page.getSize();
          if (a.kind === 'surlignage') for (const r of a.rects) page.drawRectangle({ x: r.x * W, y: H - (r.y + r.h) * H, width: r.w * W, height: r.h * H, color: hex(a.couleur), opacity: 0.35 });
          if (a.kind === 'dessin') for (const trait of a.trace) for (let i = 1; i < trait.length; i++) page.drawLine({ start: { x: trait[i - 1][0] * W, y: H - trait[i - 1][1] * H }, end: { x: trait[i][0] * W, y: H - trait[i][1] * H }, thickness: 1.6, color: hex(a.couleur) });
          if (a.kind === 'note' || a.kind === 'signet') {
            n++; const r = a.rects[0] || { x: 0.02, y: 0.02, w: 0, h: 0 };
            const cx = Math.min(Math.max(r.x * W, 8), W - 8); const cy = H - Math.min(Math.max(r.y * H, 8), H - 8);
            page.drawCircle({ x: cx, y: cy, size: 7, color: hex(a.couleur), opacity: 0.9 });
            page.drawText(String(n), { x: cx - (n > 9 ? 4.5 : 2.5), y: cy - 3, size: 8, font: gras, color: rgb(0, 0, 0) });
            notes.push({ n, titre: d.titre, page: a.page, citation: a.citation, contenu: a.contenu, kind: a.kind, de: a.miennes ? null : a.auteur, reponses: a.reponses });
          }
        }
      }
      if (notes.length) { // « mes notes » en fin de dossier
        let page = out.addPage([595, 842]); let y = 800;
        page.drawText('Mes notes', { x: 40, y, size: 16, font: gras }); y -= 28;
        for (const nt of notes) {
          const lignes = [`${nt.n}. ${nt.titre} — page ${nt.page}${nt.de ? ` — de ${nt.de}` : ''}`, ...(nt.citation ? [`« ${nt.citation} »`] : []), ...(nt.contenu ? [nt.contenu] : []), ...nt.reponses.map((r) => `↳ ${r.auteur || 'moi'} : ${r.contenu}`)]
            .flatMap((l, i) => coupe(i === 0 ? gras : font, l, 10, 500).map((x) => [x, i === 0]));
          if (y - lignes.length * 13 < 50) { page = out.addPage([595, 842]); y = 800; }
          for (const [txt, entete] of lignes) { page.drawText(txt, { x: 40, y, size: 10, font: entete ? gras : font, color: rgb(0.1, 0.1, 0.1) }); y -= 13; }
          y -= 8;
        }
      }
      const e = await db.get('SELECT nom, prenom FROM elus WHERE id = $1', [elu.id]);
      const marque = winAnsi(font, `Dossier annote — remis a ${nomOf(e)} — confidentiel, ne pas diffuser`);
      for (const p of out.getPages()) p.drawText(marque, { x: 28, y: 5, size: 6.5, font, color: rgb(0.5, 0.5, 0.5) });
      await audit.log({ username: `elu:${elu.id}`, kind: 'elu' }, { organismeId: elu.organismeId, action: 'elu.annotation.export', entity: 'seances', entityId: seanceId });
      return { buffer: Buffer.from(await out.save()), name: `dossier-annote-seance-${seanceId}.pdf` };
    },
  };
  return svc;
}

module.exports = { createAnnotations };
