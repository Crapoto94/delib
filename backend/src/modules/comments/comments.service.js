/**
 * Discussion d'un acte (section 14) : fil visible de toutes les personnes du circuit, mentions @agent, réponses,
 * résolution, masquage par l'administrateur (jamais de suppression). Les refus y déposent leur motif (CIR-12).
 */
const { E } = require('../../shared/errors');

const MENTION = /@([a-z0-9._-]{2,64})/gi;
const toC = (r) => ({
  id: r.id, acteId: r.acte_id, parentId: r.parent_id, author: r.author, title: r.title, body: r.hidden ? '[commentaire masqué]' : r.body,
  stepKey: r.step_key, kind: r.kind, mentions: r.mentions, resolved: r.resolved, hidden: r.hidden, createdAt: r.created_at,
});

function createComments({ db, audit, actes, acl, bus }) {
  const svc = {
    parseMentions: (text) => [...new Set([...String(text).matchAll(MENTION)].map((m) => m[1].toLowerCase()))],

    async list(ctx, organismeId, acteId) {
      const a = await actes.load(ctx, organismeId, acteId);
      return (await db.all('SELECT * FROM comments WHERE acte_id = $1 ORDER BY created_at, id', [a.id])).map(toC);
    },

    /** Écriture interne (système, refus) sans contrôle d'accès : l'appelant a déjà vérifié le droit d'agir. */
    async insert({ acteId, author, body, title = null, kind = 'comment', stepKey = null, parentId = null }) {
      const mentions = svc.parseMentions(body);
      return toC(await db.get(
        `INSERT INTO comments (acte_id, parent_id, author, title, body, step_key, kind, mentions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [acteId, parentId, author, title, body, stepKey, kind, JSON.stringify(mentions)]));
    },

    async add(ctx, organismeId, acteId, { body, title, parentId }) {
      const a = await actes.load(ctx, organismeId, acteId);
      if (acl.isStaff(ctx, a.organisme_id) && !acl.isAdmin(ctx, a.organisme_id) && !(a.participants || []).includes(ctx.username) && a.redacteur !== ctx.username)
        throw E.forbidden('Le rôle lecteur ne peut pas commenter');
      if (parentId) {
        const p = await db.get('SELECT 1 AS x FROM comments WHERE id = $1 AND acte_id = $2', [parentId, a.id]);
        if (!p) throw E.badRequest('Commentaire parent introuvable dans cet acte');
      }
      const c = await svc.insert({ acteId: a.id, author: ctx.username, body, title: title || null, stepKey: a.current_step_key, parentId: parentId || null });
      await audit.log(ctx, { organismeId: a.organisme_id, action: 'comment.add', entity: 'comments', entityId: c.id, after: { acteId: a.id, mentions: c.mentions } });
      await bus.emit('comment.added', { organismeId: a.organisme_id, acteId: a.id, comment: c, ctx });
      return c;
    },

    async resolve(ctx, organismeId, acteId, id, resolved) {
      const a = await actes.load(ctx, organismeId, acteId);
      const r = await db.get('UPDATE comments SET resolved = $3 WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id, resolved]);
      if (!r) throw E.notFound('Commentaire introuvable');
      return toC(r);
    },

    async hide(ctx, organismeId, acteId, id, hidden) {
      const a = await actes.load(ctx, organismeId, acteId);
      if (!acl.isAdmin(ctx, a.organisme_id)) throw E.forbidden("Réservé à l'administrateur ou au SCC");
      const r = await db.get('UPDATE comments SET hidden = $3 WHERE id = $1 AND acte_id = $2 RETURNING *', [id, a.id, hidden]);
      if (!r) throw E.notFound('Commentaire introuvable');
      await audit.log(ctx, { organismeId: a.organisme_id, action: hidden ? 'comment.hide' : 'comment.unhide', entity: 'comments', entityId: id });
      return toC(r);
    },
  };
  return svc;
}

module.exports = { createComments };
