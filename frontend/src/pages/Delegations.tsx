import { FormEvent, useState } from 'react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { d } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, PageTitle, useLoad, useToast } from '../ui';

export default function Delegations() {
  const { org, me } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const list = useLoad(async () => (await api.get(orgPath(o, '/delegations'))).data.items as any[], [o]);
  const [delegue, setDelegue] = useState(''); const [fin, setFin] = useState(''); const [err, setErr] = useState<string | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.post(orgPath(o, '/delegations'), { delegue: delegue.trim().toLowerCase(), scope: 'all', endsAt: fin ? new Date(fin + 'T23:59:59').toISOString() : undefined }); setDelegue(''); setFin(''); toast('Délégation créée'); list.reload(); } catch (x) { setErr(errMsg(x)); }
  };
  const revoke = async (id: number) => { try { await api.delete(orgPath(o, `/delegations/${id}`)); toast('Délégation révoquée'); list.reload(); } catch (x) { toast(errMsg(x), 'ko'); } };
  return (
    <div className="space-y-6">
      <PageTitle title="Mes délégations" sub="Déléguez vos validations quand vous vous absentez. Vous gardez vos droits (co-détention)." />
      <form onSubmit={create} className="card grid gap-4 p-5 md:grid-cols-[1fr_200px_auto] md:items-end">
        <ErrorBox msg={err} />
        <Field label="Je délègue toutes mes validations à (identifiant)"><input className="input" required value={delegue} onChange={(e) => setDelegue(e.target.value)} placeholder="ex. cmoreau" /></Field>
        <Field label="Jusqu'au (facultatif)"><input className="input" type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
        <button className="btn-primary">Déléguer</button>
      </form>
      <div className="card">{list.loading ? <Loading /> : !list.data?.length ? <Empty>Aucune délégation.</Empty> : (
        <table className="w-full"><thead><tr><th>De</th><th>À</th><th>Portée</th><th>Période</th><th /></tr></thead><tbody>{list.data.map((x) => (
          <tr key={x.id}><td>{x.delegant}{x.delegant === me?.username && <Badge tone="blue"> vous</Badge>}</td><td>{x.delegue}{x.delegue === me?.username && <Badge tone="blue"> vous</Badge>}</td><td>{x.scope}{x.scopeValue ? ` : ${x.scopeValue}` : ''}</td>
            <td>{d(x.startsAt)} → {x.endsAt ? d(x.endsAt) : 'révocation'}</td><td className="text-right">{x.active ? <button className="btn-ko" onClick={() => revoke(x.id)}>Révoquer</button> : <Badge>{x.revokedAt ? 'révoquée' : 'échue'}</Badge>}</td></tr>))}</tbody></table>)}</div>
      {node}
    </div>
  );
}
