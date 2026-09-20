import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { api, errMsg } from '../api';
import { dt } from '../../format';

/** Recherche dans les délibérations adoptées de mes séances (titre, objet, dispositif) : ni brouillon, ni annexe, ni note. */
export default function Recherche() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || '';
  const [saisie, setSaisie] = useState(q);
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const chercher = async (terme: string) => {
    if (terme.trim().length < 2) { setRes(null); return; }
    setBusy(true); setErr(null);
    try { setRes((await api.get('/elus/recherche', { params: { q: terme.trim() } })).data); } catch (e) { setErr(errMsg(e)); setRes(null); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); setSp(saisie.trim() ? { q: saisie.trim() } : {}); chercher(saisie); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (q) chercher(q); }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-5">
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-[13px] text-action"><ArrowLeft className="h-4 w-4" /> Retour</Link>
      <form onSubmit={submit} className="mb-4 flex items-center gap-2 rounded bg-white p-2 shadow-card" role="search">
        <Search className="ml-1 h-5 w-5 text-mute" />
        <input aria-label="Rechercher une délibération" className="min-w-0 flex-1 bg-transparent px-1 py-2 outline-none" autoFocus placeholder="Rechercher une délibération adoptée…" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
        <button className="btn-primary" disabled={busy}>Chercher</button>
      </form>
      {err && <p role="alert" className="mb-3 text-ko">{err}</p>}
      {res && (
        <>
          <p className="mb-2 text-[13px] text-mute">{res.total} délibération{res.total > 1 ? 's' : ''} adoptée{res.total > 1 ? 's' : ''}{res.approchee ? ' (résultats approchants)' : ''}</p>
          <ul className="space-y-2">
            {res.items.map((r: any) => (
              <li key={r.acteId} className="rounded bg-white p-4 shadow-card">
                <Link to={`/seances/${r.seanceId}`} className="font-semibold text-primary hover:underline">{r.titre}</Link>
                <div className="mt-0.5 text-[12px] text-mute">{r.numero ? `Délibération ${r.numero} · ` : ''}{r.instance}{r.dateSeance ? ` du ${dt(r.dateSeance)}` : ''}{r.resultat ? ` · ${r.resultat.libelle}` : ''}</div>
                {/* extrait échappé côté serveur : seules les balises <mark> subsistent */}
                {r.extrait && <p className="mt-2 text-[13px] [&_mark]:rounded [&_mark]:bg-yellow-200 [&_mark]:px-0.5" dangerouslySetInnerHTML={{ __html: r.extrait }} />}
              </li>))}
          </ul>
        </>)}
    </main>
  );
}
