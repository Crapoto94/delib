import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Paperclip, X } from 'lucide-react';
import { api, apiBase, errMsg } from '../api';
import { dt } from '../format';

const PAR_PAGE = 10;

/** Adresse d'un document : l'API renvoie des chemins /api/v1/… ; la base peut être celle d'une instance (APK). */
const lien = (u: string) => `${apiBase}${u.replace(/^\/api\/v1/, '')}`;

/** Fenêtre modale : liste des annexes d'une délibération. Échap ou clic hors de la fenêtre pour fermer. */
function ModaleAnnexes({ item, onClose }: { item: any; onClose: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Annexes" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded bg-surface p-5 shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><h2 className="text-[15px] font-semibold text-head">Annexes ({item.annexes.length})</h2><p className="text-[12px] text-mute">{item.numero ? `${item.numero} — ` : ''}{item.titre}</p></div>
          <button className="rounded p-1 text-mute hover:bg-black/5" onClick={onClose} aria-label="Fermer"><X className="h-5 w-5" /></button>
        </div>
        <ul className="space-y-2">
          {item.annexes.map((a: any) => (
            <li key={a.url}><a className="flex items-center gap-2 rounded border border-line p-2 text-action hover:bg-black/5" href={lien(a.url)} target="_blank" rel="noreferrer"><Paperclip className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{a.titre}</span></a></li>))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Page PUBLIQUE (sans connexion), nue : faite pour être incrustée dans une iframe, servie à /deliberations.
 * Délibérations exécutoires des derniers mois, paginées : texte de la délibération et pièces jointes publiables (« x annexes » ouvre la liste).
 * Jamais l'exposé des motifs, ni acte non exécutoire ou confidentiel (filtré côté serveur). Désactivée tant que l'administrateur ne l'a pas activée.
 */
export default function Deliberations() {
  const [mois, setMois] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [charge, setCharge] = useState(true);
  const [annexes, setAnnexes] = useState<any>(null);
  useEffect(() => {
    let vivant = true; setCharge(true); setErr(null);
    api.get('/public/deliberations', { params: { ...(mois ? { mois } : {}), page, limit: PAR_PAGE } })
      .then((r) => { if (vivant) setData(r.data); })
      .catch((e) => { if (vivant) { setData(null); setErr(e?.response?.status === 404 ? 'La publication des délibérations n’est pas activée.' : errMsg(e)); } })
      .finally(() => { if (vivant) setCharge(false); });
    return () => { vivant = false; };
  }, [mois, page]);

  const parSeance = useMemo(() => {
    const m = new Map<string, { cle: string; libelle: string; items: any[] }>();
    const liste: any[] = data?.items ?? [];
    for (const i of liste) {
      const cle = i.seance ? `${i.seance.date}|${i.seance.instance}` : 'sans';
      const g = m.get(cle) ?? { cle, libelle: i.seance ? `${i.seance.instance} du ${dt(i.seance.date, { dateStyle: 'long' })}` : 'Autres actes', items: [] as any[] };
      g.items.push(i); m.set(cle, g);
    }
    return [...m.values()];
  }, [data]);
  const choix = [1, 3, 6, 12, 24].filter((n) => !data || n <= Math.max(data.mois, 1));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAR_PAGE)) : 1;

  return (
    <div className="px-1 py-1">
      <main>
        {data && choix.length > 1 && (
          <label className="mb-4 flex items-center gap-2 text-[13px]"><span className="text-mute">Période</span>
            <select className="input !w-auto !py-1" value={mois ?? data.mois} onChange={(e) => { setMois(Number(e.target.value)); setPage(1); }}>{choix.map((n) => <option key={n} value={n}>{n === 1 ? '1 mois' : n === 12 ? '1 an' : n === 24 ? '2 ans' : `${n} mois`}</option>)}</select></label>)}
        {err && <p role="alert" className="rounded bg-surface p-4 text-mute shadow-card">{err}</p>}
        {charge && !data && !err && <p className="text-mute">Chargement…</p>}
        {data && !parSeance.length && <p className="rounded bg-surface p-4 text-mute shadow-card">Aucune délibération sur cette période.</p>}
        {parSeance.map((g) => (
          <section key={g.cle} className="mb-6">
            <h2 className="mb-2 text-[15px] font-semibold text-head">{g.libelle}</h2>
            <ul className="space-y-2">
              {g.items.map((i) => (
                <li key={i.pdf} className="rounded bg-surface p-4 shadow-card">
                  <div className="font-semibold text-head">{i.numero ? `${i.numero} — ` : ''}{i.titre}</div>
                  <div className="mt-0.5 text-[12px] text-mute">{[i.matiere, i.rapporteur && `Rapporteur : ${i.rapporteur}`, i.resultat].filter(Boolean).join(' · ')}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a className="btn-secondary !py-1" href={lien(i.pdf)} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" /> Délibération (PDF)</a>
                    {i.annexes.length > 0 && <button type="button" className="text-[13px] text-action underline" onClick={() => setAnnexes(i)}>{i.annexes.length} annexe{i.annexes.length > 1 ? 's' : ''}</button>}
                  </div>
                </li>))}
            </ul>
          </section>))}
        {data && pages > 1 && (
          <nav className="mt-2 flex items-center justify-center gap-3 text-[13px]" aria-label="Pagination">
            <button className="btn-secondary !py-1" disabled={page <= 1 || charge} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /> Précédent</button>
            <span className="text-mute">Page {page} sur {pages} · {data.total} délibération{data.total > 1 ? 's' : ''}</span>
            <button className="btn-secondary !py-1" disabled={page >= pages || charge} onClick={() => setPage(page + 1)}>Suivant <ChevronRight className="h-4 w-4" /></button>
          </nav>)}
      </main>
      {annexes && <ModaleAnnexes item={annexes} onClose={() => setAnnexes(null)} />}
    </div>
  );
}
