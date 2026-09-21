import { Link } from 'react-router-dom';
import { dt } from './format';

export type SeanceViseeInfo = { id: number; dateSeance: string; instance: string; inscrit?: boolean };

/** Séance visée d'un acte (date et instance), avec lien vers son ordre du jour ; « — » quand l'acte n'en vise pas.
 *  En gras : l'acte est inscrit à l'ordre du jour de cette séance ; en italique : elle n'est que visée (pas encore inscrit). */
export function SeanceVisee({ acte }: { acte: { seanceVisee?: SeanceViseeInfo | null } }) {
  const s = acte.seanceVisee;
  if (!s) return <span className="text-mute">—</span>;
  return (
    <Link className={`text-[12px] text-head hover:underline ${s.inscrit ? 'font-bold' : 'font-normal italic'}`} to={`/seances/${s.id}`}
      title={s.inscrit ? "Inscrit à l'ordre du jour de cette séance" : "Séance visée — pas encore inscrit à l'ordre du jour"}>
      {dt(s.dateSeance, { dateStyle: 'medium' })}<div className="font-normal text-mute">{s.instance}{s.inscrit ? '' : ' · pas encore inscrit'}</div>
    </Link>
  );
}
