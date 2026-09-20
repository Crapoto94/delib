import { Sparkles } from 'lucide-react';
import { PageTitle, Badge } from '../ui';
import { VERSION, VERSIONS } from '../nouveautes';

export default function Nouveautes() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Nouveautés" sub={<>Ce qui a été livré, version par version. Version courante : <b>{VERSION}</b> (application en 0.x.y avant la mise en production).</>} />
      <p className="mb-6 text-[13px] leading-relaxed text-mute">
        Convention avant la production : <b>x</b> (version mineure) pour l'ajout d'un module ou d'une fonctionnalité, <b>y</b> (correctif) pour une correction, un débogage ou une amélioration sans nouveau module. La version <b>1.0.0</b> sera la version de production.
      </p>
      <ol className="space-y-4">
        {VERSIONS.map((v) => (
          <li key={v.version} className="card p-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[15px] font-bold text-primary">{v.version}</span>
              <Badge tone={v.type === 'minor' ? 'blue' : 'gray'}>{v.type === 'minor' ? 'Nouveauté' : 'Correctif'}</Badge>
              <span className="font-semibold text-slate-800">{v.titre}</span>
              {v.version === VERSION && <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-ok"><Sparkles className="h-3.5 w-3.5" /> Actuelle</span>}
            </div>
            <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-700">
              {v.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
