import { FormEvent, useRef, useState } from 'react';
import { BookOpen, Send, Sparkles } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { useIa } from '../useIa';
import { chargerExtraits } from '../aideIa';
import { NotationReponse } from '../Notation';
import { Loading, PageTitle, Spinner } from '../ui';

type Message = { role: 'user' | 'assistant'; texte: string; sources?: string[]; id?: number | null };

/** Aide IA du centre d'aide : toute question est confrontée au manifeste, dont les extraits pertinents sont envoyés à l'IA. */
export default function AideIa() {
  const { org } = useAuth(); const o = org!.id;
  const ia = useIa();
  const [question, setQuestion] = useState('');
  const [fil, setFil] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  const poser = async () => {
    const q = question.trim(); if (q.length < 3 || busy) return;
    setErr(null); setBusy(true); setQuestion('');
    setFil((f) => [...f, { role: 'user', texte: q }]);
    try {
      const extraits = await chargerExtraits(q);
      const r = (await api.post(orgPath(o, '/ia/manifeste'), { question: q, extraits })).data;
      setFil((f) => [...f, { role: 'assistant', texte: r.reponse, sources: extraits.map((x) => x.titre), id: r.id ?? null }]);
    } catch (x) {
      setErr(errMsg(x));
      setFil((f) => [...f, { role: 'assistant', texte: "Je n'ai pas pu répondre (IA indisponible ou désactivée). Reformulez ou réessayez plus tard." }]);
    } finally { setBusy(false); window.setTimeout(() => fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60); }
  };
  const demander = (e: FormEvent) => { e.preventDefault(); void poser(); };

  const exemples = ['Comment envoyer un dossier au circuit ?', 'À quoi sert la bibliothèque de visas ?', 'Comment fonctionne la télétransmission à la préfecture ?', 'Que voit un élu dans l’espace élus ?'];

  return (
    <div>
      <PageTitle title="Evelyne Del-IA" sub="Posez votre question : la réponse s'appuie sur le manifeste de l'application." />
      {!ia.loaded ? <Loading /> : !ia.aide ? (
        <div className="card p-6 text-slate-700"><b>Evelyne Del-IA</b> est désactivée par l'administration de votre collectivité. Vous pouvez consulter les autres aides du centre d'aide.</div>
      ) : (
        <div className="mx-auto max-w-3xl">
          <div className="card flex min-h-[50vh] flex-col p-4">
            <div className="flex-1 space-y-4">
              {!fil.length && (
                <div className="py-6 text-center">
                  <Sparkles className="mx-auto h-8 w-8 text-action" />
                  <p className="mt-2 text-slate-700">Posez une question sur le fonctionnement de VibeDélib. Réponses fondées sur le <b>manifeste</b> uniquement.</p>
                  <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2">
                    {exemples.map((ex) => <button key={ex} type="button" className="rounded-full border border-line bg-soft px-3 py-1 text-[12px] text-slate-700 hover:border-action hover:text-action" onClick={() => setQuestion(ex)}>{ex}</button>)}
                  </div>
                </div>
              )}
              {fil.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  <div className={m.role === 'user' ? 'max-w-[85%] rounded-lg bg-primary px-4 py-2 text-white' : 'max-w-full rounded-lg border border-line bg-surface px-4 py-3'}>
                    <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{m.texte}</div>
                    {m.sources?.length ? (
                      <div className="mt-2 border-t border-line pt-2 text-[11px] text-mute">
                        <span className="flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> Extraits du manifeste utilisés :</span>
                        <ul className="mt-1 list-disc pl-5">{m.sources.map((s, k) => <li key={k}>{s}</li>)}</ul>
                      </div>) : null}
                    {typeof m.id === 'number' && <NotationReponse journalId={m.id} />}
                  </div>
                </div>
              ))}
              {busy && <div className="flex items-center gap-2 text-mute"><Spinner /> Recherche dans le manifeste…</div>}
              {err && <div role="alert" className="rounded border border-ko/30 bg-ko-bg px-3 py-2 text-[13px] text-ko">{err}</div>}
              <div ref={fin} />
            </div>
            <form onSubmit={demander} className="mt-4 flex items-end gap-2 border-t border-line pt-3">
              <textarea className="input min-h-[44px] resize-y" rows={2} placeholder="Votre question…" value={question} onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void poser(); } }} aria-label="Votre question" />
              <button className="btn-primary" disabled={busy || question.trim().length < 3}>{busy && <Spinner />} <Send className="h-4 w-4" /> Demander</button>
            </form>
          </div>
          <p className="mt-3 text-center text-[12px] text-mute">Réponses générées à partir du manifeste — relisez-les, elles ne remplacent pas les consignes de votre collectivité.</p>
        </div>
      )}
    </div>
  );
}
