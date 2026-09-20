import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, Loading, PageTitle, useLoad, useToast } from '../ui';
import { Select } from '../Select';

type Regle = { code: string; nom: string; family: string; familyLabel: string; kind: string; mail: boolean; mode: 'immediate' | 'inapp' | 'off' };

export default function Preferences() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const prefs = useLoad(async () => (await api.get(orgPath(o, '/notifications/preferences'))).data as { items: any[]; regles: Regle[] }, [o]);
  const set = async (family: string, mode: string) => { try { await api.put(orgPath(o, '/notifications/preferences'), { family, mode }); toast('Préférence enregistrée'); prefs.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const setRegle = async (code: string, mode: string) => { try { await api.put(orgPath(o, `/notifications/preferences/regles/${code}`), { mode }); toast('Préférence enregistrée'); prefs.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  // regroupement des notifications facultatives par famille
  const parFamille = new Map<string, Regle[]>();
  for (const r of prefs.data?.regles ?? []) parFamille.set(r.familyLabel, [...(parFamille.get(r.familyLabel) ?? []), r]);
  return (
    <div className="space-y-6">
      <PageTitle title="Mes notifications" sub="Choisissez comment être prévenu(e). Les alertes obligatoires (actes à valider, relances de validation…) ne peuvent pas être désactivées." />
      <div className="card">{prefs.loading || !prefs.data ? <Loading /> : (
        <table className="w-full"><thead><tr><th>Famille</th><th>Mode</th></tr></thead><tbody>{prefs.data.items.map((p) => (
          <tr key={p.family}><td className="font-semibold">{p.label} {p.mandatory && <Badge tone="warn">obligatoire</Badge>}</td>
            <td><Select className="input w-56" disabled={p.mandatory} value={p.mode} onChange={(e) => set(p.family, e.target.value)}><option value="immediate">Immédiat</option><option value="digest">Dans la synthèse quotidienne</option><option value="off">Désactivé</option></Select></td></tr>))}</tbody></table>)}</div>

      {prefs.data && parFamille.size > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3>Notifications facultatives, une par une</h3>
            <p className="mt-1 text-[13px] text-mute">Pour chaque notification non obligatoire, vous pouvez ne <b>pas la recevoir</b>, ou ne la recevoir que <b>dans l’outil</b> (cloche) sans e-mail. Ce choix s’ajoute au choix par famille ci-dessus et ne concerne que vous.</p></div>
          {[...parFamille.entries()].map(([famille, rules]) => (
            <div key={famille}>
              <div className="bg-soft px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">{famille}</div>
              <ul>{rules.map((r) => (
                <li key={r.code} className="flex flex-wrap items-center gap-3 border-t border-line/60 px-4 py-2">
                  <div className="min-w-[240px] flex-1"><span className="text-[13px] font-semibold">{r.nom}</span>
                    <span className="ml-2 text-[11px] text-mute">{r.kind === 'temporal' ? 'relance' : 'évènement'}{!r.mail && ' · l’administration l’envoie dans l’outil seulement'}</span></div>
                  <Select className="input w-64" value={r.mode} aria-label={r.nom} onChange={(e) => setRegle(r.code, e.target.value)}>
                    <option value="immediate">{r.mail ? 'La recevoir (e-mail et outil)' : 'La recevoir (dans l’outil)'}</option>
                    {r.mail && <option value="inapp">Dans l’outil seulement (pas de mail)</option>}
                    <option value="off">Ne pas la recevoir</option>
                  </Select>
                </li>))}</ul>
            </div>))}
        </div>)}
      {node}
    </div>
  );
}
