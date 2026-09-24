/**
 * Textes suivis (section 11) : exposé des motifs (1 par dossier), « Vu et considérant » et « Délibéré » (par délibération).
 *  - suivi des modifications coloré par auteur, cumulatif sur toute la vie du circuit (spans.js) ;
 *  - instantané immuable à chaque enregistrement ; spans reconstruits depuis les instantanés si besoin (jamais réinitialisés) ;
 *  - le suivi démarre à l'envoi au circuit ; avant, rédaction libre sans coloration (TRK-03) ;
 *  - brouillon privé auto-sauvegardé, verrou souple d'édition, contrôle de version optimiste ;
 *  - acceptation / rejet modification par modification (D30) et consolidation.
 */
const { E } = require('../../shared/errors');
const S = require('./spans');

const KINDS = { expose: 'Exposé des motifs', visas: 'Vu et considérant', dispositif: 'Délibéré' };
const MAX_CHARS = 400000;
const LOCK_MINUTES = 10;

function createTextes({ db, audit, actes, acl, bus }) {
  const label = (t) => KINDS[t.kind];

  async function authorFor(textId, ctx) {
    const cur = await db.get('SELECT * FROM text_authors WHERE text_id = $1 AND username = $2', [textId, ctx.username]);
    if (cur) return { author: cur.username, name: cur.name, color: cur.color };
    const n = (await db.get('SELECT count(*)::int AS n FROM text_authors WHERE text_id = $1', [textId])).n;
    const a = { author: ctx.username, name: ctx.displayName || ctx.username, color: S.pickColor(n) };
    await db.run('INSERT INTO text_authors (text_id, username, name, color) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [textId, a.author, a.name, a.color]);
    return a;
  }

  async function load(ctx, organismeId, acteId, textId, { edit = false } = {}) {
    const acte = await actes.load(ctx, organismeId, acteId, { edit });
    const t = await db.get('SELECT * FROM tracked_texts WHERE id = $1 AND acte_id = $2', [textId, acte.id]);
    if (!t) throw E.notFound('Texte introuvable');
    return { acte, t };
  }

  const summary = (t) => ({
    id: t.id, kind: t.kind, label: label(t), deliberationId: t.deliberation_id, version: t.version_no, tracking: t.tracking,
    empty: !t.markdown.trim(), characters: t.markdown.length, updatedBy: t.updated_by, updatedAt: t.updated_at,
    lock: t.lock_until && new Date(t.lock_until) > new Date() ? { user: t.lock_user, until: t.lock_until } : null,
  });

  /** Reconstruit les spans depuis les instantanés (réparation ; jamais de réinitialisation silencieuse). */
  async function rebuild(t) {
    const rows = await db.all(
      `SELECT v.markdown, v.author, v.created_at, v.version_no, a.name, a.color, (v.reason = 'suivi') AS tracked_from
       FROM text_versions v LEFT JOIN text_authors a ON a.text_id = v.text_id AND a.username = v.author WHERE v.text_id = $1 ORDER BY v.version_no`, [t.id]);
    let tracking = false;
    const versions = rows.map((r) => {
      if (r.tracked_from) tracking = true;
      return { markdown: r.markdown, author: r.author, name: r.name || r.author, color: r.color || S.PALETTE[0], created_at: r.created_at, tracking, cid: `rb-${r.version_no}` };
    });
    return S.rebuildSpans(versions);
  }

  /** Cœur de l'enregistrement d'un texte (sans contrôle d'accès : fait par l'appelant). */
  async function applyCommit(ctx, acte, t, { markdown, reason = null }) {
    const next = S.normalize(markdown);
    if (next.length > MAX_CHARS) throw E.badRequest(`Texte trop long (maximum ${MAX_CHARS} caractères)`);
    const old = S.normalize(t.markdown);
    if (next === old) { await db.run('DELETE FROM text_drafts WHERE text_id = $1 AND username = $2', [t.id, ctx.username]); return { changed: false, version: t.version_no }; }

    let spans; let cid = null;
    if (!t.tracking) spans = S.initialSpans(next);
    else {
      let prev = t.spans;
      if (!S.isConsistent(prev, old)) prev = await rebuild(t);
      // On ne se diffe jamais contre soi-même : si la version précédente est du même auteur, on « défait » sa
      // série d'écritures pour repartir du texte de la personne précédente. Chaque personne est donc comparée à
      // celle d'avant, jamais à elle-même ; une écriture annulée par son auteur ne laisse aucun amendement.
      const last = await db.get('SELECT author FROM text_versions WHERE text_id = $1 ORDER BY version_no DESC LIMIT 1', [t.id]);
      if (last && last.author === ctx.username) {
        const other = await db.get('SELECT created_at FROM text_versions WHERE text_id = $1 AND author <> $2 ORDER BY version_no DESC LIMIT 1', [t.id, ctx.username]);
        const mine = S.authorChangeIds(prev, ctx.username, other?.created_at ?? null);
        if (mine.length) prev = S.resolveChanges(prev, mine, 'reject');
      }
      const refText = S.liveText(prev);
      if (refText !== next) {
        const who = await authorFor(t.id, ctx);
        cid = require('crypto').randomBytes(6).toString('hex');
        spans = S.applyDiffToSpans(prev, refText, next, who, { cid });
      } else spans = prev;
    }
    const version = t.version_no + 1;
    await db.tx(async (q) => {
      await q.run('UPDATE tracked_texts SET markdown = $2, spans = $3::jsonb, version_no = $4, updated_by = $5 WHERE id = $1', [t.id, next, JSON.stringify(spans), version, ctx.username]);
      await q.run('INSERT INTO text_versions (text_id, version_no, markdown, spans, author, step_key, reason) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)',
        [t.id, version, next, JSON.stringify(spans), ctx.username, acte.current_step_key, reason]);
      await q.run('DELETE FROM text_drafts WHERE text_id = $1 AND username = $2', [t.id, ctx.username]);
    });
    await audit.log(ctx, { organismeId: acte.organisme_id, action: 'texte.commit', entity: 'tracked_texts', entityId: t.id, after: { acteId: acte.id, kind: t.kind, version, tracking: t.tracking, cid } });
    await bus.emit('text.committed', { organismeId: acte.organisme_id, acteId: acte.id, textId: t.id, version, ctx });
    return { changed: true, version, tracking: t.tracking, changes: t.tracking ? S.listChanges(spans).filter((c) => c.cid === cid) : [] };
  }

  const svc = {
    KINDS,

    async ensureForActe(acteId) {
      const a = await db.get(
        `SELECT a.id, a.organisme_id, t.meta FROM actes a LEFT JOIN ref_items t ON t.id = a.type_id WHERE a.id = $1`, [acteId]);
      if (!a) return;
      const meta = a.meta || {};
      const ins = (delibId, kind) => db.run(
        `INSERT INTO tracked_texts (organisme_id, acte_id, deliberation_id, kind) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [a.organisme_id, acteId, delibId, kind]);
      if (meta.expose !== 'none') await ins(null, 'expose');
      for (const d of await db.all('SELECT id FROM deliberations WHERE acte_id = $1', [acteId])) { if (meta.visas !== 'none') await ins(d.id, 'visas'); await ins(d.id, 'dispositif'); }
    },

    async list(ctx, organismeId, acteId) {
      const acte = await actes.load(ctx, organismeId, acteId);
      const meta = (await db.get('SELECT meta FROM ref_items WHERE id = $1', [acte.type_id]))?.meta || {};
      const rows = await db.all('SELECT * FROM tracked_texts WHERE acte_id = $1 ORDER BY deliberation_id NULLS FIRST, kind DESC', [acte.id]);
      // Un type sans exposé ni visas (décision) n'affiche que la décision elle-même, même si des textes vides subsistent d'une version antérieure.
      return rows.filter((t) => !(meta.expose === 'none' && t.kind === 'expose') && !(meta.visas === 'none' && t.kind === 'visas')).map(summary);
    },

    async view(ctx, organismeId, acteId, textId, { mode = 'suivi', sinceAt } = {}) {
      const { acte, t } = await load(ctx, organismeId, acteId, textId);
      let spans = t.spans;
      if (t.tracking && !S.isConsistent(spans, t.markdown)) spans = await rebuild(t);
      const seen = await db.get('SELECT version_no, seen_at FROM text_seen WHERE text_id = $1 AND username = $2', [t.id, ctx.username]);
      const draft = await db.get('SELECT markdown, updated_at FROM text_drafts WHERE text_id = $1 AND username = $2', [t.id, ctx.username]);
      const authors = await db.all('SELECT username, name, color FROM text_authors WHERE text_id = $1 ORDER BY username', [t.id]);
      const since = mode === 'depuis' ? (sinceAt || seen?.seen_at || null) : null;
      let shown = spans;
      if (mode === 'propre') shown = S.initialSpans(t.markdown);
      else if (mode === 'depuis') shown = S.sinceView(spans, since);
      return {
        ...summary(t), mode, markdown: t.markdown, spans: shown, html: mode === 'propre' ? undefined : S.annotatedMarkdown(shown),
        changes: t.tracking ? S.listChanges(shown) : [], authors, since, seenVersion: seen?.version_no ?? null,
        draft: draft ? { markdown: draft.markdown, updatedAt: draft.updated_at } : null, canEdit: await acl.canEdit(ctx, acte),
      };
    },

    /** Enregistre : calcule le diff contre la version précédente et fusionne dans les spans (TRK-04). */
    async commit(ctx, organismeId, acteId, textId, { markdown, baseVersion, reason = null }) {
      const { acte, t } = await load(ctx, organismeId, acteId, textId, { edit: true });
      if (t.lock_user && t.lock_user !== ctx.username && new Date(t.lock_until) > new Date()) throw E.conflict(`Texte en cours de modification par ${t.lock_user}`, { lock: { user: t.lock_user, until: t.lock_until } });
      if (baseVersion !== t.version_no) throw E.conflict('Le texte a été modifié depuis votre lecture', { currentVersion: t.version_no, markdown: t.markdown });
      return applyCommit(ctx, acte, t, { markdown, reason });
    },

    /**
     * Applique un amendement adopté en séance (VOT-06) : le texte de la partie visée est remplacé, avec suivi des modifications si le suivi est actif,
     * au nom de l'amendement. Ne passe pas par les droits d'édition (l'acte est inscrit à l'ordre du jour) : l'appelant a déjà contrôlé la séance.
     */
    async amender(ctx, organismeId, acteId, { deliberationId = null, kind, markdown, reason }) {
      const acte = await actes.load(ctx, organismeId, acteId);
      const t = await db.get('SELECT * FROM tracked_texts WHERE acte_id = $1 AND kind = $2 AND deliberation_id IS NOT DISTINCT FROM $3', [acte.id, kind, kind === 'expose' ? null : deliberationId]);
      if (!t) throw E.notFound('Texte introuvable');
      const avant = t.markdown;
      const r = await applyCommit(ctx, acte, t, { markdown, reason });
      return { ...r, avant, version: r.version };
    },

    // ---- brouillon privé et verrou souple -------------------------------------------------------------------------------
    async saveDraft(ctx, organismeId, acteId, textId, markdown) {
      const { t } = await load(ctx, organismeId, acteId, textId, { edit: true });
      if (markdown.length > MAX_CHARS) throw E.badRequest('Brouillon trop long');
      await db.run(`INSERT INTO text_drafts (text_id, username, markdown) VALUES ($1,$2,$3)
                    ON CONFLICT (text_id, username) DO UPDATE SET markdown = EXCLUDED.markdown, updated_at = now()`, [t.id, ctx.username, markdown]);
      return { savedAt: new Date().toISOString() };
    },
    async getDraft(ctx, organismeId, acteId, textId) {
      const { t } = await load(ctx, organismeId, acteId, textId);
      const d = await db.get('SELECT markdown, updated_at FROM text_drafts WHERE text_id = $1 AND username = $2', [t.id, ctx.username]);
      return d ? { markdown: d.markdown, updatedAt: d.updated_at } : null;
    },
    async deleteDraft(ctx, organismeId, acteId, textId) {
      const { t } = await load(ctx, organismeId, acteId, textId);
      await db.run('DELETE FROM text_drafts WHERE text_id = $1 AND username = $2', [t.id, ctx.username]);
    },
    async lock(ctx, organismeId, acteId, textId) {
      const { t } = await load(ctx, organismeId, acteId, textId, { edit: true });
      if (t.lock_user && t.lock_user !== ctx.username && new Date(t.lock_until) > new Date()) throw E.conflict(`Texte verrouillé par ${t.lock_user}`, { lock: { user: t.lock_user, until: t.lock_until } });
      const r = await db.get(`UPDATE tracked_texts SET lock_user = $2, lock_until = now() + ($3 || ' minutes')::interval WHERE id = $1 RETURNING lock_user, lock_until`, [t.id, ctx.username, String(LOCK_MINUTES)]);
      return { user: r.lock_user, until: r.lock_until };
    },
    async unlock(ctx, organismeId, acteId, textId) {
      const { acte, t } = await load(ctx, organismeId, acteId, textId);
      if (t.lock_user && t.lock_user !== ctx.username && !acl.isAdmin(ctx, acte.organisme_id)) throw E.forbidden('Verrou détenu par un autre utilisateur');
      await db.run('UPDATE tracked_texts SET lock_user = NULL, lock_until = NULL WHERE id = $1', [t.id]);
    },

    // ---- historique et comparaison -------------------------------------------------------------------------------------------
    async versions(ctx, organismeId, acteId, textId) {
      const { t } = await load(ctx, organismeId, acteId, textId);
      const rows = await db.all('SELECT version_no, author, step_key, reason, created_at, length(markdown) AS characters FROM text_versions WHERE text_id = $1 ORDER BY version_no DESC', [t.id]);
      return rows.map((r) => ({ version: r.version_no, author: r.author, stepKey: r.step_key, reason: r.reason, at: r.created_at, characters: r.characters }));
    },
    async version(ctx, organismeId, acteId, textId, n) {
      const { t } = await load(ctx, organismeId, acteId, textId);
      const v = await db.get('SELECT * FROM text_versions WHERE text_id = $1 AND version_no = $2', [t.id, n]);
      if (!v) throw E.notFound('Version introuvable');
      return { version: v.version_no, author: v.author, at: v.created_at, markdown: v.markdown, spans: v.spans, html: S.annotatedMarkdown(v.spans) };
    },
    /** Compare deux versions quelconques (TRK-08) : suite de segments { added, removed, value }. */
    async compare(ctx, organismeId, acteId, textId, from, to) {
      const { t } = await load(ctx, organismeId, acteId, textId);
      const rows = await db.all('SELECT version_no, markdown FROM text_versions WHERE text_id = $1 AND version_no = ANY($2::int[])', [t.id, [from, to]]);
      const a = rows.find((r) => r.version_no === from); const b = rows.find((r) => r.version_no === to);
      if (!a || !b) throw E.notFound('Version introuvable');
      const parts = S.diffParts(a.markdown, b.markdown).map((p) => ({ added: !!p.added, removed: !!p.removed, value: p.value }));
      return { from, to, parts, changed: parts.some((p) => p.added || p.removed) };
    },

    /** Accepte ou rejette des modifications précises, ou toutes (consolidation, TRK-10). */
    async resolve(ctx, organismeId, acteId, textId, { decision, cids, all }) {
      const { acte, t } = await load(ctx, organismeId, acteId, textId, { edit: true });
      if (!t.tracking) throw E.conflict("Aucun suivi n'est actif sur ce texte (avant l'envoi au circuit)");
      let spans = S.isConsistent(t.spans, t.markdown) ? t.spans : await rebuild(t);
      const targets = all ? spans.filter((s) => s.type !== 'text').map((s) => s.cid) : cids;
      const known = new Set(spans.map((s) => s.cid).filter(Boolean));
      if (!all && cids.some((c) => !known.has(c))) throw E.notFound('Modification introuvable');
      spans = S.resolveChanges(spans, targets, decision);
      const markdown = S.liveText(spans);
      const version = t.version_no + 1;
      await db.tx(async (q) => {
        await q.run('UPDATE tracked_texts SET markdown = $2, spans = $3::jsonb, version_no = $4, updated_by = $5 WHERE id = $1', [t.id, markdown, JSON.stringify(spans), version, ctx.username]);
        await q.run('INSERT INTO text_versions (text_id, version_no, markdown, spans, author, step_key, reason) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)',
          [t.id, version, markdown, JSON.stringify(spans), ctx.username, acte.current_step_key, `${decision}:${all ? 'tout' : targets.length}`]);
      });
      await audit.log(ctx, { organismeId: acte.organisme_id, action: `texte.${decision}`, entity: 'tracked_texts', entityId: t.id, after: { acteId: acte.id, kind: t.kind, version, count: targets.length } });
      await bus.emit('text.resolved', { organismeId: acte.organisme_id, acteId: acte.id, textId: t.id, decision, ctx });
      return { version, markdown, changes: S.listChanges(spans) };
    },

    async markSeen(ctx, organismeId, acteId, textId, version) {
      const { t } = await load(ctx, organismeId, acteId, textId);
      await db.run(`INSERT INTO text_seen (text_id, username, version_no) VALUES ($1,$2,$3)
                    ON CONFLICT (text_id, username) DO UPDATE SET version_no = EXCLUDED.version_no, seen_at = now()`, [t.id, ctx.username, version ?? t.version_no]);
    },

    /** Démarre le suivi (envoi au circuit) : la version envoyée devient la référence (TRK-03). */
    async startTracking(acteId, ctx) {
      const rows = await db.all('SELECT * FROM tracked_texts WHERE acte_id = $1 AND NOT tracking', [acteId]);
      for (const t of rows) {
        const version = t.version_no + 1;
        const spans = S.initialSpans(t.markdown);
        await db.tx(async (q) => {
          await q.run('UPDATE tracked_texts SET tracking = true, spans = $2::jsonb, version_no = $3 WHERE id = $1', [t.id, JSON.stringify(spans), version]);
          await q.run("INSERT INTO text_versions (text_id, version_no, markdown, spans, author, reason) VALUES ($1,$2,$3,$4::jsonb,$5,'suivi')", [t.id, version, t.markdown, JSON.stringify(spans), ctx?.username || 'system']);
        });
      }
    },

    /** Textes vides bloquant l'envoi (CRE-02). */
    async missingTexts(acte, typeMeta = {}) {
      const rows = await db.all('SELECT kind, deliberation_id, markdown FROM tracked_texts WHERE acte_id = $1', [acte.id]);
      const out = [];
      // Un acte signé par le maire (décision, arrêté) a un « décide » (son dispositif) ; les autres un « délibéré ».
      const dispLabel = typeMeta.signature ? 'Décide' : KINDS.dispositif;
      if (typeMeta.expose !== 'none' && typeMeta.expose !== 'optional') {
        const e = rows.find((r) => r.kind === 'expose');
        if (!e || !e.markdown.trim()) out.push({ code: 'expose', label: 'Exposé des motifs' });
      }
      const delibs = await db.all('SELECT id, ordre FROM deliberations WHERE acte_id = $1 ORDER BY ordre', [acte.id]);
      for (const d of delibs) {
        for (const k of ['visas', 'dispositif']) {
          if (k === 'visas' && typeMeta.visas === 'none') continue;
          const r = rows.find((x) => x.deliberation_id === d.id && x.kind === k);
          if (!r || !r.markdown.trim()) out.push({ code: `${k}:${d.id}`, label: `${k === 'dispositif' ? dispLabel : KINDS[k]} (délibération ${d.ordre})` });
        }
      }
      return out;
    },

    async copyTexts(fromActeId, toActeId) {
      await svc.ensureForActe(toActeId);
      const src = await db.all('SELECT * FROM tracked_texts WHERE acte_id = $1', [fromActeId]);
      const srcDelibs = await db.all('SELECT id FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [fromActeId]);
      const dstDelibs = await db.all('SELECT id FROM deliberations WHERE acte_id = $1 ORDER BY ordre, id', [toActeId]);
      for (const s of src) {
        const dstD = s.deliberation_id ? dstDelibs[srcDelibs.findIndex((d) => d.id === s.deliberation_id)]?.id ?? null : null;
        if (s.deliberation_id && !dstD) continue;
        await db.run(`UPDATE tracked_texts SET markdown = $4, spans = $5::jsonb WHERE acte_id = $1 AND kind = $2 AND COALESCE(deliberation_id, 0) = COALESCE($3, 0)`,
          [toActeId, s.kind, dstD, s.markdown, JSON.stringify(S.initialSpans(s.markdown))]);
      }
    },
  };

  bus.on('acte.created', (p) => svc.ensureForActe(p.acteId));
  bus.on('deliberation.added', (p) => svc.ensureForActe(p.acteId));
  bus.on('acte.duplicated', (p) => svc.copyTexts(p.sourceId, p.acteId));
  return svc;
}

module.exports = { createTextes, KINDS };
