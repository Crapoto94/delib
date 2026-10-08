/**
 * Arrêté DÉJÀ SIGNÉ : l'acte a été signé hors de l'application (papier numérisé, autre outil). On ne rejoue pas le parcours : on saisit les
 * éléments nécessaires, on dépose l'arrêté (PDF) et ses éventuelles annexes. Pas d'exposé des motifs. L'acte est directement « signé », donc
 * consultable dans la bibliothèque, et le contrôle de légalité est soit à faire (proposé dans la télétransmission), soit déjà fait.
 *
 * Le dossier est créé comme n'importe quel acte (droits de rédaction, direction du rédacteur…) puis passé à « signé » une fois le document
 * et les annexes déposés ; en cas d'échec en cours de route, le dossier à moitié créé est supprimé.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const ETATS = ['a_transmettre', 'deja_envoye'];
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Contrôle de légalité d'un arrêté signé : { etat, dateEnvoi?, dateAr?, numeroAr? } (dates AAAA-MM-JJ, jamais dans le futur). */
function verifierControle(c) {
  if (!c || !ETATS.includes(c.etat)) throw E.badRequest('Indiquez si l’arrêté est à transmettre au contrôle de légalité ou déjà envoyé');
  if (c.etat === 'a_transmettre') return { etat: 'a_transmettre' };
  const auj = aujourdhui();
  if (!c.dateEnvoi) throw E.badRequest('Indiquez la date d’envoi au contrôle de légalité');
  if (c.dateEnvoi > auj) throw E.badRequest('La date d’envoi ne peut pas être dans le futur');
  if (c.dateAr && (c.dateAr > auj || c.dateAr < c.dateEnvoi)) throw E.badRequest('La date d’accusé de réception doit être postérieure à l’envoi et ne peut pas être dans le futur');
  return { etat: 'deja_envoye', dateEnvoi: c.dateEnvoi, ...(c.dateAr ? { dateAr: c.dateAr } : {}), ...(c.numeroAr ? { numeroAr: String(c.numeroAr).slice(0, 80) } : {}) };
}

function createArretesSignes({ db, audit, actes, annexes, render, refs, acl, bus }) {
  const svc = {
    verifierControle,

    async creer(ctx, organismeId, b, arrete, piecesJointes = []) {
      const org = requireOrg(organismeId);
      if (!arrete?.buffer) throw E.badRequest('Déposez l’arrêté signé (champ « arrete »)');
      if (arrete.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw E.badRequest('L’arrêté signé doit être un PDF');
      if (b.dateSignature > aujourdhui()) throw E.badRequest('La date de signature ne peut pas être dans le futur');
      const controle = verifierControle(b.controleLegalite);
      const type = await refs.byCode('type_acte', 'arrete', org).catch(() => null);
      if (!type) throw E.conflict('Le type d’acte « arrêté » est introuvable dans les référentiels');
      const titres = b.annexesTitres || [];
      const dejaSigne = { dateSignature: b.dateSignature, signataire: b.signataire || null, numeroArrete: b.numeroArrete || null, creeLe: new Date().toISOString(), creePar: ctx.username };
      const acte = await actes.create(ctx, org, {
        typeId: type.id, titre: b.titre, ...(b.directionCode ? { directionCode: b.directionCode } : {}), ...(b.serviceLabel ? { serviceLabel: b.serviceLabel } : {}),
        ...(b.natureId ? { natureId: b.natureId } : {}), ...(b.matiereId ? { matiereId: b.matiereId } : {}), ...(b.rubriqueId ? { rubriqueId: b.rubriqueId } : {}),
        confidentialite: b.confidentialite || 'normale', custom: { dejaSigne },
      });
      try {
        await render.setSource(ctx, org, acte.id, { trame: 'presente' }, arrete);
        for (let i = 0; i < piecesJointes.length; i++) {
          await annexes.add(ctx, org, acte.id, { titre: String(titres[i] || piecesJointes[i].originalname || `Annexe ${i + 1}`).trim().slice(0, 300) || `Annexe ${i + 1}`, communicable: true, publiable: true, transmissible: true }, piecesJointes[i]);
        }
        await db.run(
          `UPDATE actes SET statut = 'signe', signe_at = $2::timestamptz, signe_par = $3, custom = custom || $4::jsonb, submitted_at = COALESCE(submitted_at, now()) WHERE id = $1`,
          [acte.id, `${b.dateSignature}T12:00:00+02:00`, b.signataire || null, JSON.stringify({ controleLegalite: controle })]);
      } catch (e) {
        await db.run("DELETE FROM actes WHERE id = $1 AND statut = 'brouillon' AND NOT site", [acte.id]).catch(() => null);   // pas de dossier à moitié créé
        throw e;
      }
      await bus?.emit?.('acte.created', { organismeId: org, acteId: acte.id });   // le document est joint : (ré)indexation de la recherche
      await audit.log(ctx, { organismeId: org, action: 'acte.arrete_signe', entity: 'actes', entityId: acte.id, after: { titre: b.titre, dateSignature: b.dateSignature, numeroArrete: b.numeroArrete || null, annexes: piecesJointes.length, controleLegalite: controle.etat } });
      return actes.get(ctx, org, acte.id);
    },

    /** Contrôle de légalité d'un arrêté signé : à transmettre (proposé dans la télétransmission) ou déjà envoyé (date, accusé de réception). */
    async definirControle(ctx, organismeId, acteId, b) {
      const org = requireOrg(organismeId);
      const a = await actes.load(ctx, org, acteId);
      if (a.statut !== 'signe') throw E.conflict('Seul un acte signé peut être suivi ici');
      if (!(a.redacteur === ctx.username || acl.isAdmin(ctx, org))) throw E.forbidden('Réservé au rédacteur, à l’administrateur et au SCC');
      const controle = verifierControle(b);
      if (controle.etat === 'deja_envoye' && await db.get("SELECT 1 AS x FROM tlt_transactions WHERE acte_id = $1 AND etat IN ('prepare', 'poste')", [a.id])) {
        throw E.conflict('Une télétransmission est en cours pour cet acte : elle fait foi');
      }
      await db.run('UPDATE actes SET custom = custom || $2::jsonb WHERE id = $1', [a.id, JSON.stringify({ controleLegalite: controle })]);
      await audit.log(ctx, { organismeId: org, action: 'acte.controle_legalite', entity: 'actes', entityId: a.id, before: a.custom?.controleLegalite ?? null, after: controle });
      return controle;
    },
  };
  return svc;
}

module.exports = { createArretesSignes, verifierControle };
