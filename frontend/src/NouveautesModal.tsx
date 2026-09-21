import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from './ui';
import { Select } from './Select';
import { VERSIONS, VERSION } from './nouveautes';

/**
 * « Nouveautés » (What's New) : le journal des versions, une version par page.
 * Hauteur constante (la liste défile) et accès direct à une version. S'ouvre depuis le pied de page.
 */
export default function Nouveautes({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const v = VERSIONS[i];
  const derniere = i >= VERSIONS.length - 1;
  return (
    <Modal title="Nouveautés de VibeDélib" onClose={onClose} wide>
      <div className="flex flex-col" style={{ height: 'min(70vh, 34rem)' }}>
        <div className="shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${v.type === 'minor' ? 'bg-action/10 text-action border-action/30' : 'bg-slate-100 text-slate-700 border-slate-300/70'}`}>{v.type === 'minor' ? 'Nouveauté' : 'Correctif'}</span>
            <span className="ml-auto font-mono text-[12px] text-mute">version {v.version}{v.version === VERSION ? ' · actuelle' : ''}</span>
          </div>
          <h3 className="mt-2 !text-[16px]">{v.titre}</h3>
        </div>
        <ul className="mt-3 min-h-0 flex-1 list-disc space-y-2 overflow-auto pl-5 pr-2 text-[13px] leading-6">{v.items.map((x, k) => <li key={k}>{x}</li>)}</ul>
        <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <button className="btn-secondary" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft className="h-4 w-4" /> Plus récent</button>
          <label className="flex items-center gap-2 text-[12px] text-mute">
            Aller à la version
            <Select className="input w-auto" value={String(i)} onChange={(e) => setI(Number(e.target.value))} aria-label="Aller à une version">
              {VERSIONS.map((x, k) => <option key={x.version} value={k}>{`${k + 1}. ${x.version} — ${x.titre}`}</option>)}
            </Select>
            <span className="whitespace-nowrap">/ {VERSIONS.length}</span>
          </label>
          <button className="btn-secondary" disabled={derniere} onClick={() => setI(i + 1)}>Plus ancien <ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </Modal>
  );
}
