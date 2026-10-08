import { api, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { AgentName } from '../AgentName';
import { Empty, ErrorBox, Loading, useLoad } from '../ui';

/** Libellé lisible de chaque action tracée dans le journal d'audit (ce qui n'est pas listé s'affiche tel quel). */
const LIBELLE: Record<string, string> = {
  'acte.create': 'Dossier créé', 'acte.update': 'Fiche modifiée', 'acte.copie': 'Dossier copié depuis un autre', 'acte.depuis_modele': 'Dossier créé depuis un modèle',
  'acte.delete': 'Dossier supprimé', 'acte.abandon': 'Dossier abandonné', 'acte.reactivate': 'Dossier réactivé', 'acte.rappele': 'Dossier rappelé', 'acte.reprise_rappel': 'Rédaction reprise après rappel',
  'acte.assiste': 'Mode assisté modifié', 'acte.collecte': 'Dossier collecté (arrêté)', 'acte.document_source': 'Document source déposé', 'acte.document_source_retire': 'Document source retiré',
  'acte.signature_position': 'Emplacement de la signature défini', 'acte.retour_signe': 'Retour du document signé', 'acte.report': 'Reporté à une autre séance',
  'acte.lien.ajout': 'Lien ajouté vers un autre acte', 'acte.lien.retrait': 'Lien retiré', 'acte.commission.add': 'Commission saisie', 'acte.commission.remove': 'Commission retirée', 'acte.commission.avis': 'Avis de commission',
  'acte.deliberation': 'Délibéré en séance', 'acte.deliberation.reouverture': 'Délibération rouverte',
  'deliberation.add': 'Délibération ajoutée', 'deliberation.delete': 'Délibération supprimée',
  'annexe.add': 'Annexe ajoutée', 'annexe.replace': 'Annexe remplacée (nouvelle version)', 'annexe.delete': 'Annexe supprimée',
  'texte.commit': 'Texte enregistré', 'texte.bureau': 'Texte modifié dans l’éditeur', 'bureau.ouvrir': 'Annexe ouverte dans l’éditeur', 'bureau.ouvrir_texte': 'Texte ouvert dans l’éditeur',
  'comment.add': 'Commentaire ajouté', 'comment.hide': 'Commentaire masqué',
  'circuit.validate': 'Étape validée', 'circuit.refuse': 'Dossier renvoyé', 'circuit.reassign': 'Étape réattribuée', 'circuit.adhoc': 'Étape ajoutée au circuit', 'circuit.reopen': 'Circuit rouvert',
  'notification.remind': 'Relance envoyée', 'notification.mute': 'Notifications coupées',
  'ia.adaptation': 'Adaptation par l’IA', 'ia.acceptation': 'Proposition de l’IA appliquée', 'ia.analyse.references': 'Contrôle des références par l’IA', 'ia.precontrole_juridique': 'Pré-contrôle juridique par l’IA',
  'odj.affecter': 'Inscrit à l’ordre du jour', 'derogation.request': 'Dérogation demandée', 'derogation.cancel': 'Dérogation annulée',
  'parapheur.envoi_echec': 'Échec d’envoi au parapheur', 'parapheur.annulation': 'Envoi au parapheur annulé', 'parapheur.reouverture': 'Dossier rouvert après signature',
  'tlt.prepare': 'Télétransmission préparée', 'tlt.envoi': 'Télétransmis à la préfecture', 'tlt.confirmation': 'Télétransmission confirmée', 'tlt.annulation': 'Télétransmission annulée', 'tlt.affichage': 'Date d’affichage enregistrée',
  'bibliotheque.consultation': 'Consulté dans la bibliothèque', 'bibliotheque.pdf': 'PDF téléchargé depuis la bibliothèque', 'bibliotheque.retrait': 'Retiré de la bibliothèque', 'bibliotheque.reintegration': 'Réintégré dans la bibliothèque',
  'trajet.consultation': 'Trajet consulté', 'entrainement.create': 'Dossier d’entraînement créé',
};

/** Détails utiles d'une trace (motif, titre, avis…), en clair ; jamais d'empreinte ni de structure technique brute. */
function detail(e: any): string {
  const a = e.after ?? {}; const b = e.before ?? {};
  const bouts: string[] = [];
  if (a.motif) bouts.push(`motif : ${a.motif}`);
  if (a.titre || b.titre) bouts.push(`« ${a.titre ?? b.titre} »`);
  if (a.commission) bouts.push(`commission ${a.commission}`);
  if (a.avis) bouts.push(`avis : ${a.avis}`);
  if (a.erreur || a.message) bouts.push(String(a.erreur ?? a.message));
  if (a.numero) bouts.push(`n° ${a.numero}`);
  if (typeof a.version === 'number') bouts.push(`version ${a.version}`);
  if (a.statut) bouts.push(`statut : ${a.statut}`);
  return bouts.join(' · ');
}

/** Journal de l'acte (administrateur et SCC) : qui a fait quoi sur ce dossier, quand — tiré du journal d'audit immuable. */
export default function JournalActe({ acteId }: { acteId: number }) {
  const { org } = useAuth(); const o = org!.id;
  const j = useLoad(async () => (await api.get(orgPath(o, `/actes/${acteId}/journal`))).data.items as any[], [o, acteId]);
  return (
    <div className="card p-5"><h3 className="mb-1">Journal de l’acte</h3>
      <p className="mb-3 text-[12px] text-mute">Toutes les actions réalisées sur ce dossier, de la plus récente à la plus ancienne. Réservé à l’administration et au SCC.</p>
      {j.loading && !j.data ? <Loading /> : !j.data ? <ErrorBox msg={j.error} /> : !j.data.length ? <Empty>Aucune action enregistrée.</Empty> : (
        <ol className="relative ml-1 max-h-[480px] overflow-y-auto border-l border-line">
          {j.data.map((e) => (
            <li key={e.id} className="relative mb-3 pl-5 last:mb-0">
              <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-line" />
              <div className="text-[13px] font-semibold text-head">{LIBELLE[e.action] ?? e.action}</div>
              <div className="text-[12px] text-mute">{e.actor === 'system' ? 'Système' : <AgentName u={e.actor} />}{e.onBehalfOf && <> (pour <AgentName u={e.onBehalfOf} />)</>} · {dt(e.at, { dateStyle: 'short', timeStyle: 'short' })}</div>
              {detail(e) && <div className="text-[12px] text-slate-600">{detail(e)}</div>}
            </li>))}
        </ol>)}
    </div>
  );
}
