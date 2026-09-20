import { NavLink } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Badge, PageTitle } from '../ui';
import { MenuLateral, menu } from '../pages/Admin';
import { ThemeSwitch, ThemeToggle } from '../theme';

/** Banc d'essai visuel (développement uniquement : /dev/design) : en-tête, menu latéral, cartes, tableau, badges, formulaire — sans connexion. */
export default function DevDesign() {
  const tab = ({ isActive }: { isActive: boolean }) => `rounded px-3 py-2 text-[13px] font-semibold transition-colors ${isActive ? 'bg-action-solid text-white shadow-lift' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;
  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-30 border-b border-line bg-surface shadow-card">
        <div className="accent-bar" aria-hidden="true" />
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2 md:px-8">
          <span className="leading-tight"><span className="block text-[16px] font-bold text-head">VibeDélib</span><span className="block text-[10px] uppercase tracking-wider text-mute">Ville d'Ivry-sur-Seine</span></span>
          <form className="ml-auto flex min-w-0 max-w-sm flex-1 items-center rounded bg-soft px-3"><Search className="h-4 w-4 text-mute" /><input className="w-full bg-transparent px-2 py-2 outline-none" placeholder="Rechercher…" /></form>
          <ThemeToggle />
        </div>
        <div className="bg-gradient-to-r from-nav-from to-nav-to"><div className="mx-auto max-w-[1400px] px-4 md:px-8"><nav className="flex gap-1 py-1">
          <NavLink to="/dev/design" end className={tab}>Tableau de bord</NavLink><NavLink to="/x1" className={tab}>Actes & Dossiers</NavLink><NavLink to="/x2" className={tab}>Séances</NavLink><NavLink to="/x3" className={tab}>Paramétrages</NavLink>
        </nav></div></div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
        <PageTitle title="Paramétrages" sub="Banc d'essai du thème." actions={<><button className="btn-secondary">Annuler</button><button className="btn-primary">Enregistrer</button></>} />
        <div className="grid gap-6 md:grid-cols-[250px_minmax(0,1fr)]">
          <MenuLateral groupes={menu(true, true)} />
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">{[['Actes en cours', 28, 'text-head'], ['Validés', 14, 'text-ok'], ['À viser', 6, 'text-action'], ['Hors délai', 2, 'text-ko']].map(([l, v, c]) => <div key={l as string} className="card p-4"><div className="text-[12px] text-mute">{l}</div><div className={`text-[28px] font-bold ${c}`}>{v}</div></div>)}</div>
            <div className="card overflow-x-auto"><table className="w-full"><thead><tr><th>Dossier</th><th>Direction</th><th>Statut</th><th /></tr></thead><tbody>
              <tr><td className="font-semibold">ZAC Ivry Confluences — avenant n°4</td><td>Urbanisme</td><td><Badge tone="warn">En circuit</Badge></td><td><button className="btn-ok">Viser</button></td></tr>
              <tr><td className="font-semibold">Tableau des effectifs</td><td>Ressources humaines</td><td><Badge tone="ko">À corriger</Badge></td><td><button className="btn-ko">Rejeter</button></td></tr>
              <tr><td className="font-semibold">Subventions aux associations</td><td>Culture</td><td><Badge tone="ok">Prêt</Badge> <Badge tone="blue">Séance 22/10</Badge> <Badge>Brouillon</Badge></td><td><button className="btn-secondary">Ouvrir</button></td></tr>
            </tbody></table></div>
            <div className="card space-y-3 p-5"><h3>Formulaire</h3>
              <div className="grid gap-3 md:grid-cols-2"><label className="block"><span className="label">Nom</span><input className="input" defaultValue="Ville d'Ivry" /></label><label className="block"><span className="label">Choix</span><select className="input"><option>Option</option></select></label></div>
              <p className="rounded border border-warn/30 bg-warn-bg px-3 py-2 text-warn">Avertissement d'exemple.</p><p className="rounded border border-ko/30 bg-ko-bg px-3 py-2 text-ko">Erreur d'exemple.</p><p className="rounded border border-ok/30 bg-ok-bg px-3 py-2 text-ok-text">Succès d'exemple.</p>
              <ThemeSwitch />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
