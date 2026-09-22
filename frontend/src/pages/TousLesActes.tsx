import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, org as orgPath } from '../api';
import { AgentName } from '../AgentName';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Loading, PageTitle, StatutBadge, TypeBadge, useLoad } from '../ui';
import { SeanceVisee } from '../SeanceVisee';

type Vue = 'etape' | 'conseil';
const ORDRE_ETAPES = ['Rédaction', 'À corriger'];

/**
 * Tous les actes (administrateur / SCC) : les actes qui ne sont pas encore passés au conseil,
 * séparés par une rupture — soit selon l'étape du circuit, soit selon la date du conseil pressenti.
 */
export default function TousLesActes() {
  const { org } = useAuth(); const o = org!.id;
  const [vue, setVue] = useState<Vue>('etape');
  const d = useLoad(async () => (await api.get(orgPath(o, '/circuit/en-cours'))).data.items as any[], [o]);
  const items = d.data ?? [];
  const retard = items.filter((t) => t.enRetard).length;

  // Rupture : par étape du circuit, ou par date de conseil pressenti.
  const groupes = new Map<string, { cle: string; libelle: string; date?: string; items: any[] }>();
  const ajouter = (cle: string, libelle: string, it: any, date?: string) => {
    const g = groupes.get(cle) ?? { cle, libelle, date, items: [] };
    g.items.push(it); groupes.set(cle, g);
  };
  for (const it of items) {
    if (vue === 'etape') { const e = it.etape?.label || 'Autre'; ajouter(e, e, it); }
    else {
      const s = it.acte.seanceVisee;
      if (s) ajouter(String(s.dateSeance).slice(0, 10), `Conseil du ${dt(s.dateSeance, { dateStyle: 'long' })}${s.instance ? ` — ${s.instance}` : ''}`, it, s.dateSeance);
      else ajouter('none', 'Sans conseil pressenti', it);
    }
  }
  const liste = [...groupes.values()].sort((a, b) => {
    if (vue === 'etape') {
      const ia = ORDRE_ETAPES.indexOf(a.libelle); const ib = ORDRE_ETAPES.indexOf(b.libelle);
      return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) || a.libelle.localeCompare(b.libelle);
    }
    if (a.cle === 'none') return 1; if (b.cle === 'none') return -1;
    return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
  });

  const ligne = (it: any) => (
    <tr key={it.acte.id} className={it.enRetard ? 'bg-ko-bg' : 'hover:bg-soft'}>
      <td className="w-16 font-mono text-[12px]">#{it.acte.numeroSuivi}</td>
                    <td><Link className="font-semibold text-head hover:underline" to={`/dossiers/${it.acte.id}`}>{it.acte.titre}</Link> <TypeBadge acte={it.acte} /><div className="text-[12px] text-mute">{it.acte.direction?.label ? `${it.acte.direction.label} · ` : ''}<AgentName u={it.acte.redacteur} /></div></td>
      {vue === 'conseil' && <td>{it.enRetard ? <Badge tone="ko">{it.etape.label}</Badge> : <span className="text-[12px]">{it.etape.label}</span>}</td>}
      <td><SeanceVisee acte={it.acte} /></td>
      <td><StatutBadge statut={it.acte.statut} /></td>
      <td className="text-[12px]">{it.etape?.dueAt ? (it.enRetard ? <Badge tone="ko">En retard · {dt(it.etape.dueAt, { dateStyle: 'short' })}</Badge> : dt(it.etape.dueAt, { dateStyle: 'medium' })) : '—'}</td>
    </tr>);

  return (
    <div className="space-y-6">
      <PageTitle title="Tous les actes" sub="Les actes qui ne sont pas encore passés au conseil." actions={
        <>
          <div role="tablist" className="flex rounded bg-surface p-1 shadow-card">
            {([['etape', 'Par étape du circuit'], ['conseil', 'Par date du conseil']] as [Vue, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={vue === k} onClick={() => setVue(k)} className={`rounded px-3 py-2 text-[13px] font-semibold ${vue === k ? 'bg-primary text-white' : 'text-slate-700'}`}>{l}</button>
            ))}
          </div>
          {retard > 0 && <Badge tone="ko">{retard} en retard</Badge>}
        </>} />

      {d.loading && !d.data ? <Loading /> : d.error ? <ErrorBox msg={d.error} /> : !items.length ? <div className="card"><Empty>Aucun acte en cours.</Empty></div> : (
        liste.map((g) => (
          <section key={g.cle} aria-label={g.libelle} className="card">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <h3 className="!text-[15px]">{vue === 'etape' ? `Étape : ${g.libelle}` : g.libelle}</h3><Badge tone="blue">{g.items.length}</Badge>
            </div>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>N°</th><th>Acte</th>{vue === 'conseil' && <th>Étape</th>}<th>Séance visée</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>{g.items.map(ligne)}</tbody></table></div>
          </section>)))}
    </div>
  );
}
