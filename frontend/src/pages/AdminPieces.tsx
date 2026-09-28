import { useState } from 'react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Field, Loading, Spinner, useLoad, useToast } from '../ui';
import { oublierPJ } from '../usePJ';
import { useBureau } from '../Bureau';

/**
 * Paramétrage « Pièces jointes » : taille maximale d'un fichier joint à un dossier (annexes PDF) ou à un
 * dossier simple de l'ordre du jour. Défaut 30 Mo, borné par le plafond technique du serveur (`MAX_UPLOAD_MB`),
 * et édition en ligne des annexes Word / Excel / présentation dans le navigateur (bureau en ligne), avec le choix
 * du moteur de documents — ONLYOFFICE ou Collabora — pour l'organisme.
 *
 * On y choisit aussi, texte par texte (exposé, « Vu et considérant », délibéré), l'éditeur de rédaction : l'éditeur de
 * l'outil ou le bureau en ligne. Le réglage est porté par l'organisme (`redaction.editeur_<kind>`).
 */

const LIBELLES_MOTEURS: Record<string, string> = {
  onlyoffice: 'ONLYOFFICE Docs',
  collabora: 'Collabora Online',
};

/** Les textes dont on peut choisir l'éditeur (interne à l'outil, ou bureau en ligne). */
const TEXTES_EDITABLES: { kind: string; label: string }[] = [
  { kind: 'expose', label: 'Exposé des motifs' },
  { kind: 'visas', label: 'Vu et considérant' },
  { kind: 'dispositif', label: 'Délibéré' },
];

export default function AdminPieces() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/fichiers/limite'))).data as { tailleMaxMo: number; defautMo: number; maximumMo: number }, [o]);
  const bureau = useBureau(o);
  const reglage = useLoad(async () => (await api.get(orgPath(o, '/settings'))).data.settings as Record<string, { value?: unknown }>, [o]);
  const [val, setVal] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (d.loading && !d.data) return <Loading />;
  const info = d.data!;
  const cur = val ?? String(info.tailleMaxMo);
  const bureauOn = reglage.data?.['bureau.edition_documents']?.value !== false;
  const basculerBureau = async (v: boolean) => {
    try { await api.put(orgPath(o, '/settings/bureau.edition_documents'), { value: v, scope: 'organisme' }); reglage.reload(); toast(v ? 'Édition en ligne activée' : 'Édition en ligne désactivée (dépôt manuel conservé)'); }
    catch (e) { toast(errMsg(e), 'ko'); }
  };
  // Moteur du `.env` tant qu'aucun choix n'est fait pour l'organisme : « inheritant » = moteur général de l'instance.
  const INHERITANT = 'auto';
  const moteurChoisi = String(reglage.data?.['bureau.moteur']?.value || INHERITANT);
  const moteursDeployes = bureau?.moteurs?.length ? bureau.moteurs : (bureau?.moteur ? [bureau.moteur] : []);
  const changerMoteur = async (v: string) => {
    try {
      if (v === INHERITANT) await api.delete(orgPath(o, '/settings/bureau.moteur'), { params: { scope: 'organisme' } });
      else await api.put(orgPath(o, '/settings/bureau.moteur'), { value: v, scope: 'organisme' });
      reglage.reload();
      toast('Moteur d’édition enregistré');
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  // Éditeur d'un texte : « interne » (éditeur de l'outil) ou « externe » (bureau en ligne, Word / ONLYOFFICE / Collabora).
  const editeurDe = (kind: string) => String(reglage.data?.[`redaction.editeur_${kind}`]?.value || 'interne');
  const changerEditeur = async (kind: string, v: string) => {
    try { await api.put(orgPath(o, `/settings/redaction.editeur_${kind}`), { value: v, scope: 'organisme' }); reglage.reload(); toast(v === 'externe' ? 'Texte confié au bureau en ligne' : "Texte rendu à l'éditeur de l'outil"); }
    catch (e) { toast(errMsg(e), 'ko'); }
  };
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
      </section>

      <section className="card p-5">
        <h3 className="mb-1">Édition en ligne des pièces jointes</h3>
        {bureau?.enabled ? (
          <>
            <p className="mb-4 text-[13px] text-mute">Un agent peut ouvrir une annexe Word, Excel ou présentation directement dans le navigateur, sans Word sur son poste, et chaque enregistrement devient une nouvelle version de la pièce. Formats acceptés par le serveur de documents : {(bureau.formats || []).join(', ')}.</p>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={bureauOn} onChange={(e) => basculerBureau(e.target.checked)} />
              <span>Autoriser l'édition en ligne pour cet organisme{!bureauOn && <em className="block text-[12px] text-mute">Les agents continueront de déposer leurs fichiers ; rien n'est perdu à la désactivation.</em>}</span>
            </label>
            {moteursDeployes.length > 1 && (
              <div className="mt-4 border-t border-line pt-4">
                <Field label="Serveur de documents" hint="Les deux moteurs savent éditer les mêmes formats et produisent le même circuit de version. Ils diffèrent sur le rendu : ONLYOFFICE convertit aussi en PDF, Collabora s'appuie sur LibreOffice. Le choix ne concerne que cet organisme.">
                  <select className="input w-72" value={moteurChoisi} onChange={(e) => changerMoteur(e.target.value)}>
                    <option value={INHERITANT}>Moteur de l’instance ({LIBELLES_MOTEURS[bureau.moteur || ''] || bureau.moteur})</option>
                    {moteursDeployes.map((m) => <option key={m} value={m}>{LIBELLES_MOTEURS[m] || m}</option>)}
                  </select>
                </Field>
                <p className="text-[12px] text-mute">Moteur actuellement utilisé par cet organisme : <strong>{LIBELLES_MOTEURS[moteurChoisi === INHERITANT ? (bureau.moteur || '') : moteurChoisi] || moteurChoisi}</strong>.</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-[13px] text-mute">Aucun serveur de documents n'est déployé sur cette instance : le dépôt de fichiers et la conversion en PDF fonctionnent comme d'habitude.{bureau?.raison ? ` (${bureau.raison})` : ''}</p>
        )}
      </section>

      <section className="card p-5">
        <h3 className="mb-1">Rédaction des textes : éditeur de l'outil ou bureau en ligne</h3>
        <p className="mb-4 text-[13px] text-mute">Choisissez, texte par texte, l'éditeur utilisé pour la rédaction. L'<b>éditeur de l'outil</b> offre la mise en forme simple et le suivi des modifications ; le <b>bureau en ligne</b> ouvre le texte dans un document Word (ONLYOFFICE ou Collabora) et réimporte chaque enregistrement comme une nouvelle version du texte. Le suivi des modifications et l'historique sont conservés dans les deux cas.</p>
        {!bureau?.enabled ? (
          <p className="text-[13px] text-mute">Aucun serveur de documents n'est disponible pour cet organisme : l'éditeur de l'outil est utilisé pour tous les textes.{bureau?.raison ? ` (${bureau.raison})` : ''}</p>
        ) : (
          <div className="space-y-3">
            {TEXTES_EDITABLES.map(({ kind, label }) => (
              <Field key={kind} label={label} hint={kind === 'dispositif' ? "Pour une décision ou un arrêté, ce texte est le « Décide »." : undefined}>
                <select className="input w-80" value={editeurDe(kind)} onChange={(e) => changerEditeur(kind, e.target.value)}>
                  <option value="interne">Éditeur de l'outil</option>
                  <option value="externe">Bureau en ligne ({LIBELLES_MOTEURS[bureau.moteur || ''] || bureau.moteur})</option>
                </select>
              </Field>
            ))}
          </div>
        )}
      </section>{node}
    </div>
  );
}
