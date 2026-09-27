import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiBaseForInstance, instanceUrl, setInstanceUrl, session } from './api';
import { purger } from './docs';
import { OrgLogo } from './Brand';
import { ThemeToggle } from './theme';

const INSTANCE_PAR_DEFAUT = 'https://vibedelib.ivry94.fr/elus';

export default function Instance({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState(instanceUrl() || INSTANCE_PAR_DEFAUT);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const choisir = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErreur(null);
    try {
      const base = apiBaseForInstance(url);
      const r = await fetch(`${base}/elus-auth/etat`, { cache: 'no-store' });
      const body = await r.json().catch(() => null);
      if (!r.ok || body?.ok !== true) throw new Error('Cette adresse ne répond pas au service de l’espace élus.');
      await purger();
      session.clear();
      setInstanceUrl(url);
      onSaved();
    } catch (x: any) {
      setErreur(x instanceof TypeError ? 'Impossible de joindre cette instance. Vérifiez l’adresse, le réseau et l’autorisation d’accès de l’APK.' : (x?.message || 'Impossible de vérifier cette instance.'));
    } finally { setBusy(false); }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-nav-from to-nav-to px-4 py-8">
      <div className="absolute right-3 top-3"><ThemeToggle className="text-white/80 hover:bg-white/10 hover:text-white" /></div>
      <section className="w-full max-w-xl rounded-2xl border border-line border-t-4 border-t-action-solid bg-surface p-6 shadow-float sm:p-9">
        <div className="mb-7 text-center">
          <OrgLogo className="mx-auto mb-3 h-14" />
          <p className="text-[13px] font-semibold uppercase tracking-widest text-mute">VibeDélib · tablette</p>
          <h1 className="mt-2 text-[26px]">Choisir l’instance</h1>
          <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-mute">Saisissez l’adresse publiée de l’espace élus. Vous pourrez changer d’instance depuis l’application.</p>
        </div>
        <form onSubmit={choisir} className="space-y-4">
          {erreur && <div role="alert" className="rounded border border-ko/30 bg-ko-bg px-3 py-2 text-[14px] text-ko">{erreur}</div>}
          <label className="block">
            <span className="label">Adresse de l’instance</span>
            <input className="input !py-3 !text-[16px]" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={INSTANCE_PAR_DEFAUT} />
          </label>
          <p className="text-[13px] text-mute">Exemple : <b>https://vibedelib.ivry94.fr/elus</b></p>
          <button className="btn-primary w-full !py-3 !text-[16px]" disabled={busy}>{busy ? 'Vérification…' : 'Vérifier et utiliser cette instance'}</button>
          {instanceUrl() && <button type="button" className="w-full py-2 text-center text-[14px] text-mute" onClick={() => nav(-1)}>Annuler</button>}
        </form>
      </section>
    </main>
  );
}
