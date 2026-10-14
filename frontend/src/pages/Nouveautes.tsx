import { PageTitle } from '../ui';
import { VERSION } from '../nouveautes';
import { BoutonsDemande, JournalVersions } from '../JournalVersions';

export default function Nouveautes() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Nouveautés" sub={<>Ce qui a été livré, version par version, avec sa date. Version courante : <b>{VERSION}</b> (application en 0.x.y avant la mise en production).</>} />
      <div className="mb-4"><BoutonsDemande /></div>
      <p className="mb-6 text-[13px] leading-relaxed text-mute">
        Convention avant la production : <b>x</b> (version mineure) pour l'ajout d'un module ou d'une fonctionnalité, <b>y</b> (correctif) pour une correction, un débogage ou une amélioration sans nouveau module. La version <b>1.0.0</b> sera la version de production.
      </p>
      <JournalVersions />
    </div>
  );
}
