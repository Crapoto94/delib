import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bell, BellOff, Bookmark, Download, Mail, Search, X } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Loading, PageTitle, StatutBadge, useLoad, useToast } from '../ui';
import { Select } from '../Select';

/** Critères transmis tels quels à l'API (les noms sont ceux des facettes). */
const CRITERES = ['statut', 'typeId', 'natureId', 'matiereId', 'rubriqueId', 'rapporteurId', 'directionCode', 'seanceId', 'resultat', 'annee', 'du', 'au'] as const;
const FACETTES: [string, string][] = [
  ['statut', 'Statut'], ['resultat', 'Résultat du vote'], ['annee', 'Année de séance'], ['seanceId', 'Séance'], ['typeId', "Type d'acte"], ['natureId', 'Nature'],
  ['matiereId', 'Matière'], ['rubriqueId', 'Rubrique'], ['rapporteurId', 'Rapporteur'], ['directionCode', 'Direction'],
];
const PAGE = 20;

export default function Recherche() {
  const { org } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { toast, node } = useToast();
  const q = sp.get('q') || '';
  const [saisie, setSaisie] = useState(q);
  const tri = sp.get('tri') || 'pertinence'; const offset = Number(sp.get('offset') || 0);
  const criteres: Record<string, string> = {}; for (const k of CRITERES) { const v = sp.get(k); if (v) criteres[k] = v; }
  const params = { q: q || undefined, ...criteres, tri, limit: PAGE, offset };
  const actifs = Object.keys(criteres).length > 0;

  const res = useLoad(async () => (q || actifs) ? (await api.get(orgPath(org!.id, '/recherche'), { params })).data : null, [org!.id, sp.toString()]);
  const saved = useLoad(async () => (await api.get(orgPath(org!.id, '/recherche/enregistrees'))).data.items as any[], [org!.id]);
  const alertes = useLoad(async () => new Map<number, boolean>(((await api.get(orgPath(org!.id, '/recherche/alertes'))).data.items as any[]).map((a) => [a.id, a.alerte])), [org!.id]);
  const mails = useLoad(async () => new Map<number, boolean>(((await api.get(orgPath(org!.id, '/recherche/alertes'))).data.items as any[]).map((a) => [a.id, !!a.alerteMail])), [org!.id, alertes.data]);
  const basculerMail = async (r: any) => { const actif = !mails.data?.get(r.id); try { await api.put(orgPath(org!.id, `/recherche/enregistrees/${r.id}/alerte-mail`), { actif }); mails.reload(); toast(actif ? 'Vous serez aussi prévenu(e) par e-mail' : 'Alerte par e-mail coupée'); } catch (e) { toast(errMsg(e), 'ko'); } };
  const basculerAlerte = async (r: any) => { const actif = !alertes.data?.get(r.id); try { await api.put(orgPath(org!.id, `/recherche/enregistrees/${r.id}/alerte`), { actif }); alertes.reload(); toast(actif ? `Alerte activée : vous serez prévenu(e) des nouveaux actes pour « ${r.nom} »` : 'Alerte coupée', 'ok'); } catch (e) { toast(errMsg(e), 'ko'); } };
  useEffect(() => setSaisie(q), [q]);

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    if (!('offset' in patch)) n.delete('offset');
    setSp(n);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); set({ q: saisie.trim() || null }); };
  const toggle = (k: string, v: string) => set({ [k]: criteres[k] === v ? null : v });

  const exporter = async () => {
    try {
      const r = await api.get(orgPath(org!.id, '/recherche/export.csv'), { params: { q: q || undefined, ...criteres }, responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = 'recherche.csv'; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const enregistrer = async () => {
    const nom = window.prompt('Nom de cette recherche :', q || 'Ma recherche')?.trim();
    if (!nom) return;
    try { await api.post(orgPath(org!.id, '/recherche/enregistrees'), { nom, requete: { q, ...criteres } }); saved.reload?.(); toast('Recherche enregistrée', 'ok'); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const ouvrir = (r: any) => { const n = new URLSearchParams(); for (const [k, v] of Object.entries(r.requete || {})) if (v !== undefined && v !== '' && v !== null) n.set(k, String(v)); setSp(n); };
  const supprimer = async (id: number) => { try { await api.delete(orgPath(org!.id, `/recherche/enregistrees/${id}`)); saved.reload?.(); } catch (e) { toast(errMsg(e), 'ko'); } };

  const d = res.data;
  return (
    <div>
      <PageTitle title="Recherche" sub="Actes en cours et passés : titres, objets, textes et annexes (PDF) — dans la limite de vos droits." />
      <form onSubmit={submit} className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        <Search className="h-5 w-5 text-mute" />
        <input id="recherche-q" aria-label="Recherche" className="input min-w-0 flex-1" autoFocus placeholder={'Mots, « expression exacte », OR, -exclusion, urba*, n° de délibération…'} value={saisie} onChange={(e) => setSaisie(e.target.value)} />
        <Select aria-label="Tri" className="input w-auto" value={tri} onChange={(e) => set({ tri: e.target.value === 'pertinence' ? null : e.target.value })}><option value="pertinence">Pertinence</option><option value="date">Date de séance</option></Select>
        <button className="btn-primary">Rechercher</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          {actifs && (
            <div className="card p-3">
              <div className="mb-2 flex items-center justify-between"><h3>Filtres actifs</h3><button className="text-[12px] font-semibold text-action" onClick={() => set(Object.fromEntries(CRITERES.map((k) => [k, null])))}>Tout retirer</button></div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(criteres).map(([k, v]) => {
                  const lib = d?.facettes?.[k]?.find((f: any) => String(f.valeur) === v)?.libelle ?? v;
                  return <button key={k} onClick={() => set({ [k]: null })} className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[12px] font-semibold text-head">{lib}<X className="h-3 w-3" /></button>;
                })}
              </div>
            </div>)}
          {d && FACETTES.map(([k, titre]) => {
            const items: any[] = d.facettes?.[k] || [];
            if (!items.length || (items.length === 1 && criteres[k] === undefined && items[0].n === d.total && items.length === 1 && k !== 'statut' && k !== 'resultat')) return null;
            return (
              <div key={k} className="card p-3">
                <h3 className="mb-1">{titre}</h3>
                <ul className="space-y-0.5">
                  {items.slice(0, 8).map((f) => (
                    <li key={String(f.valeur)}>
                      <button onClick={() => toggle(k, String(f.valeur))} aria-pressed={criteres[k] === String(f.valeur)} className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-soft ${criteres[k] === String(f.valeur) ? 'bg-primary/10 font-semibold text-head' : ''}`}>
                        <span className="truncate">{f.libelle}</span><span className="text-[11px] text-mute">{f.n}</span>
                      </button>
                    </li>))}
                </ul>
              </div>);
          })}
          <div className="card p-3">
            <h3 className="mb-1">Mes recherches</h3>
            {!saved.data?.length ? <p className="text-[12px] text-mute">Aucune recherche enregistrée.</p> : (
              <ul className="space-y-0.5">{saved.data.map((r: any) => (
                <li key={r.id} className="flex items-center gap-1"><button className="flex-1 truncate rounded px-2 py-1 text-left text-[13px] hover:bg-soft" onClick={() => ouvrir(r)}>{r.nom}</button>
                  <button aria-label={alertes.data?.get(r.id) ? `Couper l’alerte « ${r.nom} »` : `Me prévenir des nouveaux actes « ${r.nom} »`} title={alertes.data?.get(r.id) ? 'Alerte active : cliquer pour couper' : 'Me prévenir quand un nouvel acte correspond'} aria-pressed={!!alertes.data?.get(r.id)} className={`rounded p-1 hover:bg-soft ${alertes.data?.get(r.id) ? 'text-head' : 'text-mute'}`} onClick={() => basculerAlerte(r)}>{alertes.data?.get(r.id) ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}</button>
                  {alertes.data?.get(r.id) && <button aria-label={mails.data?.get(r.id) ? `Couper l’e-mail de l’alerte « ${r.nom} »` : `Recevoir aussi l’alerte « ${r.nom} » par e-mail`} title={mails.data?.get(r.id) ? 'Alerte aussi par e-mail : cliquer pour couper' : 'Recevoir aussi cette alerte par e-mail'} aria-pressed={!!mails.data?.get(r.id)} className={`rounded p-1 hover:bg-soft ${mails.data?.get(r.id) ? 'text-head' : 'text-mute'}`} onClick={() => basculerMail(r)}><Mail className="h-3.5 w-3.5" /></button>}
                  <button aria-label={`Supprimer « ${r.nom} »`} className="rounded p-1 text-mute hover:bg-soft" onClick={() => supprimer(r.id)}><X className="h-3 w-3" /></button></li>))}</ul>)}
          </div>
        </aside>

        <section>
          {res.loading ? <Loading /> : res.error ? <ErrorBox msg={res.error} /> : !d ? (
            <div className="card"><Empty>Saisissez un mot ou choisissez un critère.<div className="mt-2 text-[12px]">Exemples : <code>école</code> · <code>"plan local d'urbanisme"</code> · <code>piscine OR patinoire</code> · <code>subvention -sportive</code> · <code>urba*</code> · <code>2026-4-012</code></div></Empty></div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-mute">
                  <b>{d.total}</b> résultat{d.total > 1 ? 's' : ''}{d.tronque ? ' (les 5 000 premiers)' : ''} · {d.dureeMs} ms
                  {d.approchee && <Badge tone="warn"> résultats approchants (faute de frappe tolérée)</Badge>}
                </p>
                <div className="flex gap-2">
                  <button className="btn-secondary" onClick={enregistrer}><Bookmark className="h-4 w-4" /> Enregistrer</button>
                  <button className="btn-secondary" onClick={exporter} disabled={!d.total}><Download className="h-4 w-4" /> Export CSV</button>
                </div>
              </div>
              {!d.items.length ? <div className="card"><Empty>Aucun acte ne correspond.</Empty></div> : (
                <ul className="space-y-2">
                  {d.items.map((r: any) => (
                    <li key={r.acteId} className="card p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/dossiers/${r.acteId}`} className="text-[15px] font-semibold text-head hover:underline">{r.titre}</Link>
                        <StatutBadge statut={r.statut} />
                        {r.resultat && <Badge tone={r.resultat.code.startsWith('adopte') ? 'ok' : 'ko'}>{r.resultat.libelle}</Badge>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-mute">
                        #{r.numeroSuivi}{r.numero ? ` · délibération ${r.numero}` : ''}{r.instance ? ` · ${r.instance}` : ''}{r.dateSeance ? ` du ${dt(r.dateSeance)}` : ''}{r.matiere ? ` · ${r.matiere}` : ''}{r.rapporteur ? ` · ${r.rapporteur}` : ''}
                      </div>
                      {/* extrait : échappé côté serveur, seules les balises <mark> subsistent */}
                      {r.extrait && <p className="mt-2 text-[13px] leading-relaxed [&_mark]:rounded [&_mark]:bg-yellow-200 [&_mark]:px-0.5" dangerouslySetInnerHTML={{ __html: r.extrait }} />}
                    </li>))}
                </ul>)}
              {d.total > PAGE && (
                <div className="mt-3 flex items-center justify-between">
                  <button className="btn-secondary" disabled={offset === 0} onClick={() => set({ offset: String(Math.max(0, offset - PAGE)) })}>← Précédents</button>
                  <span className="text-[12px] text-mute">{offset + 1}–{Math.min(offset + PAGE, d.total)} sur {d.total}</span>
                  <button className="btn-secondary" disabled={offset + PAGE >= d.total} onClick={() => set({ offset: String(offset + PAGE) })}>Suivants →</button>
                </div>)}
            </>)}
        </section>
      </div>
      {node}
    </div>
  );
}
