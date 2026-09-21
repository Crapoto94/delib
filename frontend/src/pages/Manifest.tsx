import { useEffect, useMemo } from 'react';
import manifest from '../legal/MANIFEST.md?raw';
import { Markdown } from '../legal/Markdown';

type Section = { id: string; titre: string; corps: string };

/** Découpe le manifeste : chapeau introductif puis une entrée de sommaire par titre de niveau 2. */
function decouper(md: string): { intro: string; sommaire: Section[] } {
  const lignes = md.replace(/\r\n/g, '\n').split('\n');
  const debut = lignes.findIndex((l) => /^##\s+/.test(l));
  if (debut < 0) return { intro: md, sommaire: [] };
  const sommaire: Section[] = [];
  let courant: Section | null = null;
  for (const ligne of lignes.slice(debut)) {
    const titre = /^##\s+(.*)$/.exec(ligne);
    if (titre) {
      courant = { id: `sec-${sommaire.length}`, titre: titre[1].trim(), corps: '' };
      sommaire.push(courant);
    } else if (courant) {
      courant.corps += (courant.corps ? '\n' : '') + ligne;
    }
  }
  return { intro: lignes.slice(0, debut).join('\n'), sommaire };
}

/** Affiche le manifeste de l'application (MANIFEST.md) mis en forme, avec sommaire. */
export default function Manifest() {
  const { intro, sommaire } = useMemo(() => decouper(manifest), []);
  useEffect(() => { document.title = 'Manifeste de l\'application — VibeDélib'; window.scrollTo({ top: 0 }); }, []);
  const aller = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav aria-label="Sommaire du manifeste" className="card sticky top-24 max-h-[70vh] overflow-auto p-3">
          <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-mute">Sommaire</p>
          <ol className="space-y-0.5">
            {sommaire.map((s) => (
              <li key={s.id}>
                <button onClick={() => aller(s.id)} className="w-full rounded px-2 py-1 text-left text-[12px] leading-4 text-slate-600 hover:bg-soft hover:text-head">
                  {s.titre}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <article className="card min-w-0 p-5 md:p-8">
        <Markdown source={intro} />
        {sommaire.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-28">
            <h2 className="mb-3 mt-9 border-b border-line pb-1 text-[19px] leading-7 text-head">{s.titre}</h2>
            <Markdown source={s.corps} />
          </section>
        ))}
      </article>
    </div>
  );
}
