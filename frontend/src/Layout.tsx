import { AgentName } from './AgentName';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, Eye, LogOut, Search } from 'lucide-react';
import AgentPicker from './AgentPicker';
import { Modal, useToast } from './ui';
import { OrgLogo, useFavicon } from './Brand';
import { AiChip } from './AiStatus';
import Visite from './Visite';
import { AideMenu } from './aide/Aide';
import { VERSION } from './nouveautes';
import { PdfViewerHost } from './PdfViewer';
import { useAuth } from './auth';
import { api, org as orgPath } from './api';
import { dt } from './format';
import { ThemeSwitch, ThemeToggle } from './theme';

function Bells({ orgId }: { orgId: number }) {
  const [data, setData] = useState<any>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const load = () => api.get(orgPath(orgId, '/notifications'), { params: { limit: 15 } }).then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [orgId]);
  const go = async (n: any) => {
    await api.post(orgPath(orgId, `/notifications/${n.id}/lue`)).catch(() => {}); setOpen(false); load();
    if (n.link && String(n.link).startsWith('/recherche')) nav(n.link); // alerte de recherche : ouvre la recherche
    else if (n.acteId) nav(`/dossiers/${n.acteId}`);
  };
  return (
    <div className="relative">
      <button className="relative rounded p-2 hover:bg-slate-100" aria-label={`Notifications (${data.unread} non lues)`} onClick={() => { setOpen(!open); load(); }}>
        <Bell className="h-5 w-5" />
        {data.unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ko-solid px-1 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-96 max-w-[90vw] shadow-float">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <h3>Notifications</h3>
            <button className="text-[12px] font-semibold text-action" onClick={async () => { await api.post(orgPath(orgId, '/notifications/lues')); load(); }}>Tout marquer comme lu</button>
          </div>
          <ul className="max-h-96 overflow-auto">
            {data.items.length === 0 && <li className="p-6 text-center text-mute">Rien de nouveau.</li>}
            {data.items.map((n: any) => (
              <li key={n.id}><button onClick={() => go(n)} className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-soft ${n.read ? 'opacity-60' : ''}`}>
                <div className="font-semibold">{n.title}</div><div className="line-clamp-2 text-[12px] text-mute">{n.body}</div><div className="mt-1 text-[11px] text-mute">{dt(n.createdAt)}</div>
              </button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const tab = ({ isActive }: { isActive: boolean }) => `rounded px-3 py-2 text-[13px] font-semibold transition-colors ${isActive ? 'bg-action-solid text-white shadow-lift' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;

export default function Layout() {
  const { me, org, setOrg, logout, isAdmin, isScc, startActAs, stopActAs } = useAuth();
  const [asOpen, setAsOpen] = useState(false); const [asUser, setAsUser] = useState(''); const { toast, node: toastNode } = useToast();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const [tour, setTour] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  // raccourci « / » : place le curseur dans la recherche, sauf si on est déjà en train de saisir
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || t?.closest('input, textarea, select, [contenteditable=true]')) return;
      e.preventDefault(); (document.getElementById('recherche-globale') as HTMLInputElement | null)?.focus();
    };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, []);
  useFavicon(org ? { organismeId: org.id, nom: org.nom, hasLogo: !!org.hasLogo, logoVersion: org.logoVersion ?? null } : null);
  if (!me || !org) return null;
  return (
    <div className="min-h-screen pb-16">
      {me.impersonation && (
        <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-3 bg-warn-solid px-4 py-2 text-[13px] font-semibold text-white">
          <Eye className="h-4 w-4" /> Vous voyez VibeDélib en tant que <AgentName u={me.username} /> — vos actions sont faites avec ses droits et journalisées à votre nom.
          <button className="rounded bg-surface px-3 py-1 text-warn" onClick={stopActAs}>Revenir à mon compte (<AgentName u={me.impersonation.by} />)</button>
        </div>)}
      <header className="sticky top-0 z-30 border-b border-line bg-surface shadow-card">
        <div className="accent-bar" aria-hidden="true" />
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2 md:px-8">
          <NavLink to="/" className="flex items-center gap-2">
            <OrgLogo orgId={org.id} nom={org.nom} hasLogo={!!org.hasLogo} version={org.logoVersion ?? null} className="h-10" />
            <span className="leading-tight"><span className="block text-[16px] font-bold text-head">VibeDélib</span><span className="block text-[10px] uppercase tracking-wider text-mute">{org.nom}</span></span>
          </NavLink>
          <form data-tour="recherche" className="ml-auto flex min-w-0 max-w-sm flex-1 items-center rounded bg-soft px-3" onSubmit={(e) => { e.preventDefault(); nav(`/recherche?q=${encodeURIComponent(q)}`); }}>
            <Search className="h-4 w-4 text-mute" /><input id="recherche-globale" aria-label="Rechercher un acte" title="Raccourci : /" className="w-full min-w-0 bg-transparent px-2 py-2 outline-none" placeholder="Rechercher (raccourci /)…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          {me.organismes.length > 1 && (
            <select aria-label="Organisme" className="input w-auto" value={org.id} onChange={(e) => { setOrg(Number(e.target.value)); nav('/'); }}>
              {me.organismes.map((o) => <option key={o.id} value={o.id}>{o.nom}</option>)}
            </select>
          )}
          <AiChip />
          <AideMenu />
          <ThemeToggle />
          <span data-tour="notifications"><Bells orgId={org.id} /></span>
          <div className="relative" ref={ref} data-tour="menu-utilisateur">
            <button className="flex items-center gap-2 rounded p-1 hover:bg-slate-100" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">{me.displayName.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span className="hidden text-left leading-tight md:block"><span className="block text-[12px] font-semibold">{me.displayName}</span><span className="block text-[11px] text-mute">{me.agent?.poste || me.agent?.direction?.label || (me.isPlatformAdmin ? 'Administrateur' : '')}</span></span>
              <ChevronDown className="h-4 w-4" />
            </button>
            {menu && <div role="menu" className="card absolute right-0 z-40 mt-2 w-56 p-1 shadow-float">
              {me.canImpersonate && !me.impersonation && <button role="menuitem" onClick={() => { setMenu(false); setAsOpen(true); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-soft"><Eye className="h-4 w-4" /> Afficher en tant que…</button>}
              <div className="px-2 pb-2 pt-1"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-mute">Apparence</span><ThemeSwitch /></div>
              <NavLink role="menuitem" to="/delegations" onClick={() => setMenu(false)} className="block rounded px-3 py-2 hover:bg-soft">Mes délégations</NavLink>
              <NavLink role="menuitem" to="/preferences" onClick={() => setMenu(false)} className="block rounded px-3 py-2 hover:bg-soft">Mes notifications</NavLink>
              <NavLink role="menuitem" to="/nouveautes" onClick={() => setMenu(false)} className="block rounded px-3 py-2 hover:bg-soft">Nouveautés</NavLink>
              <button role="menuitem" onClick={() => { setMenu(false); setTour(true); }} className="block w-full rounded px-3 py-2 text-left hover:bg-soft">Revoir la visite</button>
              <button role="menuitem" onClick={async () => { await logout(); nav('/connexion'); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-soft"><LogOut className="h-4 w-4" /> Se déconnecter</button>
            </div>}
          </div>
        </div>
        <div className="bg-gradient-to-r from-nav-from to-nav-to"><div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <nav className="flex gap-1 overflow-x-auto py-1" aria-label="Navigation principale">
            <NavLink to="/" end className={tab} data-tour="nav-dashboard">Tableau de bord</NavLink>
            <NavLink to="/dossiers" className={tab} data-tour="nav-dossiers">Actes & Dossiers</NavLink>
            <NavLink to="/seances" className={tab} data-tour="nav-seances">Séances & Ordre du jour</NavLink>
            <NavLink to="/commissions" className={tab} data-tour="nav-commissions">Commissions</NavLink>
            {(isAdmin || isScc || org?.roles?.includes('teletransmission')) && <NavLink to="/controle-legalite" className={tab} data-tour="nav-cdl">Contrôle de légalité</NavLink>}
            {(isAdmin || isScc) && <NavLink to="/admin" className={tab} data-tour="nav-admin">Paramétrages</NavLink>}
          </nav>
        </div></div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8"><Outlet /></main>
      <PdfViewerHost />
      <Visite ouverte={tour} onFermer={() => setTour(false)} />
      {asOpen && (
        <Modal title="Afficher en tant que…" onClose={() => setAsOpen(false)}>
          <p className="mb-3 text-mute">Choisissez un utilisateur : vous aurez <b>exactement ses droits</b> (ce qu'il voit, ce qu'il peut faire). Chaque action est journalisée à votre nom.</p>
          <AgentPicker value={asUser} onChange={setAsUser} label="Utilisateur" placeholder="Tapez @nom ou un prénom…" autoFocus />
          <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setAsOpen(false)}>Annuler</button>
            <button className="btn-primary" disabled={!asUser} onClick={async () => { try { await startActAs(asUser); } catch (e: any) { toast(e?.response?.data?.error || 'Impossible', 'ko'); } }}>Afficher</button></div>
        </Modal>)}
      {toastNode}
      <footer className="fixed bottom-0 left-0 right-0 border-t border-line bg-surface px-6 py-2 text-[11px] text-mute">
        Ville d'Ivry-sur-Seine · VibeDélib — version {VERSION}
      </footer>
    </div>
  );
}
