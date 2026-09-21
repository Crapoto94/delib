import { Link } from 'react-router-dom';
import { dt } from './format';

/** Séance visée d'un acte (date et instance), avec lien vers son ordre du jour ; « — » quand l'acte n'en vise pas. */
export function SeanceVisee({ acte }: { acte: { seanceVisee?: { id: number; dateSeance: string; instance: string } | null } }) {
  const s = acte.seanceVisee;
  if (!s) return <span className="text-mute">—</span>;
  return <Link className="text-[12px] font-semibold text-head hover:underline" to={`/seances/${s.id}`}>{dt(s.dateSeance, { dateStyle: 'medium' })}<div className="font-normal text-mute">{s.instance}</div></Link>;
}
