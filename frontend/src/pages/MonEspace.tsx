import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PenLine } from 'lucide-react';
import { api, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Loading, PageTitle, StatutBadge, useLoad } from '../ui';
import { Mascotte } from '../DossierAssiste';
import { SeanceVisee } from '../SeanceVisee';
import { NewDossier } from './Dossiers';

const CATEGORIES: { cle: string; titre: string; sous: string; match: (r: string[]) => boolean }[] = [
  { cle: 'action', titre: 'Action attendue de vous', sous: 'Dossiers en attente de votre validation ou renvoyés à votre attention.', match: (r) => r.includes('action') },
  { cle: 'equipe', titre: 'Rédaction / validation de mon équipe', sous: 'Ce que vos collaborateurs rédigent ou font valider.', match: (r) => r.some((x) => ['redaction', 'correction', 'validation'].includes(x)) },
  { cle: 'valide', titre: 'Validés par vous, en circuit', sous: 'Ils poursuivent leur circuit sans vous.', match: (r) => r.includes('valide') },
  { cle: 'poursuite', titre: 'Plus à vous — en cours de circuit', sous: 'Actes que vous suivez et qui ne sont plus à votre étape (encore en circuit, ou validés en attente de séance).', match: (r) => r.includes('poursuite') },
];

/**
 * Mes actes : tous les actes NON encore passés au conseil qui me concernent — action attendue de moi,
 * rédaction/validation par mon équipe, acte que j'ai validé et qui poursuit son circuit, acte qui n'est plus à mon étape.
 * Les actes en retard sont distingués, les actes inscrits au conseil portent une pastille (fond vert si le circuit est validé).
 */
type Vue = 'rubriques' | 'conseil';

export default function MonEspace() {
  const { me, org } = useAuth(); const o = org!.id;
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(sp.get('nouveau') === '1');
  const [vue, setVue] = useState<Vue>('rubriques');
  useEffect(() => { if (sp.get('nouveau') === '1') setCreating(true); }, [sp]);
  const pf = useLoad(async () => (await api.get(orgPath(o, '/circuit/portefeuille'))).data.items as any[], [o]);
  const cap = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
  const first = me ? cap(me.agent?.prenom || me.displayName.split(' ')[0] || '') : '';
  const fermer = () => { setCreating(false); const n = new URLSearchParams(sp); n.delete('nouveau'); n.delete('assiste'); setSp(n, { replace: true }); };
  const items = pf.data ?? [];
  const retard = items.filter((t) => t.enRetard).length;

  const ligne = (t: any, showEtape: boolean) => {
    const inscrit = !!t.acte.seanceVisee?.inscrit || t.acte.statut === 'inscrit_odj';
    const vert = inscrit && t.valide;
    return (
      <tr key={t.acte.id} className={vert ? 'bg-ok-bg' : t.enRetard ? 'bg-ko-bg' : 'hover:bg-soft'}>
        <td className="w-16 font-mono text-[12px]">#{t.acte.numeroSuivi}</td>
        <td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${t.acte.id}`}>{t.acte.titre}</Link>{inscrit && <span className="ml-2"><Badge tone="ok">Inscrit au conseil</Badge></span>}<div className="text-[12px] text-mute">{t.acte.direction?.label}</div></td>
        {showEtape && <td className="text-[12px]">{t.step?.label ?? '—'}</td>}
        <td><SeanceVisee acte={t.acte} /></td>
        <td><StatutBadge statut={t.acte.statut} /></td>
        <td className="text-[12px]">{t.step?.dueAt ? (t.enRetard ? <Badge tone="ko">En retard · {dt(t.step.dueAt, { dateStyle: 'short' })}</Badge> : dt(t.step.dueAt, { dateStyle: 'medium' })) : '—'}</td>
      </tr>);
  };
  const tableau = (cle: string, titre: string, sous: string, lst: any[], showEtape: boolean) => (
    <section key={cle} className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <h3 className="!text-[15px]">{titre}</h3><Badge tone="blue">{lst.length}</Badge>
        {sous && <span className="ml-2 text-[12px] text-mute">{sous}</span>}
      </div>
      <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>N°</th><th>Acte</th>{showEtape && <th>Étape</th>}<th>Séance visée</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>
        {lst.map((t: any) => ligne(t, showEtape))}
      </tbody></table></div>
    </section>
  );

  // Rupture par conseil pressenti, comme « Tous les actes ».
  const groupes = new Map<string, { cle: string; libelle: string; date?: string; items: any[] }>();
  for (const it of items) {
    const s = it.acte.seanceVisee;
    if (s) {
      const cle = String(s.dateSeance).slice(0, 10);
      const g = groupes.get(cle) ?? { cle, libelle: `Conseil du ${dt(s.dateSeance, { dateStyle: 'long' })}${s.instance ? ` — ${s.instance}` : ''}`, date: s.dateSeance, items: [] as any[] };
      g.items.push(it); groupes.set(cle, g);
    } else {
      const g = groupes.get('none') ?? { cle: 'none', libelle: 'Sans conseil pressenti', items: [] as any[] };
      g.items.push(it); groupes.set('none', g);
    }
  }
  const parConseil = [...groupes.values()].sort((a, b) => {
    if (a.cle === 'none') return 1; if (b.cle === 'none') return -1;
    return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
  });
  const onglets: [Vue, string][] = [['rubriques', 'Par rubrique'], ['conseil', 'Par conseil']];

  return (
    <div className="space-y-6">
      <PageTitle title={`Bonjour ${first}`} sub={`Les actes qui vous concernent et qui ne sont pas encore passés au conseil.`} actions={
        <>
          <div role="tablist" className="flex rounded bg-surface p-1 shadow-card">
            {onglets.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={vue === k} onClick={() => setVue(k)} className={`rounded px-3 py-2 text-[13px] font-semibold ${vue === k ? 'bg-primary text-white' : 'text-slate-700'}`}>{l}</button>
            ))}
          </div>
          <Link to="/?nouveau=1&assiste=1" className="btn-secondary"><Mascotte className="h-4 w-4" humeur="content" /> Dossier assisté</Link>
          <button data-tour="nouveau-dossier" className="btn-primary" onClick={() => setCreating(true)}><PenLine className="h-4 w-4" /> Nouveau dossier</button>
        </>
      } />

      {pf.loading && !pf.data ? <div className="card"><Loading /></div> : pf.error ? <div className="card p-4"><ErrorBox msg={pf.error} /></div> : !items.length ? <div className="card"><Empty>Aucun acte en cours ne vous concerne. 🎉</Empty></div> : (
        <>
          <div className="flex items-center gap-2"><h2 className="!text-[16px]">Mes actes</h2><Badge tone="blue">{items.length}</Badge>{retard > 0 && <Badge tone="ko">{retard} en retard</Badge>}<span className="ml-2 text-[12px] text-mute">Actes non encore passés au conseil.</span></div>
          {vue === 'rubriques'
            ? CATEGORIES.map((cat, i) => {
              const g = items.filter((it: any) => CATEGORIES.findIndex((c) => c.match(it.raisons)) === i);
              if (!g.length) return null;
              return tableau(cat.cle, cat.titre, cat.sous, g, cat.cle === 'equipe' || cat.cle === 'poursuite');
            })
            : parConseil.map((grp) => tableau(grp.cle, grp.libelle, '', grp.items, true))}
        </>
      )}

      {creating && <NewDossier assisterParDefaut={sp.get('assiste') === '1'} onClose={fermer} />}
    </div>
  );
}
