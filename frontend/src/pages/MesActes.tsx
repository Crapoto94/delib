import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, MessageSquare, RotateCcw } from 'lucide-react';
import { api, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { AgentName } from '../AgentName';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Loading, PageTitle, StatutBadge, useLoad } from '../ui';

const ROLES: [string, string][] = [['', 'Tous mes rôles'], ['redacteur', 'Rédacteur'], ['co_redacteur', 'Co-rédacteur'], ['valideur', 'Valideur'], ['remplacant', 'Remplaçant'], ['commentateur', 'Commentaire'], ['participant', 'Dans le circuit']];
const TYPE_TONE: Record<string, string> = { creation: 'bg-slate-400', etape: 'bg-action-solid', validation: 'bg-ok-solid', refus: 'bg-ko-solid', commentaire: 'bg-slate-500', vote: 'bg-primary', amendement: 'bg-warn-solid', transmission: 'bg-action-solid', ar: 'bg-ok-solid' };

/** Le trajet de mes actes (REC-31) : les dossiers pour lesquels j'ai eu un rôle à un moment, tous statuts, même après la clôture. */
export default function MesActes() {
  const { id } = useParams();
  return id ? <Trajet acteId={Number(id)} /> : <Liste />;
}

function Liste() {
  const { org } = useAuth(); const o = org!.id;
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [annee, setAnnee] = useState('');
  const d = useLoad(async () => (await api.get(orgPath(o, '/mes-actes'), { params: { q: q || undefined, role: role || undefined, annee: annee || undefined, limit: 100 } })).data, [o, q, role, annee]);
  const ans = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  return (
    <div>
      <PageTitle title="Mes actes" sub="Les dossiers pour lesquels j’ai eu un rôle à un moment (rédaction, validation, remplacement, commentaire), avec leur trajet complet — circuit, modifications, amendements. Pour les délibérations de la collectivité, voir la Bibliothèque." />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <input className="input max-w-xs" placeholder="Titre ou n° de suivi…" aria-label="Rechercher dans mes actes" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" aria-label="Mon rôle" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input w-auto" aria-label="Année de création" value={annee} onChange={(e) => setAnnee(e.target.value)}><option value="">Toutes les années</option>{ans.map((a) => <option key={a} value={a}>{a}</option>)}</select>
      </div>
      {d.loading && !d.data ? <Loading /> : !d.data ? <ErrorBox msg={d.error} /> : !d.data.items.length ? <div className="card"><Empty>Aucun acte ne correspond.</Empty></div> : (
        <div className="card overflow-x-auto"><table className="w-full"><thead><tr><th>Dossier</th><th>Mes rôles</th><th>Statut</th><th>Séance</th><th /></tr></thead><tbody>{d.data.items.map((a: any) => (
          <tr key={a.acteId}><td><b>{a.titre}</b><div className="text-[12px] text-mute">n° {a.numeroSuivi} · créé le {dt(a.creeLe, { dateStyle: 'short' })}</div></td>
            <td className="space-x-1">{a.roles.map((r: any) => <Badge key={r.code} tone="blue">{r.label}</Badge>)}</td>
            <td><StatutBadge statut={a.statut} />{a.resultatLabel && <div className="mt-1 text-[11px] text-mute">{a.resultatLabel}</div>}</td>
            <td className="text-[12px]">{a.dateSeance ? dt(a.dateSeance, { dateStyle: 'medium' }) : '—'}</td>
            <td className="text-right"><Link className="btn-secondary !py-1" to={`/mes-actes/${a.acteId}`}>Voir le trajet</Link></td></tr>))}</tbody></table></div>)}
    </div>
  );
}

function Trajet({ acteId }: { acteId: number }) {
  const { org } = useAuth(); const o = org!.id;
  const d = useLoad(async () => (await api.get(orgPath(o, `/mes-actes/${acteId}`))).data, [o, acteId]);
  if (d.loading) return <Loading />;
  if (!d.data) return <div><Link to="/mes-actes" className="text-[12px] text-mute hover:underline">← Mes actes</Link><ErrorBox msg={d.error} /></div>;
  const t = d.data; const a = t.acte;
  return (
    <div className="space-y-4">
      <div className="text-[12px] text-mute"><Link to="/mes-actes" className="hover:underline">← Mes actes</Link></div>
      <PageTitle title={a.titre} sub={<span>Dossier n° {a.numeroSuivi} · {a.direction ?? '—'} · rédigé par <AgentName u={a.redacteur} /> · <StatutBadge statut={a.statut} /> · mes rôles : {t.roles.map((r: any) => r.label).join(', ')}</span>} />

      <section className="card p-4"><h3 className="mb-3">Le circuit qu’a eu ce dossier</h3>
        {!t.circuit.length ? <p className="text-mute">Ce dossier n’est jamais entré en circuit.</p> : (
          <ol className="flex gap-2 overflow-x-auto pb-2">{t.circuit.map((c: any) => {
            const refus = c.decision === 'refus' || c.statut === 'returned'; const fait = c.statut === 'done' || c.statut === 'skipped';
            return (
              <li key={c.id} className={`min-w-[170px] flex-1 rounded-lg border p-3 ${refus ? 'border-ko/40 bg-ko-bg' : c.statut === 'current' ? 'border-primary bg-primary text-white' : 'border-ok/30 bg-surface'}`}>
                <div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${refus ? 'bg-ko-solid' : fait ? 'bg-ok-solid' : 'bg-action-solid'}`}>{refus ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}</span><span className="truncate text-[12px] font-bold">{c.label}</span></div>
                <div className={`mt-1 text-[11px] ${c.statut === 'current' ? 'text-white/80' : 'text-mute'}`}>{c.par ? <><AgentName u={c.par} />{c.pour && <> (pour <AgentName u={c.pour} />)</>}</> : c.statut === 'skipped' ? 'étape ignorée' : '—'}{c.tour > 1 && ` · tour ${c.tour}`}</div>
                <div className={`text-[11px] ${c.statut === 'current' ? 'text-white/80' : 'text-mute'}`}>{c.agiLe ? dt(c.agiLe, { dateStyle: 'short', timeStyle: 'short' }) : c.arriveLe ? `arrivé le ${dt(c.arriveLe, { dateStyle: 'short' })}` : ''}</div>
                {c.commentaire && <div className="mt-1 text-[11px] italic">« {c.commentaire} »</div>}
              </li>);
          })}</ol>)}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4"><h3 className="mb-2">En séance</h3>
          {t.vote.length ? t.vote.map((v: any, i: number) => (
            <p key={i} className="text-[13px]"><b>{v.seance}</b> du {dt(v.dateSeance, { dateStyle: 'long' })}{v.numero ? ` · point ${v.numero}` : ''} : {v.resultatLabel ? <Badge tone={v.resultat?.startsWith('adopte') ? 'ok' : 'ko'}>{v.resultatLabel}</Badge> : 'sans vote'}{v.pour !== null && <span className="text-mute"> — {v.pour} pour, {v.contre} contre, {v.abstention} abst.</span>}</p>)) : <p className="text-mute">Pas encore passé en séance.</p>}
          <h4 className="mb-1 mt-3 text-[13px] font-bold">Amendements</h4>
          {!t.amendements.length ? <p className="text-[13px] text-mute">Aucun amendement.</p> : (
            <ul className="space-y-2">{t.amendements.map((m: any) => (
              <li key={m.numero} className="rounded border border-line p-2 text-[13px]"><b>n° {m.numero}</b> de {m.auteur} — {m.cible} <Badge tone={m.statut === 'adopte' ? 'ok' : m.statut === 'rejete' ? 'ko' : 'gray'}>{m.statut}</Badge>{m.motif && <div className="text-[12px] italic text-mute">{m.motif}</div>}
                {m.statut === 'adopte' && m.avant && <details className="mt-1 text-[12px]"><summary className="cursor-pointer text-action">Voir avant / après</summary><div className="mt-1 grid gap-2 md:grid-cols-2"><div><b>Avant</b><p className="whitespace-pre-wrap text-mute">{m.avant}</p></div><div><b>Après</b><p className="whitespace-pre-wrap">{m.propose}</p></div></div></details>}</li>))}</ul>)}
        </section>
        <section className="card p-4"><h3 className="mb-2">Après la séance et modifications</h3>
          {t.transmissions.length ? t.transmissions.map((x: any, i: number) => <p key={i} className="text-[13px]">Transmission <span className="font-mono">{x.numero}</span> — {x.statut ?? x.etat}{x.arLe && <> · AR le {dt(x.arLe, { dateStyle: 'medium' })}</>}</p>) : <p className="text-mute">Aucune transmission au contrôle de légalité.</p>}
          <p className="mt-3 text-[13px]"><b>{t.modifications.versions}</b> version(s) des textes, par {t.modifications.auteurs.map((u: string) => <span key={u}><AgentName u={u} />{' '}</span>)}</p>
          <Link className="mt-2 inline-block text-[13px] font-semibold text-action" to={`/dossiers/${a.id}`}>Ouvrir le dossier</Link>
        </section>
      </div>

      <section className="card p-4"><h3 className="mb-3">Chronologie</h3>
        <ol className="relative space-y-2 border-l border-line pl-5">{t.chronologie.map((c: any, i: number) => (
          <li key={i} className="relative text-[13px]"><span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${TYPE_TONE[c.type] ?? 'bg-slate-400'}`} /><span className="mr-2 font-mono text-[11px] text-mute">{dt(c.le, { dateStyle: 'short', timeStyle: 'short' })}</span>{c.type === 'commentaire' && <MessageSquare className="mr-1 inline h-3 w-3 text-mute" />}{c.texte}</li>))}</ol>
      </section>
    </div>
  );
}
