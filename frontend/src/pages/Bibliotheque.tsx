import { FormEvent, Fragment, useState } from 'react';
import { BookOpen, FileText, Paperclip, ScrollText, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { api, blobErrMsg, errMsg, openPdf, org as orgPath } from '../api';
import { showPdf } from '../PdfViewer';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Pagination, PageTitle, useLoad, useToast } from '../ui';
import { Select } from '../Select';

/** Fiche de consultation d'une délibération adoptée : exposé des motifs, visas, dispositif, annexes, et les PDF (visionneuse). */
function Fiche({ acteId, onClose, onDone }: { acteId: number; onClose: () => void; onDone: () => void }) {
  const { org, isScc } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, `/bibliotheque/actes/${acteId}`))).data, [acteId]);
  const pdf = async (cible: string, titre: string) => { const m = await openPdf(() => api.get(orgPath(o, `/bibliotheque/actes/${acteId}/pdf`), { params: { cible }, responseType: 'blob' }), titre); if (m) toast(m, 'ko'); };
  const ouvrirAnnexe = async (x: any, format?: 'pdf') => {
    try {
      const r = await api.get(orgPath(o, `/actes/${acteId}/annexes/${x.id}/file`), { params: format ? { format } : {}, responseType: 'blob' });
      if (format === 'pdf' || (x.mime || '').includes('pdf')) { showPdf(r.data, x.titre || x.nom); return; }
      const url = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = url; a.download = x.nom || x.titre || 'annexe'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast(await blobErrMsg(e), 'ko'); }
  };
  const supprimer = async () => { if (!window.confirm('Retirer cette délibération de la bibliothèque ? L’acte est conservé, mais il n’y sera plus consultable.')) return; try { await api.delete(orgPath(o, `/bibliotheque/actes/${acteId}`)); toast('Délibération retirée de la bibliothèque'); onDone(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const f = d.data;
  return (
    <Modal title={f ? `${f.numero ? `${f.numero} — ` : ''}${f.titre}` : 'Délibération'} onClose={onClose} wide>
      {d.loading ? <Loading /> : !f ? <ErrorBox msg={d.error} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Badge tone="ok">{f.resultatLabel}</Badge>{f.airs && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-purple-700" title="Provient de l'import AIRS">Import AIRS</span>}<span className="text-mute">Séance du {dt(f.seance.dateSeance, { dateStyle: 'long' })} · {f.seance.instance}{f.matiere ? ` · ${f.matiere}` : ''}{f.direction ? ` · ${f.direction}` : ''}</span>
          </div>
          <div className="flex flex-wrap gap-2">{f.documents.map((x: any) => <button key={x.cible} className="btn-secondary" onClick={() => pdf(x.cible, `${x.label} — ${f.titre}`)}><FileText className="h-4 w-4" /> {x.label}</button>)}</div>
          {f.informations?.filter((x: any) => x.valeur !== null && x.valeur !== undefined && String(x.valeur).trim() !== '').length > 0 && (
            <section>
              <h3 className="mb-2">Informations</h3>
              <div className="overflow-x-auto rounded border border-line"><table className="w-full text-[13px]"><tbody>
                {f.informations.filter((x: any) => x.valeur !== null && x.valeur !== undefined && String(x.valeur).trim() !== '').map((x: any, i: number, arr: any[]) => (
                  <Fragment key={i}>
                    {(i === 0 || arr[i - 1].groupe !== x.groupe) && <tr><td colSpan={2} className="bg-soft px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-head">{x.groupe}</td></tr>}
                    <tr><td className="w-56 px-3 py-1 font-semibold text-mute">{x.label}</td><td className="px-3 py-1">{x.label === 'Date' || x.label === 'Date limite' ? dt(x.valeur, { dateStyle: 'long' }) : String(x.valeur)}</td></tr>
                  </Fragment>))}
              </tbody></table></div>
            </section>)}
          {[['Exposé des motifs', f.expose], ['Visas et considérants', f.visas], ['Dispositif', f.dispositif]].map(([t, md]) => md ? (
            <section key={t}><h3 className="mb-1">{t}</h3><div className="whitespace-pre-wrap rounded border border-line bg-soft/40 p-3 text-[13px] leading-6">{md}</div></section>) : null)}
          {f.annexes.length > 0 && <section><h3 className="mb-1">Annexes publiables</h3><ul className="space-y-1 text-[13px]">{f.annexes.map((x: any) => {
            const nom = x.nom || x.titre || ''; const ext = (nom.includes('.') ? nom.split('.').pop() : (x.mime || '').includes('pdf') ? 'pdf' : '') || '';
            return <li key={x.id} className="flex flex-wrap items-center gap-2"><button className="font-semibold text-head hover:underline" onClick={() => ouvrirAnnexe(x)}><FileText className="mr-1 inline h-3.5 w-3.5" /> {x.titre}</button>{ext && <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mute">{ext}</span>}{x.pdf && <button className="rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-action hover:underline" title="Voir le PDF" onClick={() => ouvrirAnnexe(x, 'pdf')}>pdf</button>}</li>;
          })}</ul></section>}
          <p className="text-[12px] text-mute">Consultation seule. Pour suivre le parcours d’un dossier auquel vous avez participé, ouvrez <b>Mes actes</b>.</p>
          {isScc && <div className="flex justify-end border-t border-line pt-3"><button className="btn-ko" onClick={supprimer}><Trash2 className="h-4 w-4" /> Supprimer de la bibliothèque</button></div>}
        </div>)}
      {node}
    </Modal>
  );
}

type Filtres = { q: string; etat: string; annee: string; matiereId: string; natureId: string; rubriqueId: string; directionCode: string; rapporteurId: string; instanceId: string; du: string; au: string };
const VIDES: Filtres = { q: '', etat: '', annee: '', matiereId: '', natureId: '', rubriqueId: '', directionCode: '', rapporteurId: '', instanceId: '', du: '', au: '' };

/** Bibliothèque des actes de la collectivité (REC-30) : recherche simple (mots, année) et recherche avancée (thématique, nature, rubrique, direction, rapporteur, instance, période). */
export default function Bibliotheque() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const [f, setF] = useState<Filtres>(VIDES); const [applique, setApplique] = useState<Filtres>(VIDES);
  const [avance, setAvance] = useState(false); const [ouvert, setOuvert] = useState<number | null>(null);
  const [page, setPage] = useState(1); const LIMIT = 50;
  const matieres = useLoad(async () => (await api.get(orgPath(o, '/referentiels/matiere'))).data.items as any[], [o]);
  const natures = useLoad(async () => (await api.get(orgPath(o, '/referentiels/nature'))).data.items as any[], [o]);
  const rubriques = useLoad(async () => (await api.get(orgPath(o, '/referentiels/rubrique'))).data.items as any[], [o]);
  const directions = useLoad(async () => (await api.get('/directory/directions')).data.items as any[], []);
  const elus = useLoad(async () => (await api.get(orgPath(o, '/elus'))).data.items as any[], [o]);
  const instances = useLoad(async () => (await api.get(orgPath(o, '/instances'))).data.items as any[], [o]);
  const d = useLoad(async () => (await api.get(orgPath(o, '/bibliotheque'), {
    params: {
      q: applique.q || undefined, etat: applique.etat || undefined, annee: applique.annee || undefined, matiereId: applique.matiereId || undefined, natureId: applique.natureId || undefined,
      rubriqueId: applique.rubriqueId || undefined, directionCode: applique.directionCode || undefined, rapporteurId: applique.rapporteurId || undefined,
      instanceId: applique.instanceId || undefined, du: applique.du || undefined, au: applique.au || undefined, limit: LIMIT, offset: (page - 1) * LIMIT,
    },
  })).data, [o, applique, page]);
  const chercher = (e: FormEvent) => { e.preventDefault(); setPage(1); setApplique(f); };
  const reinit = () => { setF(VIDES); setPage(1); setApplique(VIDES); };
  const actifs = Object.entries(applique).filter(([k, v]) => k !== 'q' && k !== 'etat' && v).length;
  const ans = (d.data?.annees ?? []) as number[];
  const maj = (k: keyof Filtres) => (e: any) => setF({ ...f, [k]: e.target.value });
  // Recherche avancée : applique le filtre immédiatement (résultats rafraîchis sans cliquer « Rechercher »).
  const appliquer = (k: keyof Filtres) => (e: any) => { const next = { ...f, [k]: e.target.value }; setF(next); setPage(1); setApplique(next); };
  /** Ouvre directement un PDF de la délibération (exposé des motifs = rapport, ou extrait du registre = délibération). */
  const pdfActe = async (acteId: number, cible: string, titre: string) => { const m = await openPdf(() => api.get(orgPath(o, `/bibliotheque/actes/${acteId}/pdf`), { params: { cible }, responseType: 'blob' }), titre); if (m) toast(m, 'ko'); };
  return (
    <div>
      <PageTitle title="Bibliothèque des actes" sub="Les délibérations adoptées de la collectivité (séances closes) : texte, exposé des motifs, extrait du registre. Consultation ouverte à tous les agents." />
      <form onSubmit={chercher} className="card mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="État des délibérations" className="flex rounded bg-surface p-1 shadow-card">
            {[['', 'Toutes', ''], ['archive', 'Archivées', 'bg-slate-400'], ['en_cours', 'En cours', 'bg-action-solid']].map(([k, l, coul]) => (
              <button key={k || 'tous'} type="button" role="tab" aria-selected={f.etat === k} onClick={() => { const next = { ...f, etat: k }; setF(next); setPage(1); setApplique(next); }} className={`flex items-center gap-1.5 rounded px-3 py-2 text-[13px] font-semibold ${f.etat === k ? 'bg-primary text-white' : 'text-slate-700'}`}>
                {coul && <span className={`inline-block h-2.5 w-2.5 rounded-full ${coul}`} aria-hidden />}{l}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 items-center rounded bg-soft px-3"><Search className="h-4 w-4 text-mute" /><input className="w-full min-w-0 bg-transparent px-2 py-2 outline-none" aria-label="Rechercher dans la bibliothèque" placeholder="Mots du titre, de l’objet, de l’exposé… ou n° de délibération" value={f.q} onChange={maj('q')} /></div>
          <Select className="input w-auto" aria-label="Année de la séance" value={f.annee} onChange={appliquer('annee')}><option value="">Toutes les années</option>{ans.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
          <button className="btn-primary">Rechercher</button>
          <button type="button" className="btn-secondary" aria-expanded={avance} onClick={() => setAvance((v) => !v)}><SlidersHorizontal className="h-4 w-4" /> Recherche avancée{actifs > 0 ? ` (${actifs})` : ''}</button>
          {(actifs > 0 || f.q) && <button type="button" className="btn-secondary" onClick={reinit}>Réinitialiser</button>}
        </div>
        {avance && (
          <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Thématique (matière)"><Select className="input" value={f.matiereId} onChange={appliquer('matiereId')}><option value="">Toutes</option>{(matieres.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</Select></Field>
            <Field label="Nature"><Select className="input" value={f.natureId} onChange={appliquer('natureId')}><option value="">Toutes</option>{(natures.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</Select></Field>
            <Field label="Rubrique"><Select className="input" value={f.rubriqueId} onChange={appliquer('rubriqueId')}><option value="">Toutes</option>{(rubriques.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</Select></Field>
            <Field label="Direction"><Select className="input" value={f.directionCode} onChange={appliquer('directionCode')}><option value="">Toutes</option>{(directions.data ?? []).map((x: any) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select></Field>
            <Field label="Rapporteur"><Select className="input" value={f.rapporteurId} onChange={appliquer('rapporteurId')}><option value="">Tous</option>{(elus.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{`${x.prenom ?? ''} ${x.nom ?? ''}`.trim()}</option>)}</Select></Field>
            <Field label="Instance"><Select className="input" value={f.instanceId} onChange={appliquer('instanceId')}><option value="">Toutes</option>{(instances.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.nom}</option>)}</Select></Field>
            <Field label="Conseil à partir du"><input className="input" type="date" value={f.du} onChange={appliquer('du')} /></Field>
            <Field label="Jusqu’au"><input className="input" type="date" value={f.au} onChange={appliquer('au')} /></Field>
          </div>
        )}
      </form>
      {d.loading && !d.data ? <Loading /> : !d.data ? <ErrorBox msg={d.error} /> : !d.data.items.length ? <div className="card"><Empty>Aucune délibération adoptée ne correspond.</Empty></div> : (
        <div className="card overflow-x-auto"><table className="w-full"><thead><tr><th>N°</th><th>Délibération</th><th>Rapporteur</th><th>Séance</th><th>Résultat</th><th /></tr></thead><tbody>{d.data.items.map((r: any) => (
          <tr key={r.acteId}><td className="font-mono text-[12px]"><span title={r.archive ? 'Archivée' : 'En cours'} className={`mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle ${r.archive ? 'bg-slate-400' : 'bg-action-solid'}`} />{r.numero ?? '—'}</td><td><b className={r.airs ? 'text-purple-700' : undefined}>{r.titre}</b>{r.airs && <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-purple-700" title="Provient de l'import AIRS">Import AIRS</span>}<div className="text-[12px] text-mute">{[r.matiere, r.direction].filter(Boolean).join(' · ')}</div></td>
            <td className="text-[12px]">{r.rapporteur ?? '—'}</td>
            <td className="text-[12px]">{dt(r.dateSeance, { dateStyle: 'medium' })}<div className="text-mute">{r.instance}</div></td><td><Badge tone="ok">{r.resultatLabel}</Badge></td>
            <td className="whitespace-nowrap text-right">
              <button className="btn-secondary mr-1 !px-2 !py-1" title="Exposé des motifs (rapport AIRS)" aria-label="Exposé des motifs" onClick={() => pdfActe(r.acteId, 'expose', `Exposé des motifs — ${r.titre}`)}><FileText className="h-3.5 w-3.5" /></button>
              <button className="btn-secondary mr-1 !px-2 !py-1" title="Délibération (extrait du registre)" aria-label="Délibération" onClick={() => pdfActe(r.acteId, 'extrait', `Extrait du registre — ${r.titre}`)}><ScrollText className="h-3.5 w-3.5" /></button>
              {r.annexesCount > 0 && <button className="btn-secondary mr-1 !px-2 !py-1" title={`${r.annexesCount} annexe(s)${r.annexesNonPubliables ? ` dont ${r.annexesNonPubliables} non publiable(s)` : ''}`} onClick={() => setOuvert(r.acteId)}><Paperclip className="h-3.5 w-3.5" /> {r.annexesCount}{r.annexesNonPubliables > 0 && <span className="ml-1 font-semibold text-ko">({r.annexesNonPubliables})</span>}</button>}
              <button className="btn-secondary !px-2 !py-1" title="Consulter la fiche" aria-label="Consulter" onClick={() => setOuvert(r.acteId)}><BookOpen className="h-3.5 w-3.5" /></button>
            </td></tr>))}</tbody></table>
          <div className="border-t border-line px-3 py-2"><Pagination total={d.data.total} limit={LIMIT} page={page} onPage={setPage} itemLabel="délibération" /></div></div>)}
      {ouvert && <Fiche acteId={ouvert} onClose={() => setOuvert(null)} onDone={() => { setOuvert(null); d.reload(); }} />}
      {node}
    </div>
  );
}
