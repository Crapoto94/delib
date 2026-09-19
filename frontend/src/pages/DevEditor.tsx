import { useState } from 'react';
import RichEditor, { EditorMode } from '../RichEditor';

/** Banc d'essai de l'éditeur (développement uniquement, sans connexion). */
export default function DevEditor() {
  const [mode, setMode] = useState<EditorMode>('dispositif'); const [md, setMd] = useState('');
  return (
    <div className="flex h-screen flex-col">
      <div className="flex gap-2 border-b p-2">{(['expose', 'visas', 'dispositif'] as const).map((m) => <button key={m} className="btn-secondary" onClick={() => { setMd(''); setMode(m); }}>{m}</button>)}</div>
      <div className="min-h-0 flex-1"><RichEditor key={mode} value={md} onChange={setMd} mode={mode} placeholder="…" /></div>
      <pre data-testid="md" className="max-h-40 overflow-auto border-t bg-slate-50 p-2 text-[12px]">{md}</pre>
    </div>
  );
}
