import { FormEvent, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

/** Création ou modification d'un élu / membre (ELU-80). Les élus issus du Hub : identité en lecture seule, groupe, mandat et mobile modifiables. */
function EluForm({ elu, groupes, onClose, onSaved }: { elu: any | null; groupes: any[]; onClose: () => void; onSaved: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const hub = elu?.source === 'hub';
  const [f, setF] = useState<any>({
    nom: elu?.nom ?? '', prenom: elu?.prenom ?? '', email: elu?.email ?? '', mobile: elu?.mobileLocal ?? (elu?.source === 'manual' ? elu?.mobile ?? '' : ''), role: elu?.role ?? '',
    estElu: elu?.estElu ?? true, groupeId: elu?.groupeId ?? '', mandatDebut: elu?.mandatDebut?.slice(0, 10) ?? '', mandatFin: elu?.mandatFin?.slice(0, 10) ?? '',
  });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const enregistrer = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const commun = { mobile: f.mobile || null, groupeId: f.groupeId === '' ? null : Number(f.groupeId), mandatDebut: f.mandatDebut || null, mandatFin: f.mandatFin || null };
    try {
      if (!elu) await api.post(orgPath(o, '/elus'), { nom: f.nom, prenom: f.prenom || undefined, email: f.email || undefined, role: f.role || undefined, estElu: f.estElu, ...commun, mobile: f.mobile || undefined, groupeId: commun.groupeId, mandatDebut: commun.mandatDebut, mandatFin: commun.mandatFin });
      else await api.put(orgPath(o, `/elus/${elu.id}`), hub ? commun : { nom: f.nom, prenom: f.prenom, email: f.email || undefined, role: f.role || undefined, estElu: f.estElu, ...commun });
      onSaved();
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  return (
    <Modal title={elu ? `Modifier ${elu.nomComplet}` : 'Nouvel élu ou membre'} onClose={onClose}>
      <form onSubmit={enregistrer} className="space-y-3">
        <ErrorBox msg={err} />
        {hub && <p className="rounded bg-soft px-3 py-2 text-[13px] text-mute">Élu issu du <b>Hub DSI</b> : son identité n’est pas modifiable ici. Son groupe, son mandat et son <b>mobile</b> (pour le code SMS) se saisissent ici et ne sont jamais écrasés par la synchronisation.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nom *"><input className="input" required disabled={hub} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
          <Field label="Prénom"><input className="input" disabled={hub} value={f.prenom} onChange={(e) => setF({ ...f, prenom: e.target.value })} /></Field>
          <Field label="Courriel" hint="Sert d’identifiant de connexion à l’espace des élus."><input className="input" type="email" disabled={hub} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Mobile" hint="Pour le code SMS « mot de passe oublié » (06…, 07… ou +33…)."><input className="input" type="tel" autoComplete="off" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder={hub && elu?.mobile ? `Hub : ${elu.mobile}` : '06 12 34 56 78'} /></Field>
          <Field label="Rôle / fonction"><input className="input" disabled={hub} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Adjoint(e), conseiller(ère)…" /></Field>
          <Field label="Qualité"><Select className="input" disabled={hub} value={f.estElu ? 'elu' : 'non'} onChange={(e) => setF({ ...f, estElu: e.target.value === 'elu' })}><option value="elu">Élu</option><option value="non">Membre non élu (personne qualifiée…)</option></Select></Field>
          <Field label="Groupe politique"><Select className="input" value={f.groupeId} onChange={(e) => setF({ ...f, groupeId: e.target.value })}><option value="">Non inscrit</option>{groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Mandat : début"><input className="input" type="date" value={f.mandatDebut} onChange={(e) => setF({ ...f, mandatDebut: e.target.value })} /></Field>
            <Field label="Fin"><input className="input" type="date" value={f.mandatFin} onChange={(e) => setF({ ...f, mandatFin: e.target.value })} /></Field></div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !f.nom}>{busy && <Spinner />} Enregistrer</button></div>
      </form>
    </Modal>
  );
}

/** Élus et membres de l'organisme (ELU-80 à ELU-82) : création à la main, modification, désactivation persistante, suppression prudente. */
export default function AdminMembres() {
  const { org, isAdmin } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const [statut, setStatut] = useState<'true' | 'false' | 'all'>('true'); const [q, setQ] = useState('');
  const list = useLoad(async () => (await api.get(orgPath(o, '/elus'), { params: { actif: statut, q: q || undefined } })).data.items as any[], [o, statut, q]);
  const groupes = useLoad(async () => (await api.get(orgPath(o, '/groupes-politiques'))).data.items as any[], [o]);
  const [edit, setEdit] = useState<any | 'nouveau' | null>(null);
  const items = useMemo(() => list.data ?? [], [list.data]);

  const sync = async () => { try { const r = (await api.post(orgPath(o, '/elus/synchronisation'))).data; toast(`Hub : ${r.created} nouveau(x), ${r.updated} mis à jour, ${r.deactivated} désactivé(s)`); list.reload(); } catch (x) { toast(errMsg(x), 'ko'); } };
  const basculer = async (e: any) => {
    if (e.actif && !window.confirm(`Désactiver ${e.nomComplet} ? Il ne figurera plus dans les séances ni dans l’espace des élus, et restera désactivé même après une synchronisation avec le Hub.`)) return;
    try { await api.put(orgPath(o, `/elus/${e.id}`), { actif: !e.actif }); toast(e.actif ? 'Élu désactivé (définitivement, jusqu’à réactivation manuelle)' : 'Élu réactivé'); list.reload(); } catch (x) { toast(errMsg(x), 'ko'); }
  };
  const supprimer = async (e: any) => {
    if (!window.confirm(`Supprimer définitivement ${e.nomComplet} ?`)) return;
    try { await api.delete(orgPath(o, `/elus/${e.id}`)); toast('Élu supprimé'); list.reload(); } catch (x) { toast(errMsg(x), 'ko'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <button className="btn-primary" onClick={() => setEdit('nouveau')}><Plus className="h-4 w-4" /> Nouvel élu ou membre</button>
        <button className="btn-secondary" onClick={sync}><RefreshCw className="h-3.5 w-3.5" /> Synchroniser avec le Hub</button>
        <label className="ml-auto"><span className="label">Afficher</span><Select className="input !w-auto" value={statut} onChange={(e) => setStatut(e.target.value as any)}><option value="true">Actifs</option><option value="false">Désactivés</option><option value="all">Tous</option></Select></label>
        <label><span className="label">Recherche</span><input className="input" value={q} placeholder="Nom, prénom, courriel" onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <p className="text-[13px] text-mute">Les élus du Hub DSI se synchronisent ; les <b>membres non élus</b> (CCAS, personnes qualifiées) et les élus d’un autre organisme se saisissent à la main. <b>Un élu désactivé le reste</b>, même après une synchronisation.</p>
      <div className="card overflow-x-auto">
        {list.loading && !list.data ? <Loading /> : list.error ? <div className="p-4"><ErrorBox msg={list.error} /></div> : !items.length ? <Empty>Aucun élu ne correspond.</Empty> : (
          <table className="w-full"><thead><tr><th>Nom</th><th>Rôle</th><th>Groupe</th><th>Courriel</th><th>Mobile</th><th>Source</th><th>État</th><th /></tr></thead><tbody>
            {items.map((e) => (
              <tr key={e.id} className={e.actif ? '' : 'opacity-60'}>
                <td className="font-semibold">{e.nomComplet}{!e.estElu && <span className="ml-1 text-[11px] font-normal text-mute">(non élu)</span>}</td><td>{e.role}</td><td>{e.groupe || '—'}</td><td className="text-[12px]">{e.email}</td>
                <td className="whitespace-nowrap text-[12px]">{e.mobile ? <>{e.mobile}{e.mobileLocal && e.source === 'hub' && <span className="text-mute"> (local)</span>}</> : <span className="text-warn">absent</span>}</td>
                <td><Badge tone={e.source === 'hub' ? 'blue' : 'gray'}>{e.source === 'hub' ? 'Hub' : 'Saisie'}</Badge></td>
                <td>{e.actif ? <Badge tone="ok">Actif</Badge> : <Badge tone="ko">{e.desactiveManuellement ? 'Désactivé (manuel)' : 'Désactivé'}</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="rounded p-2 hover:bg-slate-100" aria-label={`Modifier ${e.nomComplet}`} onClick={() => setEdit(e)}><Pencil className="h-4 w-4" /></button>
                  <button className="rounded px-2 py-1 text-[12px] font-semibold text-action hover:bg-slate-100" onClick={() => basculer(e)}>{e.actif ? 'Désactiver' : 'Réactiver'}</button>
                  {isAdmin && e.source !== 'hub' && <button className="rounded p-2 text-ko hover:bg-slate-100" aria-label={`Supprimer ${e.nomComplet}`} onClick={() => supprimer(e)}><Trash2 className="h-4 w-4" /></button>}
                </td>
              </tr>))}
          </tbody></table>)}
      </div>
      {edit && <EluForm elu={edit === 'nouveau' ? null : edit} groupes={groupes.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); toast('Enregistré'); }} />}
      {node}
    </div>
  );
}
