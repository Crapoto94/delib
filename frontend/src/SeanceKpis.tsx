import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, CalendarClock, CheckCircle2, ClipboardList, Users2 } from 'lucide-react';
import { api, org as orgPath } from './api';
import { useAuth } from './auth';
import { dt } from './format';
import { Badge, Loading } from './ui';
import { AgentNames } from './AgentName';

type Item = { acteId: number; numeroSuivi: number; numero: string | null; titre: string; etat: 'pret' | 'en_circuit' | 'a_corriger' | 'brouillon'; direction: string; etape: string | null; holders: string[]; echeance: string | null; enRetard: boolean; motifRetard: string | null; dansOdj: boolean };
type Kpis = {
  seance: { id: number; dateSeance: string };
  compteARebours: { jours: number; date: string; prochainJalon: { label: string; date: string; jours: number } | null; jalons: { code: string; label: string; date: string; passe: boolean; jours: number }[] };
  avancement: { total: number; prets: number; enCircuit: number; aCorriger: number; brouillons: number; dansOdj: number; tauxRealisation: number };
  aTerminer: { total: number; enRetard: number; items: Item[] };
  directions: { enRetard: number; items: { code: string; direction: string; total: number; prets: number; aTerminer: number; enRetard: number }[] };
  commissions: { id: number; nom: string; prevus: number; termines: number; tauxRealisation: number; restants: Item[]; prochaineReunion: { date: string; jours: number } | null }[];
};
type Detail = { kind: 'actes' } | { kind: 'directions' } | { kind: 'commission'; id: number };

const ETAT: Record<string, { label: string; bar: string; tone?: 'ok' | 'warn' | 'blue' }> = {
  pret: { label: 'Terminé', bar: 'bg-emerald-500', tone: 'ok' }, en_circuit: { label: 'En validation', bar: 'bg-sky-500', tone: 'blue' },
  a_corriger: { label: 'À corriger', bar: 'bg-amber-500', tone: 'warn' }, brouillon: { label: 'En rédaction', bar: 'bg-slate-400' },
};
/** « J-12 », « Aujourd'hui », « J+3 » (dépassé). */
const cd = (j: number) => (j === 0 ? "Aujourd'hui" : j > 0 ? `J-${j}` : `J+${-j}`);

function Card({ icon, title, value, sub, tone, onClick, active }: { icon: ReactNode; title: string; value: ReactNode; sub?: ReactNode; tone?: 'ko' | 'ok' | 'warn'; onClick?: () => void; active?: boolean }) {
  const cls = `card p-4 text-left ${onClick ? 'cursor-pointer transition hover:shadow-float' : ''} ${active ? 'ring-2 ring-action' : ''}`;
  const body = (<>
    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-mute">{icon}{title}</div>
    <div className={`mt-1 text-[28px] font-bold leading-tight ${tone === 'ko' ? 'text-ko' : tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-head'}`}>{value}</div>
    {sub && <div className="mt-1 text-[12px] text-mute">{sub}</div>}
    {onClick && <div className="mt-2 text-[11px] font-semibold text-action">{active ? 'Masquer le détail' : 'Voir le détail'}</div>}
  </>);
  return onClick ? <button type="button" className={cls} onClick={onClick} aria-expanded={active}>{body}</button> : <div className={cls}>{body}</div>;
}

const Bar = ({ pct, cls = 'bg-action-solid' }: { pct: number; cls?: string }) => (
  <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} /></div>
);

/** Détail des dossiers : numéro d'ordre du jour (numérotation du Conseil), lien vers le dossier, état, étape, échéance. */
function ActesTable({ items }: { items: Item[] }) {
  if (!items.length) return <p className="p-4 text-mute">Aucun dossier.</p>;
  return (
    <table className="w-full"><thead><tr><th>N°</th><th>Dossier</th><th>Direction</th><th>État</th><th>Étape et valideurs</th><th>Échéance</th></tr></thead><tbody>
      {items.map((a) => (
        <tr key={a.acteId} className={a.enRetard ? 'bg-ko-bg/40' : ''}>
          <td className="whitespace-nowrap">{a.numero ? <span className="font-mono text-[13px] font-bold text-head" title="Numéro à l'ordre du jour (provisoire tant que l'ordre du jour n'est pas arrêté)">{a.numero}</span> : <span className="text-mute" title="Pas encore à l'ordre du jour">—</span>}
            <div className="text-[11px] text-mute">dossier #{a.numeroSuivi}</div></td>
          <td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${a.acteId}`}>{a.titre}</Link>{a.dansOdj && <span className="ml-2 align-middle"><Badge tone="ok">à l'ordre du jour</Badge></span>}</td>
          <td className="text-[12px] text-mute">{a.direction}</td>
          <td><Badge tone={ETAT[a.etat].tone}>{ETAT[a.etat].label}</Badge></td>
          <td className="text-[12px]">{a.etape ?? '—'}{a.holders.length > 0 && <div className="text-mute">chez <AgentNames list={a.holders} /></div>}</td>
          <td className="whitespace-nowrap text-[12px]">{a.echeance ? dt(a.echeance, { dateStyle: 'short' }) : '—'}{a.enRetard && <div className="font-semibold text-ko">{a.motifRetard}</div>}</td>
        </tr>))}
    </tbody></table>
  );
}

/**
 * Indicateurs de la séance (remplace la liste d'avertissements) : compte à rebours, taux de réalisation, actes à terminer,
 * directions en retard, avancement de chaque commission. Un clic sur un indicateur affiche le détail des dossiers concernés.
 */
export default function SeanceKpis({ seanceId, rev }: { seanceId: number; rev: string }) {
  const { org } = useAuth(); const o = org!.id;
  const [k, setK] = useState<Kpis | null>(null); const [detail, setDetail] = useState<Detail | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.get(orgPath(o, `/seances/${seanceId}/kpis`)).then((r) => { if (live) { setK(r.data); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [o, seanceId, rev]);
  if (failed) return null;
  if (!k) return <div className="mb-4"><Loading /></div>;
  const a = k.avancement; const toggle = (d: Detail) => setDetail(detail && JSON.stringify(detail) === JSON.stringify(d) ? null : d);
  const is = (kind: Detail['kind'], id?: number) => !!detail && detail.kind === kind && (detail.kind !== 'commission' || detail.id === id);
  const seg = (n: number, cls: string, label: string) => n > 0 && <div key={label} className={`h-full ${cls}`} style={{ width: `${(n / Math.max(a.total, 1)) * 100}%` }} title={`${label} : ${n}`} />;
  const com = detail?.kind === 'commission' ? k.commissions.find((c) => c.id === detail.id) : null;

  return (
    <section className="mb-4 space-y-4" aria-label="Indicateurs de la séance">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card icon={<AlarmClock className="h-4 w-4" />} title="Compte à rebours" value={cd(k.compteARebours.jours)} tone={k.compteARebours.jours < 0 ? 'ko' : undefined}
          sub={<>Séance le {dt(k.compteARebours.date, { dateStyle: 'long' })}{k.compteARebours.prochainJalon && <div className="mt-1 font-semibold text-slate-700">{k.compteARebours.prochainJalon.label} : {cd(k.compteARebours.prochainJalon.jours)}</div>}</>} />
        <Card icon={<CheckCircle2 className="h-4 w-4" />} title="Taux de réalisation" value={`${a.tauxRealisation} %`} tone={a.tauxRealisation === 100 ? 'ok' : undefined}
          sub={<><div className="mb-1">{a.prets} / {a.total} dossiers terminés</div>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">{seg(a.prets, ETAT.pret.bar, 'Terminés')}{seg(a.enCircuit, ETAT.en_circuit.bar, 'En validation')}{seg(a.aCorriger, ETAT.a_corriger.bar, 'À corriger')}{seg(a.brouillons, ETAT.brouillon.bar, 'En rédaction')}</div></>} />
        <Card icon={<ClipboardList className="h-4 w-4" />} title="Actes à terminer" value={k.aTerminer.total} tone={k.aTerminer.enRetard > 0 ? 'warn' : k.aTerminer.total === 0 ? 'ok' : undefined}
          sub={k.aTerminer.total === 0 ? 'Tout est terminé' : <>{a.enCircuit} en validation · {a.aCorriger} à corriger · {a.brouillons} en rédaction{k.aTerminer.enRetard > 0 && <div className="font-semibold text-ko">dont {k.aTerminer.enRetard} en retard</div>}</>}
          onClick={k.aTerminer.total ? () => toggle({ kind: 'actes' }) : undefined} active={is('actes')} />
        <Card icon={<Users2 className="h-4 w-4" />} title="Directions en retard" value={k.directions.enRetard} tone={k.directions.enRetard > 0 ? 'ko' : 'ok'}
          sub={`sur ${k.directions.items.length} direction(s) concernée(s)`} onClick={k.directions.items.length ? () => toggle({ kind: 'directions' }) : undefined} active={is('directions')} />
        <Card icon={<CalendarClock className="h-4 w-4" />} title="À l'ordre du jour" value={<>{a.dansOdj}<span className="text-[16px] text-mute"> / {a.total}</span></>} sub="dossiers visant la séance déjà inscrits" />
      </div>

      {detail?.kind === 'actes' && <div className="card overflow-hidden"><div className="border-b border-line px-4 py-2 font-semibold">Actes à terminer ({k.aTerminer.total})</div><ActesTable items={k.aTerminer.items} /></div>}
      {detail?.kind === 'directions' && (
        <div className="card overflow-hidden"><div className="border-b border-line px-4 py-2 font-semibold">Avancement par direction</div>
          <table className="w-full"><thead><tr><th>Direction</th><th>Dossiers</th><th>Terminés</th><th>À terminer</th><th>En retard</th></tr></thead><tbody>
            {k.directions.items.map((d) => (
              <tr key={d.code}><td className="font-semibold">{d.direction}</td><td>{d.total}</td><td>{d.prets}</td><td>{d.aTerminer}</td>
                <td>{d.enRetard > 0 ? <Badge tone="ko">{d.enRetard} en retard</Badge> : <span className="text-mute">—</span>}</td></tr>))}
          </tbody></table>
          <div className="border-t border-line px-4 py-2 text-[12px] text-mute">Un dossier est en retard quand son étape a dépassé son échéance, ou quand la date limite de rédaction (brouillons, dossiers à corriger) ou de validation DGS (autres dossiers) est passée.</div></div>)}

      {k.commissions.length > 0 && (
        <div>
          <h3 className="mb-2 text-[14px]">Commissions — avis à obtenir</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{k.commissions.map((c) => (
            <button key={c.id} type="button" onClick={() => c.restants.length && toggle({ kind: 'commission', id: c.id })} aria-expanded={is('commission', c.id)}
              className={`card p-3 text-left ${c.restants.length ? 'cursor-pointer hover:shadow-float' : ''} ${is('commission', c.id) ? 'ring-2 ring-action' : ''}`}>
              <div className="flex items-start justify-between gap-2"><b className="text-[13px] leading-tight">{c.nom}</b>
                {c.prochaineReunion ? <Badge tone={c.prochaineReunion.jours <= 7 ? 'warn' : 'blue'}>{cd(c.prochaineReunion.jours)}</Badge> : <Badge>pas de réunion</Badge>}</div>
              <div className="mt-2 text-[12px] text-mute"><b className="text-[15px] text-head">{c.termines}</b> / {c.prevus} actes terminés (avis rendu)</div>
              <div className="mt-1"><Bar pct={c.tauxRealisation} cls={c.tauxRealisation === 100 ? 'bg-emerald-500' : 'bg-action-solid'} /></div>
              <div className="mt-1 text-[11px] text-mute">{c.prochaineReunion ? `Réunion le ${dt(c.prochaineReunion.date, { dateStyle: 'long' })}` : 'Aucune réunion planifiée'}</div>
            </button>))}</div>
        </div>)}
      {com && <div className="card overflow-hidden"><div className="border-b border-line px-4 py-2 font-semibold">{com.nom} — avis en attente ({com.restants.length})</div><ActesTable items={com.restants} /></div>}

      {k.compteARebours.jalons.length > 0 && (
        <ol className="flex flex-wrap gap-2 text-[12px]" aria-label="Dates clés">{k.compteARebours.jalons.map((j) => (
          <li key={j.code} className={`rounded-full border px-3 py-1 ${j.passe ? 'border-line bg-slate-50 text-mute' : 'border-action/30 bg-action/5 text-slate-700'}`}>
            <b>{j.label}</b> · {dt(j.date, { dateStyle: 'short' })} · <span className={!j.passe && j.jours <= 3 ? 'font-semibold text-ko' : ''}>{j.passe ? 'passée' : cd(j.jours)}</span></li>))}</ol>)}
    </section>
  );
}
