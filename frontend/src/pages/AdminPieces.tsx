import { useState } from 'react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Field, Loading, Spinner, useLoad, useToast } from '../ui';
import { oublierPJ } from '../usePJ';

/**
 * Paramétrage « Pièces jointes » : taille maximale d'un fichier joint à un dossier (annexes PDF) ou à un
 * dossier simple de l'ordre du jour. Défaut 30 Mo, borné par le plafond technique du serveur (`MAX_UPLOAD_MB`).
 */
export default function AdminPieces() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/fichiers/limite'))).data as { tailleMaxMo: number; defautMo: number; maximumMo: number }, [o]);
  const [val, setVal] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (d.loading && !d.data) return <Loading />;
  const info = d.data!;
  const cur = val ?? String(info.tailleMaxMo);
  const save = async () => {
    setBusy(true);
    try { await api.put(orgPath(o, '/settings/fichiers.taille_max_mo'), { value: Number(cur), scope: 'organisme' }); oublierPJ(); toast('Limite enregistrée'); setVal(null); d.reload(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { await api.delete(orgPath(o, '/settings/fichiers.taille_max_mo'), { params: { scope: 'organisme' } }); oublierPJ(); toast(`Valeur par défaut rétablie (${info.defautMo} Mo)`); setVal(null); d.reload(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h3 className="mb-1">Pièces jointes</h3>
        <p className="mb-4 text-[13px] text-mute">Taille maximale d'un fichier joint à un dossier (annexes PDF) ou à un dossier simple de l'ordre du jour. Ce réglage autorise les pièces plus lourdes (plans, rapports scannés, tableaux financiers…).</p>
        <Field label="Taille maximale d'un fichier (Mo)" hint={`Entre 1 et ${info.maximumMo} Mo (plafond technique du serveur, variable MAX_UPLOAD_MB). Valeur par défaut : ${info.defautMo} Mo.`}>
          <input className="input w-40" type="number" min={1} max={info.maximumMo} value={cur} onChange={(e) => setVal(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" disabled={busy || val === null} onClick={reset}>Rétablir {info.defautMo} Mo</button>
          <button className="btn-primary" disabled={busy || val === null} onClick={save}>{busy && <Spinner />} Enregistrer</button>
        </div>
      </section>{node}
    </div>
  );
}
