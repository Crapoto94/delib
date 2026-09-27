import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Markdown } from '../legal/Markdown';
import cgu from '../legal/CGU.md?raw';
import licence from '../legal/LICENCE.md?raw';

/** Pages publiques des documents juridiques : conditions d'utilisation et licence d'usage. */
export default function Legal({ doc }: { doc: 'cgu' | 'licence' }) {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = doc === 'cgu' ? 'Conditions générales d\'utilisation — VibeDélib' : 'Licence d\'usage — VibeDélib';
    window.scrollTo({ top: 0 });
  }, [doc, pathname]);
  const onglet = (actif: boolean) => `rounded px-3 py-1.5 text-[13px] font-semibold ${actif ? 'bg-action-solid text-white' : 'text-slate-600 hover:bg-soft'}`;
  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="text-[16px] font-bold text-head">VibeDélib</Link>
          <span className="text-[12px] text-mute">Documents juridiques</span>
          <nav className="ml-auto flex gap-1" aria-label="Documents juridiques">
            <Link to="/cgu" className={onglet(doc === 'cgu')}>CGU</Link>
            <Link to="/licence" className={onglet(doc === 'licence')}>Licence</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="card p-6 md:p-8">
          <Markdown source={doc === 'cgu' ? cgu : licence} />
        </article>
        <p className="mt-4 text-center text-[12px] text-mute">
          <Link to="/" className="underline hover:text-ink">Retour à l'application</Link>
        </p>
      </main>
    </div>
  );
}
