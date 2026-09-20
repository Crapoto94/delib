import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, Check, FileText, MapPin, Paperclip, ScrollText } from 'lucide-react';
import { OrgLogo } from '../Brand';
import { PdfViewerHost, showPdf } from '../PdfViewer';
import { dt } from '../format';

/**
 * Page du convoqué, ouverte par son LIEN PERSONNEL (/c/<jeton>) — sans connexion. L'ouverture de la page, la consultation de la
 * convocation et de l'ordre du jour, l'accusé de lecture et la réponse de présence sont enregistrés pour ce convoqué.
 */
const api = (tok: string, path = '') => `/api/v1/public/convocations/${encodeURIComponent(tok)}${path}`;

export default function ConvocationPublique() {
  const { token = '' } = useParams();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState(''); const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(api(token)).then(async (r) => { const j = await r.json().catch(() => ({})); if (!live) return; if (r.ok) setD(j); else setErr(r.status === 404 ? "Ce lien n'est pas valide." : (j.error || 'Erreur')); }).catch(() => live && setErr('Service indisponible, réessayez plus tard.'));
    return () => { live = false; };
  }, [token]);
  useEffect(() => { document.title = d ? `Convocation — ${d.seance.instance}` : 'Convocation'; }, [d]);

  const refresh = async () => { const r = await fetch(api(token)); if (r.ok) setD(await r.json()); };
  // les ouvertures de PDF sont enregistrées côté serveur (chaque appel = une consultation)
  const open = async (kind: 'convocation' | 'odj') => {
    setBusy(kind);
    try { const r = await fetch(api(token, kind === 'odj' ? '/ordre-du-jour.pdf' : '/convocation.pdf')); if (!r.ok) throw new Error(); showPdf(await r.blob(), kind === 'odj' ? "Ordre du jour" : 'Convocation'); await refresh(); } catch { setMsg('Document indisponible.'); } finally { setBusy(null); }
  };
  // pièce jointe d'un dossier : PDF dans la visionneuse, autres fichiers téléchargés (chaque ouverture est enregistrée)
  const piece = async (f: { id: number; titre: string; nom: string; mime: string }) => {
    try {
      const r = await fetch(api(token, `/pieces/${f.id}`)); if (!r.ok) throw new Error();
      const blob = await r.blob();
      if (f.mime === 'application/pdf') showPdf(blob, f.titre); else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.nom; a.click(); }
    } catch { setMsg('Pièce jointe indisponible.'); }
  };
  const post = async (path: string, body?: unknown) => {
    const r = await fetch(api(token, path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur');
    await refresh();
  };

  if (err) return <Shell><div role="alert" className="card mx-auto max-w-lg p-6 text-center"><h2>Convocation</h2><p className="mt-2 text-mute">{err}</p></div></Shell>;
  if (!d) return <Shell><p className="text-center text-mute">Chargement…</p></Shell>;
  const c = d.convocation;
  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-3"><OrgLogo orgId={d.organisme.id} nom={d.organisme.nom} hasLogo={d.organisme.hasLogo} version={d.organisme.logoVersion} className="h-14" /><div><div className="text-[12px] uppercase tracking-wider text-mute">{d.organisme.nom}</div><h1 className="text-[22px] font-bold text-primary">{c.modificatif ? 'Convocation modifiée' : 'Convocation'}</h1></div></div>
        {d.remplacee && <div role="status" className="rounded border border-warn/30 bg-warn-bg px-4 py-3 text-warn">Une version plus récente de cette convocation (v{d.remplacee.version}) a été envoyée : consultez le dernier mail reçu.</div>}
        {d.seance.annulee && <div role="alert" className="rounded border border-ko/30 bg-ko-bg px-4 py-3 text-ko">Cette séance a été annulée.</div>}
        <section className="card p-5">
          <p className="text-mute">{d.convoque.nom}{d.convoque.qualite ? ` — ${d.convoque.qualite}` : ''}</p>
          <h2 className="mt-1">{d.seance.instance}</h2>
          <div className="mt-2 flex flex-wrap gap-4 text-[14px]"><span className="flex items-center gap-1"><CalendarDays className="h-4 w-4 text-action" /> {dt(d.seance.dateSeance, { dateStyle: 'full', timeStyle: 'short' })}</span>{d.seance.lieu && <span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-action" /> {d.seance.lieu}</span>}</div>
          {c.urgence && <p className="mt-3 rounded bg-warn-bg px-3 py-2 text-warn"><b>Convocation adressée en urgence</b> — {c.urgenceMotif}</p>}
          {c.message && <p className="mt-3 whitespace-pre-wrap">{c.message}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!busy} onClick={() => open('convocation')}><FileText className="h-4 w-4" /> Consulter la convocation {d.lu.convocation && <Check className="h-4 w-4" />}</button>
            <button className="btn-secondary" disabled={!!busy} onClick={() => open('odj')}><ScrollText className="h-4 w-4" /> Consulter l'ordre du jour {d.lu.odj && <Check className="h-4 w-4 text-ok" />}</button>
          </div>
        </section>
        {c.differences && (c.differences.ajoutes.length + c.differences.retires.length > 0) && (
          <section className="card p-5"><h3>Modifications de l'ordre du jour</h3><ul className="mt-2 list-disc pl-5 text-[14px]">{c.differences.ajoutes.map((x: string) => <li key={`a${x}`}>Ajouté : {x}</li>)}{c.differences.retires.map((x: string) => <li key={`r${x}`}>Retiré : {x}</li>)}</ul></section>)}
        <section className="card p-5"><h3>Ordre du jour</h3>
          <ol className="mt-2 space-y-2 text-[14px]">{d.ordreDuJour.map((p: any, i: number) => p.kind === 'chapitre'
            ? <li key={i} className="pt-2 text-[12px] font-bold uppercase tracking-wider text-primary">{p.titre}</li>
            : <li key={i} className="flex gap-3"><span className="w-24 shrink-0 font-mono text-[13px] font-bold text-primary">{p.numero ?? '·'}</span><span className="min-w-0"><b>{p.titre}</b>{p.rapporteur && <span className="block text-[12px] text-mute">Rapporteur : {p.rapporteur}{p.rubrique ? ` · ${p.rubrique}` : ''}</span>}
                {p.description && <span className="mt-1 block whitespace-pre-wrap text-[13px] text-slate-700">{p.description}</span>}
                {p.fichiers?.length > 0 && <span className="mt-1 flex flex-wrap gap-2">{p.fichiers.map((f: any) => <button key={f.id} className="inline-flex items-center gap-1 rounded-full bg-soft px-3 py-1 text-[12px] font-semibold hover:bg-slate-200" onClick={() => piece(f)}><Paperclip className="h-3.5 w-3.5" />{f.titre}</button>)}</span>}</span></li>)}</ol></section>
        <section className="card p-5">
          <h3>Votre réponse</h3>
          {d.reponse && <p className="mt-2 rounded bg-emerald-50 px-3 py-2 text-ok">Vous avez répondu : <b>{d.reponse.reponse === 'present' ? 'présent(e)' : 'absent(e) excusé(e)'}</b> le {dt(d.reponse.at, { dateStyle: 'short', timeStyle: 'short' })}. Vous pouvez la modifier.</p>}
          <textarea className="input mt-3 min-h-[60px]" placeholder="Commentaire (facultatif)" value={commentaire} maxLength={500} onChange={(e) => setCommentaire(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ok" disabled={d.seance.annulee} onClick={() => post('/reponse', { reponse: 'present', commentaire }).catch((e) => setMsg(e.message))}>Je serai présent(e)</button>
            <button className="btn-secondary" disabled={d.seance.annulee} onClick={() => post('/reponse', { reponse: 'absent', commentaire }).catch((e) => setMsg(e.message))}>Je serai absent(e) excusé(e)</button>
            <button className="btn-secondary ml-auto" disabled={!!d.lu.accuseAt} onClick={() => post('/accuse').catch((e) => setMsg(e.message))}>{d.lu.accuseAt ? <><Check className="h-4 w-4 text-ok" /> Prise de connaissance enregistrée</> : "J'ai pris connaissance"}</button>
          </div>
          {msg && <p role="alert" className="mt-2 text-ko">{msg}</p>}
        </section>
        <p className="text-center text-[11px] text-mute">Ce lien vous est personnel : merci de ne pas le transférer. Son ouverture et la consultation des documents sont enregistrées.</p>
      </div>
      <PdfViewerHost />
    </Shell>
  );
}

const Shell = ({ children }: { children: React.ReactNode }) => <div className="min-h-screen bg-page px-4 py-8">{children}</div>;
