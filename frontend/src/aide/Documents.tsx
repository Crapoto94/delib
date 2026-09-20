import { ReactNode, useEffect, useState } from 'react';
import { Download, Eye, FileCode2 } from 'lucide-react';
import { api, blobErrMsg, errMsg, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { mdToHtml } from '../mdconv';
import { ErrorBox, Loading, useToast } from '../ui';
import { Encadre } from './ui';

type Doc = { kind: string; titre: string; resume: string; markdown: string };

/** Rendu du Markdown des documents techniques : titres, listes et gras (le reste est confié à mdToHtml). */
function RenduMarkdown({ md }: { md: string }) {
  const noeuds: ReactNode[] = [];
  let tampon: string[] = [];
  const vider = () => {
    if (!tampon.length) return;
    noeuds.push(<div key={noeuds.length} className="doc-md" dangerouslySetInnerHTML={{ __html: mdToHtml(tampon.join('\n')) }} />);
    tampon = [];
  };
  md.replace(/\r\n/g, '\n').split('\n').forEach((ligne) => {
    const m = /^(#{1,4})\s+(.*)$/.exec(ligne);
    if (!m) { tampon.push(ligne); return; }
    vider();
    const niveau = m[1].length;
    if (niveau === 1) return; // le titre du document est déjà affiché par la carte
    noeuds.push(niveau === 2
      ? <h3 key={noeuds.length} className="mt-6">{m[2]}</h3>
      : <h4 key={noeuds.length} className="mt-4 text-[15px] font-bold text-head">{m[2]}</h4>);
  });
  vider();
  return <div>{noeuds}</div>;
}

export default function Documents() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.get(orgPath(o, '/aide/documents')).then((r) => setDocs(r.data.items)).catch((e) => setErr(errMsg(e)));
  }, [o]);

  const voir = async (d: Doc) => { const m = await openPdf(() => api.get(orgPath(o, `/aide/documents/${d.kind}/pdf`), { responseType: 'blob' }), d.titre); if (m) toast(`Aperçu impossible : ${m}`, 'ko'); };
  const telecharger = async (d: Doc) => {
    try {
      const r = await api.get(orgPath(o, `/aide/documents/${d.kind}/pdf`), { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a'); a.href = url; a.download = `${d.kind}-vibedelib.pdf`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast(`Téléchargement impossible : ${await blobErrMsg(e)}`, 'ko'); }
  };

  if (err) return <ErrorBox msg={err} />;
  if (!docs) return <Loading />;
  return (
    <div className="space-y-6">
      <Encadre type="info" titre="Documents générés par l'application">
        Ces documents décrivent l'application telle qu'elle est déployée (version, date, environnement). Ils se mettent à jour d'eux-mêmes et sont exportables en PDF au gabarit de votre collectivité.
      </Encadre>
      {docs.map((d) => (
        <section key={d.kind} className="card p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-head"><FileCode2 className="h-5 w-5" /></span>
              <div><h2 className="text-[18px]">{d.titre}</h2><p className="text-[13px] text-mute">{d.resume}</p></div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => voir(d)}><Eye className="h-4 w-4" /> Aperçu</button>
              <button className="btn-primary" onClick={() => telecharger(d)}><Download className="h-4 w-4" /> Télécharger en PDF</button>
            </div>
          </div>
          <RenduMarkdown md={d.markdown} />
        </section>
      ))}
      {node}
    </div>
  );
}
