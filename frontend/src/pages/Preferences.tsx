import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, Loading, PageTitle, useLoad, useToast } from '../ui';

export default function Preferences() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const prefs = useLoad(async () => (await api.get(orgPath(o, '/notifications/preferences'))).data.items as any[], [o]);
  const set = async (family: string, mode: string) => { try { await api.put(orgPath(o, '/notifications/preferences'), { family, mode }); toast('Préférence enregistrée'); prefs.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  return (
    <div>
      <PageTitle title="Mes notifications" sub="Choisissez comment être prévenu(e). Les alertes obligatoires (actes à valider) ne peuvent pas être désactivées." />
      <div className="card">{prefs.loading ? <Loading /> : (
        <table className="w-full"><thead><tr><th>Famille</th><th>Mode</th></tr></thead><tbody>{prefs.data?.map((p) => (
          <tr key={p.family}><td className="font-semibold">{p.label} {p.mandatory && <Badge tone="warn">obligatoire</Badge>}</td>
            <td><select className="input w-56" disabled={p.mandatory} value={p.mode} onChange={(e) => set(p.family, e.target.value)}><option value="immediate">Immédiat</option><option value="digest">Dans la synthèse quotidienne</option><option value="off">Désactivé</option></select></td></tr>))}</tbody></table>)}</div>
      {node}
    </div>
  );
}
