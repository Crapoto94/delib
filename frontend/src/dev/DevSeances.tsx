import { CarteSeance } from '../pages/SeancesParts';

const dans = (n: number, h = 18) => { const d = new Date(Date.now() + n * 86400000); d.setHours(h, 30, 0, 0); return d.toISOString(); };
const synth = (o: any) => ({ jours: 45, cloture: { date: dans(3), jours: 3, passe: false }, jalons: [{ code: 'convocation', label: 'Convocations le', date: dans(40), passe: false }, { code: 'dgs', label: 'Validation DGS', date: dans(30), passe: false }, { code: 'mad_commissions', label: 'Commissions', date: dans(25), passe: false }, { code: 'seance', label: 'Séance', date: dans(45), passe: false }],
  dossiers: 30, prets: 28, dansOdj: 28, tauxRealisation: 93, aTerminer: 2, enRetard: 2, directionsEnRetard: 2, directionsATerminer: 2, etape: { cle: 'preparation', label: 'Préparation', retient: ["le cahier de séance n'est pas construit"] }, terminee: false, ...o });

/** Banc d'essai visuel de la liste des séances (développement uniquement : /dev/seances). */
export default function DevSeances() {
  const base = { odjStatut: 'arrete', statut: 'planifiee', kind: 'conseil', lieu: 'Hôtel de Ville (Salle du Conseil)', instance: 'Conseil municipal', type: 'ordinaire', teams: null, actesEnAttente: 3 };
  const noop = () => undefined;
  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-6">
      <CarteSeance s={{ ...base, id: 1, dateSeance: dans(45), dateLimiteRedaction: dans(3) }} synth={synth({}) as any} isScc compacte={false} onEdit={noop} onDelete={noop} onRelancer={noop} />
      <CarteSeance s={{ ...base, id: 2, odjStatut: 'en_preparation', dateSeance: dans(74), dateLimiteRedaction: dans(27) }} synth={synth({ jours: 74, tauxRealisation: 61, dansOdj: 14, dossiers: 23, enRetard: 0, directionsEnRetard: 0, aTerminer: 9, directionsATerminer: 3, cloture: { date: dans(27), jours: 27, passe: false }, etape: { cle: 'redaction', label: 'Rédaction', retient: ['9 dossiers pas encore validés'] } }) as any} isScc compacte={false} onEdit={noop} onDelete={noop} onRelancer={noop} />
      <CarteSeance s={{ ...base, id: 3, kind: 'commission', instance: 'Commission des finances', dateSeance: dans(9, 9) }} isScc compacte={false} onEdit={noop} onDelete={noop} onRelancer={noop} />
      <CarteSeance s={{ ...base, id: 4, dateSeance: dans(109) }} synth={synth({ jours: 109 }) as any} isScc compacte onEdit={noop} onDelete={noop} onRelancer={noop} />
    </div>
  );
}
