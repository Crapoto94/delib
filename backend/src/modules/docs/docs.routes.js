const { z } = require('zod');

const Id = z.coerce.number().int().positive();
const Kind = z.enum(['dat', 'dex']);
const P = z.object({ orgId: Id, kind: Kind });

const pdf = (res, out, name) => res.set({
  'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"`,
  'X-Page-Count': String(out.pageCount), 'Cache-Control': 'private, no-store',
}).send(out.buffer);

module.exports = ({ makeRouter, docs }) => {
  const r = makeRouter('/api/v1/organismes/:orgId');

  r.get('/aide/documents', {
    summary: "Documents techniques de l'application (DAT, DEX)", tags: ['aide'], org: true, roles: ['org_admin'], params: z.object({ orgId: Id }),
    description: "Contenu rédigé, versionné avec l'application : document d'architecture technique (DAT) et dossier d'exploitation (DEX).",
  }, async (req, res) => res.json(docs.list()));

  r.get('/aide/documents/:kind', {
    summary: "Contenu d'un document technique", tags: ['aide'], org: true, roles: ['org_admin'], params: P,
  }, async (req, res) => res.json(docs.get(req.valid.params.kind)));

  r.get('/aide/documents/:kind/pdf', {
    summary: "PDF d'un document technique (DAT ou DEX)", tags: ['aide'], org: true, roles: ['org_admin'], params: P,
    description: "Rendu au gabarit de l'organisme (marges, police, en-tête). En-tête de réponse « X-Page-Count ».",
  }, async (req, res) => pdf(res, await docs.pdf(req.org.id, req.valid.params.kind), req.valid.params.kind));

  return [r];
};
