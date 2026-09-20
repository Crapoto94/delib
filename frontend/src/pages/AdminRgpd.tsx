import { useEffect, useState } from 'react';
import { Archive, ShieldCheck, UserX } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, Field, Loading, PageTitle, useLoad, useToast } from '../ui';

type Etat = { retention: { annees: number; mois: number; actes: string; logs: string }; actes: number; archivesIntermediaires: number; auditEntrees: number; pseudonymes: number };

export default function AdminRgpd() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const etat = useLoad(async () => (await api.get(orgPath(o, '/rgpd/etat'))).data as Etat, [o]);
  const ops = useLoad(async () => (await api.get(orgPath(o, '/rgpd/operations'))).data.items as any[], [o]);
  const pseudos = useLoad(async () => (await api.get(orgPath(o, '/rgpd/pseudonymes'))).data.items as any[], [o]);
  const [seuilActes, setSeuilActes] = useState(''); const [seuilLogs, setSeuilLogs] = useState(''); const [motif, setMotif] = useState('');
  const [resA, setResA] = useState<any>(null); const [resP, setResP] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (etat.data && !seuilActes) { setSeuilActes(etat.data.retention.actes.slice(0, 10)); setSeuilLogs(etat.data.retention.logs.slice(0, 10)); } }, [etat.data]);

  const lancer = async (type: 'archivage' | 'pseudonymisation', dryRun: boolean) => {
    const url = type === 'archivage' ? '/rgpd/archivage-intermediaire' : '/rgpd/pseudonymisation';
    const corps = type === 'archivage' ? { seuil: seuilActes || undefined, motif: motif || undefined, dryRun } : { seuil: seuilLogs || undefined, dryRun };
    if (!dryRun && !window.confirm(type === 'archivage' ? "Appliquer l'archivage intermédiaire à ces actes ?" : 'Appliquer la pseudonymisation à ces journaux ?')) return;
    setBusy(type + (dryRun ? '-a' : '-x'));
    try {
      const r = (await api.post(orgPath(o, url), corps)).data;
      if (type === 'archivage') setResA(r); else setResP(r);
      if (dryRun) toast('Aperçu calculé');
      else { toast('Opération appliquée'); etat.reload(); ops.reload(); pseudos.reload(); }
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };

  if (etat.loading && !etat.data) return <Loading />;
  return (
    <div className="space-y-6">
      <PageTitle title="RGPD" sub="Conservation des données et protection des personnes : archivage intermédiaire et pseudonymisation des actions et journaux." />

      <section className="grid gap-4 md:grid-cols-4">
        {[['Actes', etat.data?.actes ?? 0], ['Archivés (intermédiaire)', etat.data?.archivesIntermediaires ?? 0], ['Entrées d’audit', etat.data?.auditEntrees ?? 0], ['Pseudonymes', etat.data?.pseudonymes ?? 0]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><div className="text-[12px] text-mute">{l}</div><div className="text-[28px] font-bold text-primary">{v}</div></div>))}
      </section>
      <p className="text-[13px] text-mute">Durées de conservation par défaut : actes {etat.data?.retention.annees} ans, journaux {etat.data?.retention.mois} mois. Modifiables par les paramètres <code>rgpd.retention_actes_annees</code> et <code>rgpd.retention_logs_mois</code>.</p>

      <section className="card p-5">
        <div className="mb-2 flex items-center gap-2"><Archive className="h-5 w-5 text-primary" /><h3>Archivage intermédiaire</h3></div>
        <p className="mb-3 text-mute">Sort de l'usage courant les actes terminés et anciens (listes actives, recherche) <b>sans les supprimer</b> : l'acte reste conservé pour la preuve. L'opération est tracée.</p>
        <div className="grid gap-3 md:grid-cols-3 md:items-end">
          <Field label="Actes modifiés avant le"><input type="date" className="input" value={seuilActes} onChange={(e) => setSeuilActes(e.target.value)} /></Field>
          <Field label="Motif (facultatif)"><input className="input" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Conservation au-delà de la durée d'usage" /></Field>
          <div className="flex gap-2"><button className="btn-secondary" disabled={!!busy} onClick={() => lancer('archivage', true)}>Aperçu</button><button className="btn-primary" disabled={!!busy} onClick={() => lancer('archivage', false)}>Appliquer</button></div>
        </div>
        {resA && <div className="mt-3 rounded border border-line p-3 text-[13px]">
          {resA.apercu ? <>Aperçu : <b>{resA.total}</b> acte(s) concerné(s) avant le {dt(resA.seuil, { dateStyle: 'long' })}.</> : <>Terminé : <b>{resA.total}</b> acte(s) archivé(s) (seuil {dt(resA.seuil, { dateStyle: 'long' })}).</>}
          {resA.exemple?.length > 0 && <table className="mt-2 w-full"><thead><tr><th>N°</th><th>Titre</th><th>Statut</th><th>Modifié</th></tr></thead><tbody>{resA.exemple.map((x: any) => <tr key={x.id}><td>{x.numeroSuivi}</td><td>{x.titre}</td><td>{x.statut}</td><td>{dt(x.modifie)}</td></tr>)}</tbody></table>}
        </div>}
      </section>

      <section className="card p-5">
        <div className="mb-2 flex items-center gap-2"><UserX className="h-5 w-5 text-primary" /><h3>Pseudonymisation des actions et journaux</h3></div>
        <p className="mb-3 text-mute">Remplace les identités et adresses IP des entrées d'audit anciennes par des <b>pseudonymes stables</b>. Le journal d'audit reste <b>immuable</b> ; la correspondance est conservée à part, pour une ré-identification par une personne habilitée.</p>
        <div className="grid gap-3 md:grid-cols-3 md:items-end">
          <Field label="Entrées d'audit antérieures au"><input type="date" className="input" value={seuilLogs} onChange={(e) => setSeuilLogs(e.target.value)} /></Field>
          <div className="flex gap-2"><button className="btn-secondary" disabled={!!busy} onClick={() => lancer('pseudonymisation', true)}>Aperçu</button><button className="btn-primary" disabled={!!busy} onClick={() => lancer('pseudonymisation', false)}>Appliquer</button></div>
        </div>
        {resP && <div className="mt-3 rounded border border-line p-3 text-[13px]">
          {resP.apercu ? <>Aperçu : <b>{resP.entrees}</b> entrée(s), {resP.acteurs} identité(s) et {resP.ips} adresse(s) IP concernées.</> : <>Terminé : <b>{resP.entrees}</b> entrée(s) pseudonymisée(s) ({resP.acteurs} identités, {resP.ips} IP).</>}
          {resP.exemple?.length > 0 && <table className="mt-2 w-full"><thead><tr><th>Identité</th><th>Pseudonyme</th></tr></thead><tbody>{resP.exemple.map((x: any, i: number) => <tr key={i}><td>{x.original}</td><td className="font-mono">{x.pseudonyme}</td></tr>)}</tbody></table>}
        </div>}
      </section>

      <section className="card p-5">
        <h3 className="mb-3">Journal des opérations RGPD</h3>
        {ops.loading ? <Loading /> : !ops.data?.length ? <Empty>Aucune opération enregistrée.</Empty> : (
          <table className="w-full"><thead><tr><th>Date</th><th>Opération</th><th>Acteur</th><th>Seuil</th><th>Résultat</th></tr></thead><tbody>
            {ops.data.map((x: any) => <tr key={x.id}><td>{dt(x.createdAt)}</td><td><Badge tone={x.type === 'archivage_intermediaire' ? 'blue' : 'ok'}>{x.type === 'archivage_intermediaire' ? 'Archivage' : 'Pseudonymisation'}</Badge></td><td>{x.acteur}</td><td>{x.seuil ? dt(x.seuil, { dateStyle: 'long' }) : '—'}</td><td className="text-[12px]">{JSON.stringify(x.resultat)}</td></tr>)}
          </tbody></table>)}
      </section>

      <section className="card p-5">
        <div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h3>Correspondance des pseudonymes</h3></div>
        <p className="mb-3 text-[13px] text-mute">À conserver avec les mêmes précautions qu'une donnée personnelle : elle permet de ré-identifier une action pseudonymisée.</p>
        {pseudos.loading ? <Loading /> : !pseudos.data?.length ? <Empty>Aucun pseudonyme.</Empty> : (
          <table className="w-full"><thead><tr><th>Type</th><th>Valeur d'origine</th><th>Pseudonyme</th><th>Créé le</th></tr></thead><tbody>
            {pseudos.data.map((x: any, i: number) => <tr key={i}><td>{x.type}</td><td>{x.original}</td><td className="font-mono">{x.pseudonyme}</td><td>{dt(x.createdAt)}</td></tr>)}
          </tbody></table>)}
      </section>
      {node}
    </div>
  );
}
