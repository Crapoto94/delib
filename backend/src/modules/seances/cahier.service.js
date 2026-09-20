/**
 * Cahier de séance (D11, CAH-01 à CAH-11) : UN PDF prêt à imprimer qui compile le dossier d'une séance dans l'ordre de l'ordre du jour.
 *   page de garde → sommaire paginé → pour chaque point : intercalaire, exposé (une fois par dossier), délibération, annexes.
 * Chaque génération est une VERSION numérotée (CAH-08). La génération est asynchrone : la demande répond tout de suite, la
 * construction se fait en arrière plan et le client suit l'avancement (CAH-06).
 * Pagination en deux passes (CAH-07) : on compte les pages de chaque pièce, puis on produit le sommaire avec les bons numéros.
 */
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const T = require('../render/typeset');

const PROFILS = ['scc', 'presidence', 'elus', 'public'];
const PROFIL_LABEL = { scc: 'Secrétariat (complet)', presidence: 'Présidence', elus: 'Élus', public: 'Public' };
const POLITIQUES = ['bloquer', 'avertir', 'exclure'];
/** Statuts d'un acte dont le circuit n'est pas terminé (CAH-05 : « dossier non validé »). */
const NON_VALIDES = ['brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs', 'en_attente_scc'];
const AVIS = { favorable: 'Favorable', defavorable: 'Défavorable', reserve: 'Favorable avec réserves', sans_avis: 'Sans avis' };
const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');

function createCahier({ db, audit, render, odj, storage, log }) {
  const seanceRow = async (org, id) => {
    const s = await db.get('SELECT s.*, i.nom AS instance_nom, i.kind AS instance_kind FROM seances s JOIN instances i ON i.id = s.instance_id WHERE s.id = $1 AND s.organisme_id = $2', [id, requireOrg(org)]);
    if (!s) throw E.notFound('Séance introuvable');
    return s;
  };
  const allowed = async (ctx, org) => { if (!(await odj.canEditOdj(ctx, org))) throw E.forbidden('Le cahier de séance est réservé au SCC, à la DGS et aux administrateurs'); };

  const toBuild = (r, extra = {}) => ({
    id: r.id, seanceId: r.seance_id, version: r.version_no, libelle: `Cahier v${r.version_no} — ${new Date(r.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' })}`,
    profil: r.profil, options: r.options, statut: r.statut, etape: r.step_label, progression: r.progress, total: r.total, pages: r.pages, sha256: r.sha256,
    anomalies: r.anomalies, filigrane: r.odj_statut === 'en_preparation', erreur: r.error, creePar: r.created_by, creeLe: r.created_at, termineLe: r.finished_at,
    imprimeLe: r.printed_at, imprimePar: r.printed_by, ...extra,
  });

  /** CAH-05 : anomalies avant génération. `acteId` renseigné = le point est concerné. */
  async function controles(ctx, org, seanceId) {
    const d = await odj.get(ctx, org, seanceId);
    const out = []; const seen = new Set();
    for (const it of d.items.filter((i) => i.statut === 'a_traiter')) {
      if (it.kind === 'libre' && !it.titre?.trim()) out.push({ code: 'sans_titre', itemId: it.id, message: 'Un point libre n\'a pas de titre', gravite: 'a_revoir' });
      if (it.kind !== 'deliberation' || !it.acte || seen.has(it.acte.id)) continue;
      seen.add(it.acte.id);
      const a = it.acte; const n = a.numeroSuivi;
      if (NON_VALIDES.includes(a.statut)) out.push({ code: 'non_valide', acteId: a.id, message: `Dossier n° ${n} non validé (${a.statut.replace(/_/g, ' ')})`, gravite: 'a_revoir' });
      const texts = await db.all('SELECT kind, markdown FROM tracked_texts WHERE acte_id = $1', [a.id]);
      for (const kind of ['expose', 'visas', 'dispositif']) if (!texts.some((t) => t.kind === kind && String(t.markdown || '').trim())) out.push({ code: 'texte_vide', acteId: a.id, message: `Dossier n° ${n} : ${{ expose: 'exposé des motifs', visas: 'visas et considérants', dispositif: 'dispositif' }[kind]} vide`, gravite: 'a_revoir' });
      const annexes = await db.all('SELECT a.titre, f.storage_key FROM annexes a JOIN files f ON f.id = a.file_id WHERE a.acte_id = $1', [a.id]);
      for (const x of annexes) if (!(await storage.exists(x.storage_key))) out.push({ code: 'annexe_manquante', acteId: a.id, message: `Dossier n° ${n} : annexe « ${x.titre} » introuvable sur le serveur`, gravite: 'bloquant' });
    }
    if (!d.items.some((i) => i.statut === 'a_traiter')) out.push({ code: 'vide', message: 'L\'ordre du jour est vide', gravite: 'bloquant' });
    return out;
  }

  const blankPage = async () => { const doc = await PDFDocument.create(); doc.addPage([T.A4.w, T.A4.h]); return { buffer: Buffer.from(await doc.save()), pageCount: 1 }; };

  /** Construction du PDF (deux passes). `progress(n, total, label)` alimente le suivi. */
  async function assemble(ctx, org, s, build, progress) {
    const opts = build.options || {};
    const onlyCommunicable = build.profil === 'elus' || build.profil === 'public';
    const wm = s.odj_statut === 'en_preparation' ? undefined : '';
    const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
    const d = await odj.get(ctx, org, s.id);
    let items = d.items.filter((i) => i.statut === 'a_traiter');
    const excluded = new Set((build.anomalies || []).filter((a) => opts.anomalies === 'exclure' && a.acteId && a.gravite).map((a) => a.acteId));
    items = items.filter((i) => !i.acte || !excluded.has(i.acte.id));
    const total = items.length + 2; let done = 0;
    const tick = async (label) => { done++; await progress(done, total, label); };

    const dateLong = new Date(s.date_seance).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
    const vars = { organisme: orgRow?.nom || '', date_seance: dateLong.toUpperCase(), instance: s.instance_nom };
    const cover = await render.build({ organismeId: org, docType: 'garde', vars, watermark: wm, title: `Cahier de séance — ${s.instance_nom}`, content: [
      { type: 'space', h: 90 },
      { type: 'title', text: orgRow?.nom || '', size: 16, align: 'center', bold: true, after: 24 },
      { type: 'title', text: 'CAHIER DE SÉANCE', size: 26, align: 'center', bold: true, boxed: true, after: 24 },
      { type: 'title', text: s.instance_nom, size: 16, align: 'center', bold: true, after: 8 },
      { type: 'title', text: dateLong, size: 14, align: 'center', after: 6 },
      ...(s.lieu ? [{ type: 'title', text: s.lieu, size: 12, align: 'center', after: 6 }] : []),
      { type: 'title', text: `Version ${build.version_no} — ${PROFIL_LABEL[build.profil]}`, size: 10, align: 'center', after: 0 },
    ] });
    await tick('Page de garde');

    // 1re passe : les pièces de chaque point et leur nombre de pages
    const blocks = []; const snapshot = []; const lastOf = new Map();
    items.forEach((it, i) => { if (it.acte) lastOf.set(it.acte.id, i); });
    const firstSeen = new Set();
    for (const [i, it] of items.entries()) {
      await progress(done, total, it.acte ? `Point ${it.numero ?? i + 1} — dossier n° ${it.acte.numeroSuivi}` : `Point ${i + 1}`);
      const pieces = []; let titre = it.titre; let hash;
      if (it.kind === 'deliberation' && it.acte) {
        const a = await db.get('SELECT * FROM actes WHERE id = $1', [it.acte.id]);
        const delib = await db.get('SELECT * FROM deliberations WHERE id = $1', [it.deliberationId]);
        const avis = await db.all(`SELECT c.nom, ac.avis, ac.avis_date FROM acte_commissions ac JOIN commissions c ON c.id = ac.commission_id WHERE ac.acte_id = $1 AND ac.retiree_at IS NULL ORDER BY c.nom`, [a.id]);
        const lines = [
          `Rubrique : ${it.acte.rubrique || '—'}`, `Rapporteur : ${it.acte.rapporteur || '—'}`, `Direction : ${it.acte.direction || '—'}`,
          ...avis.map((v) => `Commission ${v.nom} : ${v.avis ? AVIS[v.avis] : 'avis en attente'}${v.avis_date ? ` (${new Date(v.avis_date).toLocaleDateString('fr-FR')})` : ''}`),
        ];
        pieces.push({ titre: 'Intercalaire', pdf: await render.build({ organismeId: org, docType: 'intercalaire', vars: await render.varsFor(a, delib), watermark: '', title: `Point ${it.numero ?? ''}`, content: [
          { type: 'space', h: 120 }, { type: 'title', text: `POINT N° ${it.numero ?? i + 1}`, size: 22, align: 'center', bold: true, boxed: true, after: 18 },
          { type: 'title', text: titre || '', size: 15, align: 'center', bold: true, after: 20 },
          { type: 'runs', runs: [{ type: 'text', text: lines.join('\n') }] },
        ] }) });
        if (!firstSeen.has(a.id)) { firstSeen.add(a.id); pieces.push({ titre: 'Exposé des motifs', pdf: await render.renderActe(ctx, org, a.id, { cible: 'expose', mode: 'propre', watermark: wm }) }); }
        pieces.push({ titre: `Délibération : ${delib?.titre || titre}`, pdf: await render.renderActe(ctx, org, a.id, { cible: 'deliberation', deliberationId: it.deliberationId, mode: 'propre', watermark: wm }) });
        if (lastOf.get(a.id) === i) pieces.push(...(await render.annexParts(a, { onlyCommunicable })));
        const texts = await db.all('SELECT id, markdown FROM tracked_texts WHERE acte_id = $1 ORDER BY id', [a.id]);
        hash = sha(texts.map((t) => t.markdown || '').join('|')); // séparateur simple entre les textes
      } else {
        pieces.push({ titre: it.kind === 'chapitre' ? 'Chapitre' : 'Point', pdf: await render.build({ organismeId: org, docType: 'intercalaire', vars, watermark: '', title: titre || '', content: [
          { type: 'space', h: 160 }, ...(it.kind === 'libre' && it.numero ? [{ type: 'title', text: `POINT N° ${it.numero}`, size: 22, align: 'center', bold: true, boxed: true, after: 18 }] : []),
          { type: 'title', text: titre || '', size: it.kind === 'chapitre' ? 24 : 15, align: 'center', bold: true, after: 0 },
        ] }) });
        hash = sha(titre || '');
      }
      snapshot.push({ acteId: it.acte?.id ?? null, deliberationId: it.deliberationId ?? null, numero: it.numero ?? null, titre: titre || '', hash });
      blocks.push({ label: it.kind === 'chapitre' ? (titre || '') : `${it.numero ? `${it.numero} — ` : ''}${titre || ''}`, chapitre: it.kind === 'chapitre', pieces });
      await tick(`Point ${i + 1}/${items.length}`);
    }

    // 2e passe : recto-verso éventuel, puis sommaire avec les vrais numéros de page
    const makeSommaire = async (start) => {
      let page = start; const lines = [];
      for (const b of blocks) {
        if (opts.rectoVerso && page % 2 === 0) page++; // le point commence sur une page impaire
        lines.push({ label: b.label, page, chapitre: b.chapitre });
        page += b.pieces.reduce((n, p) => n + p.pdf.pageCount, 0);
      }
      const txt = lines.map((l) => (l.chapitre ? `\n${String(l.label).toUpperCase()}` : `${l.label} .... page ${l.page}`)).join('\n');
      return render.build({ organismeId: org, docType: 'sommaire', vars, watermark: '', title: 'Sommaire', content: [
        { type: 'title', text: 'SOMMAIRE', size: 16, align: 'center', bold: true, boxed: true, after: 14 }, { type: 'runs', runs: [{ type: 'text', text: txt }] },
      ] });
    };
    let som = await makeSommaire(cover.pageCount + 1);
    som = await makeSommaire(cover.pageCount + som.pageCount + 1);

    const buffers = [cover.buffer, som.buffer]; let page = cover.pageCount + som.pageCount + 1;
    for (const b of blocks) {
      if (opts.rectoVerso && page % 2 === 0) { buffers.push((await blankPage()).buffer); page++; }
      for (const p of b.pieces) { buffers.push(p.pdf.buffer); page += p.pdf.pageCount; }
    }
    await tick('Assemblage du PDF');
    const merged = await render.mergePdfs(buffers);
    return { buffer: merged.buffer, pages: merged.pageCount, snapshot };
  }

  /** Change vs la dernière version imprimée / diffusée (CAH-08). */
  function diff(snapshot, ref) {
    const key = (x) => `${x.acteId ?? 't'}:${x.deliberationId ?? x.titre}`;
    const before = new Map((ref || []).map((x) => [key(x), x])); const now = new Map((snapshot || []).map((x) => [key(x), x]));
    return {
      ajoutes: [...now.values()].filter((x) => !before.has(key(x))).map((x) => x.titre),
      retires: [...before.values()].filter((x) => !now.has(key(x))).map((x) => x.titre),
      modifies: [...now.values()].filter((x) => before.has(key(x)) && before.get(key(x)).hash !== x.hash).map((x) => x.titre),
    };
  }

  const svc = {
    PROFILS, controles,

    async list(ctx, org, seanceId) {
      await allowed(ctx, org); await seanceRow(org, seanceId);
      const rows = await db.all('SELECT * FROM cahier_builds WHERE seance_id = $1 ORDER BY version_no DESC', [seanceId]);
      const printed = rows.find((r) => r.printed_at && r.statut === 'done');
      return rows.map((r) => toBuild(r, printed && r.id !== printed.id && r.statut === 'done' ? { depuisImprime: diff(r.snapshot, printed.snapshot), referenceImprimee: printed.version_no } : {}));
    },

    async get(ctx, org, seanceId, n) {
      await allowed(ctx, org);
      const r = await db.get('SELECT * FROM cahier_builds WHERE seance_id = $1 AND version_no = $2 AND organisme_id = $3', [seanceId, n, requireOrg(org)]);
      if (!r) throw E.notFound('Version du cahier introuvable');
      return toBuild(r);
    },

    /** Demande de génération : contrôle, enregistre la version, lance la construction en arrière plan. */
    async request(ctx, org, seanceId, { profil = 'scc', rectoVerso = false, anomalies = 'avertir' } = {}) {
      await allowed(ctx, org);
      const s = await seanceRow(org, seanceId);
      if (!PROFILS.includes(profil)) throw E.badRequest(`Profil inconnu : ${profil}`);
      if (!POLITIQUES.includes(anomalies)) throw E.badRequest(`Politique d'anomalies inconnue : ${anomalies}`);
      const found = await controles(ctx, org, seanceId);
      if (found.some((a) => a.code === 'vide')) throw E.conflict('L\'ordre du jour est vide : rien à compiler');
      if (anomalies === 'bloquer' && found.length) throw E.conflict(`${found.length} anomalie(s) : corrigez-les ou choisissez « avertir » / « exclure »`, { anomalies: found });
      if (found.some((a) => a.gravite === 'bloquant') && anomalies !== 'exclure') throw E.conflict('Une anomalie bloquante empêche la génération (annexe introuvable) : corrigez-la ou choisissez « exclure ».', { anomalies: found });
      const busy = await db.get("SELECT 1 AS x FROM cahier_builds WHERE seance_id = $1 AND statut IN ('queued', 'running')", [seanceId]);
      if (busy) throw E.conflict('Une génération du cahier est déjà en cours pour cette séance');
      const r = await db.get(
        `INSERT INTO cahier_builds (organisme_id, seance_id, version_no, profil, options, anomalies, odj_statut, created_by)
         VALUES ($1,$2,(SELECT COALESCE(MAX(version_no), 0) + 1 FROM cahier_builds WHERE seance_id = $2),$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,
        [requireOrg(org), seanceId, profil, JSON.stringify({ rectoVerso: !!rectoVerso, anomalies }), JSON.stringify(found), s.odj_statut, ctx.username]);
      await audit.log(ctx, { organismeId: org, action: 'cahier.generation', entity: 'seances', entityId: seanceId, after: { version: r.version_no, profil, rectoVerso: !!rectoVerso, anomalies: found.length } });
      const p = svc.run(ctx, org, s, r).catch((e) => log.error({ err: e.message }, 'cahier : échec')).finally(() => svc.pending.delete(p));
      svc.pending.add(p);
      return toBuild(r);
    },

    /** Promesses de génération en cours (les tests les attendent). */
    pending: new Set(),
    async idle() { while (svc.pending.size) await Promise.allSettled([...svc.pending]); },

    async run(ctx, org, s, build) {
      const progress = (n, total, label) => db.run('UPDATE cahier_builds SET progress = $2, total = $3, step_label = $4 WHERE id = $1', [build.id, n, total, label]);
      await db.run("UPDATE cahier_builds SET statut = 'running' WHERE id = $1", [build.id]);
      try {
        const out = await assemble(ctx, org, s, build, progress);
        const put = await storage.put(out.buffer, { organismeId: org, ext: 'pdf' });
        const f = await db.get(`INSERT INTO files (organisme_id, storage_key, original_name, mime, size, pages, sha256, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7) RETURNING id`,
          [org, put.key, `cahier-seance-${s.id}-v${build.version_no}.pdf`, put.size, out.pages, put.sha256, ctx.username]);
        await db.run("UPDATE cahier_builds SET statut = 'done', file_id = $2, pages = $3, sha256 = $4, snapshot = $5::jsonb, step_label = 'Terminé', progress = total, finished_at = now() WHERE id = $1", [build.id, f.id, out.pages, put.sha256, JSON.stringify(out.snapshot)]);
      } catch (e) {
        await db.run("UPDATE cahier_builds SET statut = 'error', error = $2, finished_at = now() WHERE id = $1", [build.id, String(e.message).slice(0, 500)]);
        throw e;
      }
    },

    /** Téléchargement TRACÉ (CAH-11, SEC-14). */
    async file(ctx, org, seanceId, n) {
      await allowed(ctx, org);
      const r = await db.get('SELECT b.*, f.storage_key FROM cahier_builds b LEFT JOIN files f ON f.id = b.file_id WHERE b.seance_id = $1 AND b.version_no = $2 AND b.organisme_id = $3', [seanceId, n, requireOrg(org)]);
      if (!r) throw E.notFound('Version du cahier introuvable');
      if (r.statut !== 'done') throw E.conflict('Ce cahier n\'est pas (encore) disponible');
      await audit.log(ctx, { organismeId: org, action: 'cahier.telechargement', entity: 'seances', entityId: seanceId, after: { version: r.version_no, profil: r.profil, sha256: r.sha256 } });
      return { buffer: await storage.get(r.storage_key), name: `cahier-seance-v${r.version_no}.pdf`, build: toBuild(r) };
    },

    async markPrinted(ctx, org, seanceId, n) {
      await allowed(ctx, org);
      const r = await db.get("UPDATE cahier_builds SET printed_at = now(), printed_by = $4 WHERE seance_id = $1 AND version_no = $2 AND organisme_id = $3 AND statut = 'done' RETURNING *", [seanceId, n, requireOrg(org), ctx.username]);
      if (!r) throw E.notFound('Version terminée du cahier introuvable');
      await audit.log(ctx, { organismeId: org, action: 'cahier.diffusion', entity: 'seances', entityId: seanceId, after: { version: n, sha256: r.sha256 } });
      return toBuild(r);
    },
  };
  return svc;
}

module.exports = { createCahier, PROFILS, PROFIL_LABEL };
