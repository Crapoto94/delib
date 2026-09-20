/**
 * Pièces produites après la séance (PST-01, PST-03, PST-04 — D81) : procès-verbal, liste des délibérations et extrait du registre
 * de chaque délibération, en PDF, à partir du suivi de séance (présences, pouvoirs, votes, résultats, notes du secrétariat).
 * Générées à la demande : la séance est la source unique de vérité, il n'y a pas de copie à tenir à jour.
 * Filigrane « PROJET » tant que la séance n'est pas close. Un scrutin secret n'imprime aucun nom.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const RESULTAT = {
  adopte_unanimite: "ADOPTÉE à l'unanimité", adopte_majorite: 'ADOPTÉE à la majorité', adopte_preponderante: 'ADOPTÉE (voix prépondérante du président de séance)',
  rejete: 'REJETÉE', rejete_preponderante: 'REJETÉE (voix prépondérante du président de séance)',
};
const ETAT = { sans_vote: 'Point clos sans vote (communication).', retire: 'Point RETIRÉ de l’ordre du jour.', ajourne: 'Point AJOURNÉ.', a_traiter: 'Point non traité.', en_cours: 'Point en cours de traitement.' };
const SCRUTIN = { main_levee: 'à main levée', public: 'public', secret: 'secret', unanimite: 'à l’unanimité' };
const dateLong = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const heure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ');
const nom = (m) => `${m.prenom ? `${m.prenom} ` : ''}${String(m.nom).toUpperCase()}`.trim();
const noms = (list) => list.map(nom).join(', ');

function createPv({ db, audit, render, odj, tenue, actes }) {
  const need = async (ctx, org) => { if (!(await odj.canEditOdj(ctx, org))) throw E.forbidden('Les pièces de séance sont réservées au SCC, à la DGS et aux administrateurs'); };
  const load = async (ctx, org, seanceId) => {
    await need(ctx, org);
    const d = await tenue.donnees(ctx, org, seanceId);
    if (!d) throw E.conflict("La séance n'a pas été ouverte dans le suivi de séance : il n'y a pas encore de données à mettre en forme");
    return d;
  };
  const watermark = (d) => (d.tenue.statut === 'close' ? '' : 'PROJET — séance en cours');
  const runs = (text) => ({ type: 'runs', runs: [{ type: 'text', text }] });
  const byId = (d) => new Map(d.membres.map((m) => [m.id, m]));

  /** Texte d'un vote : décompte, puis noms (jamais en scrutin secret). */
  function voteLines(d, p, map) {
    const dec = p.decompte || {}; const votes = d.votes.get(p.id) || new Map();
    const lines = [`Vote (scrutin ${SCRUTIN[p.scrutin] || 'à main levée'}) : **Pour** ${dec.pour ?? 0} ; **Contre** ${dec.contre ?? 0} ; **Abstention** ${dec.abstention ?? 0} ; **ne prennent pas part au vote** ${dec.nppv ?? 0} ; absents ${dec.absents ?? 0}.`];
    if (p.scrutin === 'secret') return lines;
    const label = (id) => { const rec = votes.get(id); const m = map.get(id); return rec?.mandataire && map.get(rec.mandataire) ? `${nom(m)} (pouvoir donné à ${nom(map.get(rec.mandataire))})` : nom(m); };
    for (const [choix, titre] of [['contre', 'Contre'], ['abstention', 'Abstention'], ['nppv', 'Ne prennent pas part au vote'], ...(p.scrutin === 'public' ? [['pour', 'Pour']] : [])]) {
      const ids = d.membres.filter((m) => votes.get(m.id)?.choix === choix).map((m) => m.id);
      if (ids.length) lines.push(`${titre} : ${ids.map(label).join(', ')}.`);
    }
    return lines;
  }

  /** Bloc « présences » commun au procès-verbal et à l'extrait. */
  function presenceLines(d, map) {
    const pres = (m) => d.presences.get(m.id);
    const presents = d.membres.filter((m) => pres(m)?.statut === 'present'); const excuses = d.membres.filter((m) => pres(m)?.statut === 'excuse');
    const absents = d.membres.filter((m) => !pres(m) || pres(m).statut === 'absent');
    const groupes = [];
    for (const m of presents) { const k = m.groupe_nom || 'Sans groupe'; let g = groupes.find((x) => x.k === k); if (!g) { g = { k, l: [] }; groupes.push(g); } g.l.push(m); }
    const out = [`**Membres en exercice** : ${d.membres.length}. **Présents** : ${presents.length}.`];
    for (const g of groupes) out.push(`- ${g.k} : ${noms(g.l)}`);
    if (excuses.length) out.push(`**Absents excusés** : ${noms(excuses)}.`);
    if (absents.length) out.push(`**Absents** : ${noms(absents)}.`);
    const pouvoirs = d.procurations.filter((p) => map.get(p.mandant) && map.get(p.mandataire));
    if (pouvoirs.length) out.push(`**Pouvoirs** : ${pouvoirs.map((p) => `${nom(map.get(p.mandant))} a donné pouvoir à ${nom(map.get(p.mandataire))}`).join(' ; ')}.`);
    return out;
  }

  const bureauLines = (d, map) => [
    ...(d.tenue.president_elu_id && map.get(d.tenue.president_elu_id) ? [`**Président de séance** : ${nom(map.get(d.tenue.president_elu_id))}.`] : []),
    ...(d.tenue.secretaire_elu_id && map.get(d.tenue.secretaire_elu_id) ? [`**Secrétaire de séance** : ${nom(map.get(d.tenue.secretaire_elu_id))}.`] : []),
  ];

  const svc = {
    /** Procès-verbal : bureau, présences, mouvements de salle, puis chaque point avec son décompte et son résultat. */
    async proces(ctx, organismeId, seanceId, { notes = true } = {}) {
      const org = requireOrg(organismeId); const d = await load(ctx, org, seanceId); const s = d.seance; const map = byId(d);
      const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
      const numeroOf = new Map(d.points.map((p) => [p.id, p.numero]));
      const firstPoint = d.journal.find((j) => j.type === 'point');
      const mouvements = firstPoint ? d.journal.filter((j) => ['arrivee', 'sortie', 'retour'].includes(j.type) && j.id > firstPoint.id && map.get(j.elu_id)) : [];
      const verbe = { arrivee: 'arrive en séance', sortie: 'quitte la salle', retour: 'revient en salle' };
      const body = [
        `${s.instance} — ${dateLong(s.dateSeance)}${s.lieu ? `, ${s.lieu}` : ''}.`,
        `Séance ouverte à ${heure(d.tenue.ouverte_at)}${d.tenue.close_at ? `, close à ${heure(d.tenue.close_at)}` : ' (en cours)'}.`, '',
        ...bureauLines(d, map), '',
        '## Présences', '', ...presenceLines(d, map), '',
        ...(mouvements.length ? ['**Mouvements en cours de séance**', ...mouvements.map((j) => `- ${heure(j.at)} — ${nom(map.get(j.elu_id))} ${verbe[j.type]}${j.item_id && numeroOf.get(j.item_id) ? ` (point n° ${numeroOf.get(j.item_id)})` : ''}`), ''] : []),
        '## Ordre du jour et délibérations', '',
      ];
      for (const p of d.points) {
        if (p.kind === 'chapitre') { body.push(`### ${p.titre}`, ''); continue; }
        if (p.statut === 'retire') continue;
        body.push(`**${p.numero ? `Point n° ${p.numero}` : 'Point'}** — ${p.titre}`);
        if (p.acte) body.push(`Dossier n° ${p.acte.numeroSuivi}${p.acte.rapporteur ? ` — rapporteur : ${p.acte.rapporteur}` : ''}.`);
        if (notes && p.notes?.trim()) body.push('', `*Observations* : ${p.notes.trim()}`);
        body.push('');
        if (p.etat === 'traite') body.push(...voteLines(d, p, map), `**Résultat : ${RESULTAT[p.resultat] || ''}**`);
        else body.push(ETAT[p.etat] || '');
        body.push('');
      }
      body.push('', ...bureauLines(d, map).length ? ['Le Président de séance,' + ' '.repeat(40) + 'Le Secrétaire de séance,'] : []);
      const vars = { organisme: orgRow?.nom || '', date_seance: dateLong(s.dateSeance).toUpperCase(), instance: s.instance };
      const pdf = await render.build({ organismeId: org, docType: 'registre', vars, watermark: watermark(d), title: `Procès-verbal — ${s.instance}`, content: [
        { type: 'space', h: 10 },
        { type: 'title', text: orgRow?.nom || '', size: 14, align: 'center', bold: true, after: 8 },
        { type: 'title', text: 'PROCÈS-VERBAL DE SÉANCE', size: 18, align: 'center', bold: true, boxed: true, after: 12 },
        runs(body.join('\n')),
      ] });
      await audit.log(ctx, { organismeId: org, action: 'seance.pv', entity: 'seances', entityId: seanceId, after: { type: 'proces-verbal', pages: pdf.pageCount } });
      return { buffer: pdf.buffer, name: `proces-verbal-seance-${seanceId}.pdf`, pages: pdf.pageCount };
    },

    /** Liste des délibérations de la séance (PST-04) : numéro, objet, rapporteur, résultat. */
    async liste(ctx, organismeId, seanceId) {
      const org = requireOrg(organismeId); const d = await load(ctx, org, seanceId); const s = d.seance;
      const orgRow = await db.get('SELECT nom FROM organismes WHERE id = $1', [org]);
      const lines = [];
      for (const p of d.points) {
        if (p.kind === 'chapitre') { lines.push('', `### ${p.titre}`); continue; }
        if (p.statut === 'retire') continue;
        lines.push(`**${p.numero ?? '·'}** — ${p.titre}`);
        lines.push(`${p.acte?.rapporteur ? `Rapporteur : ${p.acte.rapporteur} — ` : ''}${p.etat === 'traite' ? (RESULTAT[p.resultat] || '') : (ETAT[p.etat] || '')}${p.etat === 'traite' && p.decompte ? ` (${p.decompte.pour} pour, ${p.decompte.contre} contre, ${p.decompte.abstention} abstention(s), ${p.decompte.nppv} ne prenant pas part au vote)` : ''}`, '');
      }
      const vars = { organisme: orgRow?.nom || '', date_seance: dateLong(s.dateSeance).toUpperCase(), instance: s.instance };
      const pdf = await render.build({ organismeId: org, docType: 'registre', vars, watermark: watermark(d), title: `Liste des délibérations — ${s.instance}`, content: [
        { type: 'space', h: 10 },
        { type: 'title', text: orgRow?.nom || '', size: 14, align: 'center', bold: true, after: 8 },
        { type: 'title', text: 'LISTE DES DÉLIBÉRATIONS', size: 18, align: 'center', bold: true, boxed: true, after: 10 },
        { type: 'title', text: `${s.instance} — ${dateLong(s.dateSeance)}`, size: 12, align: 'center', bold: true, after: 12 },
        runs(lines.join('\n')),
      ] });
      await audit.log(ctx, { organismeId: org, action: 'seance.pv', entity: 'seances', entityId: seanceId, after: { type: 'liste', pages: pdf.pageCount } });
      return { buffer: pdf.buffer, name: `liste-deliberations-seance-${seanceId}.pdf`, pages: pdf.pageCount };
    },

    /** Extrait du registre d'une délibération votée (PST-01) : gabarit « délibération » de l'organisme + mention du vote + présences. */
    async extrait(ctx, organismeId, seanceId, itemId) {
      const org = requireOrg(organismeId); const d = await load(ctx, org, seanceId); const map = byId(d);
      const p = d.points.find((x) => x.id === itemId);
      if (!p) throw E.notFound("Point introuvable dans l'ordre du jour de cette séance");
      if (p.kind !== 'deliberation' || !p.acte) throw E.badRequest("Seule une délibération a un extrait du registre");
      if (p.etat !== 'traite') throw E.conflict("Cette délibération n'a pas fait l'objet d'un vote : il n'y a pas d'extrait à produire");
      const acte = await actes.load(ctx, org, p.acte.id);
      const item = await db.get('SELECT deliberation_id FROM seance_items WHERE id = $1', [itemId]);
      const delib = await db.get('SELECT * FROM deliberations WHERE id = $1', [item?.deliberation_id]);
      if (!delib) throw E.conflict('Délibération introuvable');
      const { pick } = await render.textsFor(ctx, acte, 'deliberation', delib.id);
      const tpl = await render.getTemplate(org, 'deliberation');
      const vars = await render.varsFor(acte, delib);
      const text = (row) => (row ? render.runsOf({ ...row, markdown: row.markdown }, 'propre') : [{ text: '', type: 'text' }]);
      const dispLabel = tpl.cfg.sections?.dispositif ?? 'Après en avoir délibéré, le conseil DÉCIDE :';
      const mention = [
        '', `**Mention du vote** — séance du ${dateLong(d.seance.dateSeance)}`, '', ...voteLines(d, p, map), `**Résultat : ${RESULTAT[p.resultat] || ''}**`, '',
        ...bureauLines(d, map), '', ...presenceLines(d, map),
      ];
      const pdf = await render.build({ organismeId: org, docType: 'deliberation', vars, watermark: watermark(d), title: `Extrait du registre — ${delib.titre}`, content: [
        ...render.headerItems(tpl.cfg),
        { type: 'runs', runs: text(pick('visas', delib.id)) }, { type: 'space', h: 6 },
        ...(dispLabel ? [{ type: 'title', text: dispLabel, size: 11, bold: true, align: 'left', after: 4 }] : []),
        { type: 'runs', runs: text(pick('dispositif', delib.id)) },
        { type: 'space', h: 8 }, runs(mention.join('\n')),
      ] });
      await audit.log(ctx, { organismeId: org, action: 'seance.pv', entity: 'seances', entityId: seanceId, after: { type: 'extrait', itemId, acteId: acte.id, pages: pdf.pageCount } });
      return { buffer: pdf.buffer, name: `extrait-registre-${p.numero || itemId}.pdf`, pages: pdf.pageCount };
    },
  };
  return svc;
}

module.exports = { createPv, RESULTAT };
