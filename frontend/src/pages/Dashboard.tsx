import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarCheck, ClipboardCheck, PenLine, Route, Users } from 'lucide-react';
import { api, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Loading, PageTitle, StatutBadge, useLoad } from '../ui';
import { AgentName, AgentNames } from '../AgentName';
import { SeanceVisee } from '../SeanceVisee';
import { Mascotte } from '../DossierAssiste';

/** Synthèse : ce qui m'attend (widgets). Réutilisée par la page unique « Mon espace ». */
export function Synthese() {
  const { org } = useAuth();
  const o = org!.id;
  const todo = useLoad(async () => (await api.get(orgPath(o, '/circuit/a-traiter'))).data.items as any[], [o]);
  const late = useLoad(async () => (await api.get(orgPath(o, '/circuit/en-retard'))).data.items as any[], [o]);
  const suivi = useLoad(async () => (await api.get(orgPath(o, '/circuit/suivi'))).data as { equipe: any[]; valides: any[] }, [o]);
  const inscrits = useLoad(async () => (await api.get(orgPath(o, '/actes'), { params: { statut: 'inscrit_odj', scope: 'all', limit: 30 } })).data.items as any[], [o]);

  return (
    <div className="space-y-8">

      <section aria-labelledby="atraiter" className="card">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3"><ClipboardCheck className="h-5 w-5 text-action" /><h3 id="atraiter">À traiter</h3>{todo.data && <Badge tone="blue">{todo.data.length}</Badge>}</div>
        {todo.loading ? <Loading /> : todo.error ? <div className="p-4"><ErrorBox msg={todo.error} /></div> : !todo.data?.length ? <Empty>Rien en attente de votre validation. 🎉</Empty> : (
          <table className="w-full"><thead><tr><th>N°</th><th>Acte</th><th>Séance visée</th><th>Étape</th><th>Échéance</th></tr></thead><tbody>
            {todo.data.map((t) => (
              <tr key={t.acte.id} className="hover:bg-soft">
                <td className="w-20 font-mono text-[12px]">#{t.acte.numeroSuivi}</td>
                <td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${t.acte.id}`}>{t.acte.titre}</Link><div className="text-[12px] text-mute">{t.acte.direction?.label}</div></td>
                <td><SeanceVisee acte={t.acte} /></td>
                <td>{t.step.returned ? <Badge tone="warn">À corriger</Badge> : t.step.label}{t.step.onBehalfOf && <div className="text-[11px] text-mute">pour {t.step.onBehalfOf}</div>}</td>
                <td>{t.step.late ? <Badge tone="ko">En retard · {dt(t.step.dueAt, { dateStyle: 'short' })}</Badge> : dt(t.step.dueAt, { dateStyle: 'medium' })}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>


      {(suivi.data?.equipe.length ?? 0) > 0 && (
        <section aria-labelledby="equipe" className="card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3"><Users className="h-5 w-5 text-action" /><h3 id="equipe">Dossiers de mon équipe</h3><Badge tone="blue">{suivi.data!.equipe.length}</Badge>
            <span className="ml-2 text-[12px] text-mute">Ce que vos collaborateurs rédigent ou font valider.</span></div>
          <table className="w-full"><thead><tr><th>N°</th><th>Acte</th><th>Rédacteur</th><th>Séance visée</th><th>Où en est-il ?</th><th>Échéance</th></tr></thead><tbody>
            {suivi.data!.equipe.slice(0, 25).map((t) => (
              <tr key={t.acte.id} className="hover:bg-soft">
                <td className="w-20 font-mono text-[12px]">#{t.acte.numeroSuivi}</td>
                <td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${t.acte.id}`}>{t.acte.titre}</Link></td>
                <td><AgentName u={t.acte.redacteur} /></td>
                <td><SeanceVisee acte={t.acte} /></td>
                <td>{t.phase === 'redaction' ? <Badge>En rédaction</Badge> : t.phase === 'correction' ? <Badge tone="warn">À corriger</Badge> : <Badge tone="blue">{t.step?.label ?? 'En validation'}</Badge>}{t.step?.holders?.length ? <div className="text-[11px] text-mute">chez <AgentNames list={t.step.holders} /></div> : null}</td>
                <td>{t.step?.dueAt ? (t.step.late ? <Badge tone="ko">En retard · {dt(t.step.dueAt, { dateStyle: 'short' })}</Badge> : dt(t.step.dueAt, { dateStyle: 'medium' })) : '—'}</td>
              </tr>))}
          </tbody></table>
        </section>)}

      {(suivi.data?.valides.length ?? 0) > 0 && (
        <section aria-labelledby="valides" className="card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3"><Route className="h-5 w-5 text-ok" /><h3 id="valides">Dossiers que j'ai validés, en cours de circuit</h3><Badge tone="ok">{suivi.data!.valides.length}</Badge></div>
          <table className="w-full"><thead><tr><th>N°</th><th>Acte</th><th>Séance visée</th><th>Ma validation</th><th>Maintenant</th><th>Échéance</th></tr></thead><tbody>
            {suivi.data!.valides.slice(0, 25).map((t) => (
              <tr key={t.acte.id} className="hover:bg-soft">
                <td className="w-20 font-mono text-[12px]">#{t.acte.numeroSuivi}</td>
                <td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${t.acte.id}`}>{t.acte.titre}</Link><div className="text-[12px] text-mute">{t.acte.direction?.label}</div></td>
                <td><SeanceVisee acte={t.acte} /></td>
                <td>{t.validatedStep}<div className="text-[11px] text-mute">{dt(t.validatedAt, { dateStyle: 'short' })}</div></td>
                <td>{t.step ? <><Badge tone="blue">{t.step.label}</Badge>{t.step.holders?.length ? <div className="text-[11px] text-mute">chez <AgentNames list={t.step.holders} /></div> : null}</> : '—'}</td>
                <td>{t.step?.dueAt ? (t.step.late ? <Badge tone="ko">En retard</Badge> : dt(t.step.dueAt, { dateStyle: 'medium' })) : '—'}</td>
              </tr>))}
          </tbody></table>
        </section>)}

      {(inscrits.data?.length ?? 0) > 0 && (
        <section aria-labelledby="inscrits" className="card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3"><CalendarCheck className="h-5 w-5 text-primary" /><h3 id="inscrits">Actes inscrits au conseil</h3><Badge tone="blue">{inscrits.data!.length}</Badge>
            <span className="ml-2 text-[12px] text-mute">Circuit terminé, en attente de leur séance.</span></div>
          <table className="w-full"><thead><tr><th>N°</th><th>Acte</th><th>Direction</th><th>Séance visée</th><th>Statut</th></tr></thead><tbody>
            {inscrits.data!.slice(0, 25).map((a) => (
              <tr key={a.id} className="hover:bg-soft">
                <td className="w-20 font-mono text-[12px]">#{a.numeroSuivi}</td>
                <td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${a.id}`}>{a.titre}</Link></td>
                <td className="text-mute">{a.direction?.label}</td>
                <td><SeanceVisee acte={a} /></td>
                <td><StatutBadge statut={a.statut} /></td>
              </tr>))}
          </tbody></table>
        </section>)}

      <section aria-labelledby="retard" className="card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3"><AlertTriangle className="h-5 w-5 text-warn" /><h3 id="retard">Actes en retard dans mon périmètre</h3></div>
          {late.loading ? <Loading /> : !late.data?.length ? <Empty>Aucun retard. Bravo !</Empty> : (
            <ul>{late.data.map((t) => (
              <li key={t.acte.id} className="border-b border-line px-5 py-3 last:border-0"><Link to={`/dossiers/${t.acte.id}`} className="font-semibold text-head hover:underline">{t.acte.titre}</Link>
                <div className="text-[12px] text-mute">Étape « {t.step.label} » · échue le {dt(t.step.dueAt, { dateStyle: 'medium' })} · chez <AgentNames list={t.step.holders} /></div></li>))}
            </ul>
          )}
        </section>
    </div>
  );
}

/** Ancienne page d'accueil (conservée pour compatibilité) : titre + synthèse. */
export default function Dashboard() {
  const { me, org } = useAuth();
  const cap = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
  const first = me ? cap(me.agent?.prenom || me.displayName.split(' ')[0] || '') : '';
  return (
    <div className="space-y-8">
      <PageTitle title={`Bonjour ${first ?? ''}`} sub={`Voici ce qui vous attend à ${org!.nom}.`} actions={
        <>
          <Link to="/?nouveau=1&assiste=1" className="btn-secondary"><Mascotte className="h-4 w-4" humeur="content" /> Dossier assisté</Link>
          <Link to="/?nouveau=1" className="btn-primary"><PenLine className="h-4 w-4" /> Nouveau dossier</Link>
        </>
      } />
      <Synthese />
    </div>
  );
}
