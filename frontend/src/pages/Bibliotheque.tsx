import { FormEvent, useState } from 'react';
import { BookOpen, FileText, Search } from 'lucide-react';
import { api, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Loading, Modal, PageTitle, useLoad, useToast } from '../ui';

/** Fiche de consultation d'une délibération adoptée : exposé des motifs, visas, dispositif, annexes, et les PDF (visionneuse). */
function Fiche({ acteId, onClose }: { acteId: number; onClose: () => void }) {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, `/bibliotheque/actes/${acteId}`))).data, [acteId]);
  const pdf = async (cible: string, titre: string) => { const m = await openPdf(() => api.get(orgPath(o, `/bibliotheque/actes/${acteId}/pdf`), { params: { cible }, responseType: 'blob' }), titre); if (m) toast(m, 'ko'); };
  const f = d.data;
  return (
    <Modal title={f ? `${f.numero ? `${f.numero} — ` : ''}${f.titre}` : 'Délibération'} onClose={onClose} wide>
      {d.loading ? <Loading /> : !f ? <ErrorBox msg={d.error} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Badge tone="ok">{f.resultatLabel}</Badge><span className="text-mute">Séance du {dt(f.seance.dateSeance, { dateStyle: 'long' })} · {f.seance.instance}{f.matiere ? ` · ${f.matiere}` : ''}{f.direction ? ` · ${f.direction}` : ''}</span>
          </div>
          <div className="flex flex-wrap gap-2">{f.documents.map((x: any) => <button key={x.cible} className="btn-secondary" onClick={() => pdf(x.cible, `${x.label} — ${f.titre}`)}><FileText className="h-4 w-4" /> {x.label}</button>)}</div>
          {[['Exposé des motifs', f.expose], ['Visas et considérants', f.visas], ['Dispositif', f.dispositif]].map(([t, md]) => md ? (
            <section key={t}><h3 className="mb-1">{t}</h3><div className="whitespace-pre-wrap rounded border border-line bg-soft/40 p-3 text-[13px] leading-6">{md}</div></section>) : null)}
          {f.annexes.length > 0 && <section><h3 className="mb-1">Annexes publiables</h3><ul className="list-disc pl-5 text-[13px]">{f.annexes.map((x: any) => <li key={x.id}>{x.titre}</li>)}</ul></section>}
          <p className="text-[12px] text-mute">Consultation seule. Pour suivre le parcours d’un dossier auquel vous avez participé, ouvrez <b>Mes actes</b>.</p>
        </div>)}
      {node}
    </Modal>
  );
}

/** Bibliothèque des actes de la collectivité (REC-30) : recherche et consultation des délibérations adoptées, ouverte à tous les agents. */
export default function Bibliotheque() {
  const { org } = useAuth(); const o = org!.id;
  const [q, setQ] = useState(''); const [annee, setAnnee] = useState(''); const [applique, setApplique] = useState({ q: '', annee: '' }); const [ouvert, setOuvert] = useState<number | null>(null);
  const d = useLoad(async () => (await api.get(orgPath(o, '/bibliotheque'), { params: { q: applique.q || undefined, annee: applique.annee || undefined, limit: 50 } })).data, [o, applique]);
  const chercher = (e: FormEvent) => { e.preventDefault(); setApplique({ q, annee }); };
  const ans = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  return (
    <div>
      <PageTitle title="Bibliothèque des actes" sub="Les délibérations adoptées de la collectivité (séances closes) : texte, exposé des motifs, extrait du registre. Consultation ouverte à tous les agents." />
      <form onSubmit={chercher} className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="flex min-w-0 flex-1 items-center rounded bg-soft px-3"><Search className="h-4 w-4 text-mute" /><input className="w-full min-w-0 bg-transparent px-2 py-2 outline-none" aria-label="Rechercher dans la bibliothèque" placeholder="Mots du titre, de l’objet, de l’exposé… ou n° de délibération" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input w-auto" aria-label="Année de la séance" value={annee} onChange={(e) => setAnnee(e.target.value)}><option value="">Toutes les années</option>{ans.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <button className="btn-primary">Rechercher</button>
      </form>
      {d.loading && !d.data ? <Loading /> : !d.data ? <ErrorBox msg={d.error} /> : !d.data.items.length ? <div className="card"><Empty>Aucune délibération adoptée ne correspond.</Empty></div> : (
        <div className="card overflow-x-auto"><table className="w-full"><thead><tr><th>N°</th><th>Délibération</th><th>Séance</th><th>Résultat</th><th /></tr></thead><tbody>{d.data.items.map((r: any) => (
          <tr key={r.acteId}><td className="font-mono text-[12px]">{r.numero ?? '—'}</td><td><b>{r.titre}</b><div className="text-[12px] text-mute">{[r.matiere, r.direction].filter(Boolean).join(' · ')}</div></td>
            <td className="text-[12px]">{dt(r.dateSeance, { dateStyle: 'medium' })}<div className="text-mute">{r.instance}</div></td><td><Badge tone="ok">{r.resultatLabel}</Badge></td>
            <td className="text-right"><button className="btn-secondary !py-1" onClick={() => setOuvert(r.acteId)}><BookOpen className="h-3.5 w-3.5" /> Consulter</button></td></tr>))}</tbody></table>
          <p className="border-t border-line px-3 py-2 text-[12px] text-mute">{d.data.total} délibération(s){d.data.total > d.data.items.length ? ` — les ${d.data.items.length} plus pertinentes ou récentes` : ''}</p></div>)}
      {ouvert && <Fiche acteId={ouvert} onClose={() => setOuvert(null)} />}
    </div>
  );
}
