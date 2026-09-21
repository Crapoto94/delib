import { FormEvent, useMemo, useRef, useState } from 'react';
import { BookOpen, Send, Sparkles } from 'lucide-react';
import manifest from '../legal/MANIFEST.md?raw';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { useIa } from '../useIa';
import { Loading, PageTitle, Spinner } from '../ui';

type Morceau = { titre: string; texte: string; norm: string };
type Message = { role: 'user' | 'assistant'; texte: string; sources?: string[] };

const sansAccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STOP = new Set(['avec', 'dans', 'pour', 'plus', 'sont', 'cette', 'cettes', 'elle', 'elles', 'nous', 'vous', 'etre', 'avoir', 'fait', 'quel', 'quelle', 'quels', 'quelles', 'comment', 'quoi', 'qui', 'que', 'des', 'les', 'une', 'aux', 'sur', 'par', 'pas', 'est', 'son', 'ses', 'lui', 'ils', 'leur', 'votre', 'notre', 'tout', 'tous', 'toute', 'toutes', 'mais', 'donc', 'ou', 'et', 'en', 'au', 'du', 'de', 'la', 'le', 'un', 'il', 'je', 'tu', 'on', 'ne', 'se', 'ce', 'sa', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'ces', 'puis', 'peut', 'peuvent', 'doit', 'doivent', 'faire', 'faut', 'comme', 'aussi', 'bien', 'tres', 'sans', 'sous', 'vers', 'chez', 'elle']);

/** Découpe le manifeste en morceaux par titre (niveaux 1 à 3), avec fil d'Ariane. */
function decouper(md: string): Morceau[] {
  const lignes = md.replace(/\r\n/g, '\n').split('\n');
  const out: { titre: string; texte: string }[] = [];
  const fil: string[] = []; let buf: string[] = [];
  const pousser = () => { const texte = buf.join('\n').trim(); if (texte) out.push({ titre: fil.filter(Boolean).join(' › ') || 'Manifeste', texte }); buf = []; };
  for (const l of lignes) {
    const m = /^(#{1,3})\s+(.*)$/.exec(l);
    if (m) { pousser(); const n = m[1].length; fil.length = Math.min(fil.length, n - 1); fil[n - 1] = m[2].trim(); }
    else buf.push(l);
  }
  pousser();
  return out.filter((c) => c.texte.length > 40).map((c) => ({ ...c, norm: sansAccent(`${c.titre} ${c.texte}`) }));
}

const mots = (question: string) => [...new Set(sansAccent(question).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];

/** Sélectionne les extraits du manifeste les plus proches de la question (recherche lexicale, sans IA). */
function choisir(index: Morceau[], question: string, max = 6): Morceau[] {
  const qs = mots(question);
  if (!qs.length) return index.slice(0, 3);
  const notes = index.map((c) => {
    let score = 0;
    for (const q of qs) { const n = c.norm.split(q).length - 1; if (n) score += Math.min(n, 5); if (sansAccent(c.titre).includes(q)) score += 3; }
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const choisis: Morceau[] = []; let taille = 0;
  for (const { c } of notes) { if (choisis.length >= max) break; if (choisis.length && taille + c.texte.length > 14000) break; choisis.push(c); taille += c.texte.length; }
  return choisis.length ? choisis : index.slice(0, 3);
}

/**
 * Aide IA du centre d'aide : toute question est confrontée au manifeste de l'application (MANIFEST.md),
 * dont les extraits pertinents sont envoyés à l'IA ; la réponse s'appuie UNIQUEMENT sur ces extraits.
 */
export default function AideIa() {
  const { org } = useAuth(); const o = org!.id;
  const ia = useIa();
  const index = useMemo(() => decouper(manifest), []);
  const [question, setQuestion] = useState('');
  const [fil, setFil] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  const poser = async () => {
    const q = question.trim(); if (q.length < 3 || busy) return;
    setErr(null); setBusy(true); setQuestion('');
    const extraits = choisir(index, q);
    setFil((f) => [...f, { role: 'user', texte: q }]);
    try {
      const r = (await api.post(orgPath(o, '/ia/manifeste'), { question: q, extraits: extraits.map(({ titre, texte }) => ({ titre, texte })) })).data;
      setFil((f) => [...f, { role: 'assistant', texte: r.reponse, sources: extraits.map((x) => x.titre) }]);
    } catch (x) {
      setErr(errMsg(x));
      setFil((f) => [...f, { role: 'assistant', texte: "Je n'ai pas pu répondre (IA indisponible ou désactivée). Reformulez ou réessayez plus tard." }]);
    } finally { setBusy(false); window.setTimeout(() => fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60); }
  };
  const demander = (e: FormEvent) => { e.preventDefault(); void poser(); };

  const exemples = ['Comment envoyer un dossier au circuit ?', 'À quoi sert la bibliothèque de visas ?', 'Comment fonctionne la télétransmission à la préfecture ?', 'Que voit un élu dans l’espace élus ?'];

  return (
    <div>
      <PageTitle title="Aide IA" sub="Posez votre question : la réponse s'appuie uniquement sur le manifeste de l'application." />
      {!ia.loaded ? <Loading /> : !ia.aide ? (
        <div className="card p-6 text-slate-700">L'<b>aide IA</b> est désactivée par l'administration de votre collectivité. Vous pouvez consulter les autres aides du centre d'aide.</div>
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
