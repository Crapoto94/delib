import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { api, org as orgPath } from './api';
import { useAuth } from './auth';

/** « Reprendre les annexes ? » — cases cochées par défaut, que l'agent décoche. Rien n'est repris pour une case décochée. */
export function ChoixAnnexes({ acteId, onChange }: { acteId: number; onChange: (ids: number[]) => void }) {
  const { org } = useAuth();
  const [items, setItems] = useState<any[] | null>(null);
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    let vivant = true;
    api.get(orgPath(org!.id, `/actes/${acteId}/annexes`)).then((r) => { if (!vivant) return; const l = r.data.items || []; setItems(l); const tous = l.map((x: any) => x.id); setIds(tous); onChange(tous); }).catch(() => { if (vivant) { setItems([]); onChange([]); } });
    return () => { vivant = false; };
  }, [acteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const bascule = (id: number) => { const n = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; setIds(n); onChange(n); };
  if (items === null) return <p className="text-[12px] text-mute">Recherche des annexes…</p>;
  if (!items.length) return <p className="text-[12px] text-mute">Ce dossier n'a pas d'annexe.</p>;
  return (
    <fieldset className="rounded border border-line p-3">
      <legend className="px-1 text-[13px] font-semibold text-head"><Paperclip className="mr-1 inline h-4 w-4" />Reprendre les annexes ?</legend>
      <ul className="space-y-1">
        {items.map((x) => (
          <li key={x.id}><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={ids.includes(x.id)} onChange={() => bascule(x.id)} /> <span className="min-w-0 truncate">{x.titre || x.fichier || `Annexe ${x.id}`}</span></label></li>))}
      </ul>
      <p className="mt-2 text-[12px] text-mute">Décochez celles que vous ne voulez pas reprendre ({ids.length}/{items.length} reprise{ids.length > 1 ? 's' : ''}). Les fichiers sont partagés, pas dupliqués.</p>
    </fieldset>
  );
}
