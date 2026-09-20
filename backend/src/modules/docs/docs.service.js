/**
 * Documents techniques (DAT, DEX) : contenu unique (Markdown) exposé à l'aide en ligne et rendu en PDF par le
 * même pipeline que les autres documents (gabarit, polices, en-tête de l'organisme).
 */
const pkg = require('../../../package.json');
const { E } = require('../../shared/errors');
const content = require('./content');

const META = {
  dat: {
    titre: "Document d'Architecture Technique (DAT)",
    resume: "Architecture technique : composants, flux, données, intégrations, sécurité et prérequis.",
  },
  dex: {
    titre: "Dossier d'Exploitation (DEX)",
    resume: "Exploitation : installation, configuration, sauvegardes, supervision, mises à jour et incidents.",
  },
};

function createDocs({ render, config }) {
  const vars = () => ({ version: pkg.version, env: config.env, date: new Date().toLocaleDateString('fr-FR') });

  const all = () => content.kinds.map((kind) => {
    const meta = META[kind] || { titre: kind, resume: '' };
    return { kind, titre: meta.titre, resume: meta.resume, markdown: content.build(kind, vars()) };
  });

  const get = (kind) => {
    const doc = all().find((x) => x.kind === kind);
    if (!doc) throw E.notFound('Document technique inconnu');
    return doc;
  };

  /** PDF au gabarit de l'organisme, sans filigrane « PROJET » (ce ne sont pas des projets d'actes). */
  async function pdf(organismeId, kind) {
    const doc = get(kind);
    return render.build({
      organismeId, docType: 'dossier', watermark: '', title: doc.titre,
      content: [{ type: 'runs', runs: [{ text: doc.markdown, type: 'text' }] }], vars: {},
    });
  }

  return { list: () => ({ items: all() }), get, pdf };
}

module.exports = { createDocs };
