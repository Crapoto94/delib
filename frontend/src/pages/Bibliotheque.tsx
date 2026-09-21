import { FormEvent, useState } from 'react';
import { BookOpen, FileText, Search, SlidersHorizontal } from 'lucide-react';
import { api, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Pagination, PageTitle, useLoad, useToast } from '../ui';
import { Select } from '../Select';

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

type Filtres = { q: string; annee: string; matiereId: string; natureId: string; rubriqueId: string; directionCode: string; rapporteurId: string; instanceId: string; du: string; au: string };
const VIDES: Filtres = { q: '', annee: '', matiereId: '', natureId: '', rubriqueId: '', directionCode: '', rapporteurId: '', instanceId: '', du: '', au: '' };

/** Bibliothèque des actes de la collectivité (REC-30) : recherche simple (mots, année) et recherche avancée (thématique, nature, rubrique, direction, rapporteur, instance, période). */
export default function Bibliotheque() {
  const { org } = useAuth(); const o = org!.id;
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
      q: applique.q || undefined, annee: applique.annee || undefined, matiereId: applique.matiereId || undefined, natureId: applique.natureId || undefined,
      rubriqueId: applique.rubriqueId || undefined, directionCode: applique.directionCode || undefined, rapporteurId: applique.rapporteurId || undefined,
      instanceId: applique.instanceId || undefined, du: applique.du || undefined, au: applique.au || undefined, limit: LIMIT, offset: (page - 1) * LIMIT,
    },
  })).data, [o, applique, page]);
  const chercher = (e: FormEvent) => { e.preventDefault(); setPage(1); setApplique(f); };
  const reinit = () => { setF(VIDES); setPage(1); setApplique(VIDES); };
  const actifs = Object.entries(applique).filter(([k, v]) => k !== 'q' && v).length;
  const ans = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  const maj = (k: keyof Filtres) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div>
      <PageTitle title="Bibliothèque des actes" sub="Les délibérations adoptées de la collectivité (séances closes) : texte, exposé des motifs, extrait du registre. Consultation ouverte à tous les agents." />
      <form onSubmit={chercher} className="card mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded bg-soft px-3"><Search className="h-4 w-4 text-mute" /><input className="w-full min-w-0 bg-transparent px-2 py-2 outline-none" aria-label="Rechercher dans la bibliothèque" placeholder="Mots du titre, de l’objet, de l’exposé… ou n° de délibération" value={f.q} onChange={maj('q')} /></div>
          <Select className="input w-auto" aria-label="Année de la séance" value={f.annee} onChange={maj('annee')}><option value="">Toutes les années</option>{ans.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
          <button className="btn-primary">Rechercher</button>
          <button type="button" className="btn-secondary" aria-expanded={avance} onClick={() => setAvance((v) => !v)}><SlidersHorizontal className="h-4 w-4" /> Recherche avancée{actifs > 0 ? ` (${actifs})` : ''}</button>
          {(actifs > 0 || f.q) && <button type="button" className="btn-secondary" onClick={reinit}>Réinitialiser</button>}
        </div>
        {avance && (
          <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Thématique (matière)"><Select className="input" value={f.matiereId} onChange={maj('matiereId')}><option value="">Toutes</option>{(matieres.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</Select></Field>
            <Field label="Nature"><Select className="input" value={f.natureId} onChange={maj('natureId')}><option value="">Toutes</option>{(natures.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</Select></Field>
            <Field label="Rubrique"><Select className="input" value={f.rubriqueId} onChange={maj('rubriqueId')}><option value="">Toutes</option>{(rubriques.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</Select></Field>
            <Field label="Direction"><Select className="input" value={f.directionCode} onChange={maj('directionCode')}><option value="">Toutes</option>{(directions.data ?? []).map((x: any) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select></Field>
            <Field label="Rapporteur"><Select className="input" value={f.rapporteurId} onChange={maj('rapporteurId')}><option value="">Tous</option>{(elus.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{`${x.prenom ?? ''} ${x.nom ?? ''}`.trim()}</option>)}</Select></Field>
            <Field label="Instance"><Select className="input" value={f.instanceId} onChange={maj('instanceId')}><option value="">Toutes</option>{(instances.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.nom}</option>)}</Select></Field>
            <Field label="Conseil à partir du"><input className="input" type="date" value={f.du} onChange={maj('du')} /></Field>
            <Field label="Jusqu’au"><input className="input" type="date" value={f.au} onChange={maj('au')} /></Field>
          </div>
        )}
      </form>
      {d.loading && !d.data ? <Loading /> : !d.data ? <ErrorBox msg={d.error} /> : !d.data.items.length ? <div className="card"><Empty>Aucune délibération adoptée ne correspond.</Empty></div> : (
        <div className="card overflow-x-auto"><table className="w-full"><thead><tr><th>N°</th><th>Délibération</th><th>Rapporteur</th><th>Séance</th><th>Résultat</th><th /></tr></thead><tbody>{d.data.items.map((r: any) => (
          <tr key={r.acteId}><td className="font-mono text-[12px]">{r.numero ?? '—'}</td><td><b>{r.titre}</b><div className="text-[12px] text-mute">{[r.matiere, r.direction].filter(Boolean).join(' · ')}</div></td>
            <td className="text-[12px]">{r.rapporteur ?? '—'}</td>
            <td className="text-[12px]">{dt(r.dateSeance, { dateStyle: 'medium' })}<div className="text-mute">{r.instance}</div></td><td><Badge tone="ok">{r.resultatLabel}</Badge></td>
            <td className="text-right"><button className="btn-secondary !py-1" onClick={() => setOuvert(r.acteId)}><BookOpen className="h-3.5 w-3.5" /> Consulter</button></td></tr>))}</tbody></table>
          <div className="border-t border-line px-3 py-2"><Pagination total={d.data.total} limit={LIMIT} page={page} onPage={setPage} itemLabel="délibération" /></div></div>)}
      {ouvert && <Fiche acteId={ouvert} onClose={() => setOuvert(null)} />}
    </div>
  );
}
