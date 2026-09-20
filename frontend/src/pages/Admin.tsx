import { FormEvent, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowLeftRight, Bell, Building2, CalendarDays, ChevronDown, ChevronRight, DatabaseBackup, FileText, GitBranch, HardDrive, KeyRound, Landmark, ListPlus, Menu, Network, RefreshCw, Scale, Search, Send, Settings2, ShieldCheck, Smartphone, Sparkles, Trash2, Users, type LucideIcon } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, MailSwitch, Empty, ErrorBox, Field, Loading, Modal, PageTitle, useLoad, useToast } from '../ui';
import { Gabarits, Identite, Utilisateurs } from './AdminExtra';
import AdminGed from './AdminGed';
import AdminTdt from './AdminTdt';
import AdminMembres from './AdminMembres';
import AdminSauvegarde from './AdminSauvegarde';
import AdminCles from './AdminCles';
import AdminRgpd from './AdminRgpd';
import { AdminChamps, AdminConfiguration } from './AdminParametrage';
import AdminRecherche from './AdminRecherche';
import AdminElus from './AdminElus';
import AdminIa from './AdminIa';
import AgentPicker, { AgentList } from '../AgentPicker';
import Collectivites from './Collectivites';
import Organisation from './Organisation';
import { VisibiliteGenerale } from '../VisibiliteActes';
import Circuits from './CircuitEditor';
import { AgentName } from '../AgentName';

const FONCTIONS: Record<string, string> = { responsable_intermediaire: 'Responsable intermédiaire', chef_service: 'Chef de service', directeur: 'Directeur', dga: 'DGA', dgs: 'DGS' };

/* ---------------------------------------------------------------------------------------------- titulaires & droits */
function Titulaires() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const dirs = useLoad(async () => (await api.get('/directory/directions')).data.items as any[], []);
  const tit = useLoad(async () => (await api.get(orgPath(o, '/titulaires'))).data.items as any[], [o]);
  const grp = useLoad(async () => (await api.get(orgPath(o, '/groupes'))).data.items as any[], [o]);
  const aut = useLoad(async () => (await api.get(orgPath(o, '/redaction/autorisations'))).data.items as any[], [o]);
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/settings'))).data.settings as Record<string, { value: any }>, [o]);
  const riOn = cfg.data?.['circuit.resp_intermediaire']?.value === true;
  const [f, setF] = useState({ fonction: 'chef_service', username: '', directionCode: '', serviceCode: '' }); const [err, setErr] = useState<string | null>(null);
  const [a, setA] = useState({ username: '', directionCode: '', serviceCode: '' });
  const services = dirs.data?.find((x) => x.code === f.directionCode)?.services ?? [];
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.post(orgPath(o, '/titulaires'), { fonction: f.fonction, username: f.username.trim().toLowerCase(), directionCode: f.directionCode || undefined, serviceCode: f.serviceCode || undefined }); setF({ ...f, username: '' }); tit.reload(); toast('Titulaire ajouté'); } catch (x) { setErr(errMsg(x)); }
  };
  const grant = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post(orgPath(o, '/redaction/autorisations'), { username: a.username.trim().toLowerCase(), directionCode: a.directionCode, serviceCode: a.serviceCode || undefined }); setA({ ...a, username: '' }); aut.reload(); toast('Autorisation accordée'); } catch (x) { toast(errMsg(x), 'ko'); }
  };
  const label = (code?: string) => dirs.data?.find((x) => x.code === code)?.label ?? code ?? 'Toute la collectivité';
  return (
    <div className="space-y-6">
      <Organisation />
      <VisibiliteGenerale toast={toast} />
      <section className="card p-5"><h3 className="mb-2">Responsable intermédiaire</h3>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={riOn} disabled={cfg.loading} onChange={async (e) => { try { await api.put(orgPath(o, '/settings/circuit.resp_intermediaire'), { value: e.target.checked, scope: 'organisme' }); cfg.reload(); toast(e.target.checked ? 'Étape « Responsable intermédiaire » activée' : 'Étape « Responsable intermédiaire » désactivée'); } catch (x) { toast(errMsg(x), 'ko'); } }} />
          <span><b>Activer l’étape « Responsable intermédiaire » dans les circuits</b><br /><span className="text-[12px] text-mute">Facultative et décochée par défaut : tant qu’elle est décochée, l’étape est ignorée même si des titulaires sont saisis ci-dessous. Une fois activée, elle n’est déclenchée que si un titulaire est désigné pour le service.</span></span></label>
      </section>
      <details className="card p-5"><summary className="cursor-pointer text-[15px] font-bold">Saisie avancée des titulaires <span className="text-[12px] font-normal text-mute">— table complète, tous périmètres</span></summary><div className="mt-3"><h3 className="mb-3">Titulaires des fonctions de validation</h3>
        <form onSubmit={add} className="mb-4 grid gap-3 md:grid-cols-5 md:items-end"><ErrorBox msg={err} />
          <Field label="Fonction"><select className="input" value={f.fonction} onChange={(e) => setF({ ...f, fonction: e.target.value })}>{Object.entries(FONCTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Agent (@nom)"><AgentPicker value={f.username} onChange={(u) => setF({ ...f, username: u })} required /></Field>
          <Field label="Direction"><select className="input" value={f.directionCode} onChange={(e) => setF({ ...f, directionCode: e.target.value, serviceCode: '' })}><option value="">(toutes — DGS)</option>{dirs.data?.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
          <Field label="Service"><select className="input" value={f.serviceCode} onChange={(e) => setF({ ...f, serviceCode: e.target.value })} disabled={!f.directionCode}><option value="">(toute la direction)</option>{services.map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></Field>
          <button className="btn-primary">Ajouter</button>
        </form>
        {tit.loading ? <Loading /> : !tit.data?.length ? <Empty>Aucun titulaire désigné : les étapes obligatoires bloqueront l'envoi des actes.</Empty> : (
          <table className="w-full"><thead><tr><th>Fonction</th><th>Agent</th><th>Périmètre</th><th /></tr></thead><tbody>{tit.data.map((t) => (
            <tr key={t.id}><td className="font-semibold">{FONCTIONS[t.fonction]}</td><td>{t.vacant ? <Badge tone="warn">Poste vacant</Badge> : <AgentName u={t.username} />}{t.suppleant && <span className="text-mute"> (suppl. <AgentName u={t.suppleant} />)</span>}</td>
              <td>{label(t.directionCode)}{t.serviceCode ? ` › ${dirs.data?.find((x) => x.code === t.directionCode)?.services?.find((s: any) => s.code === t.serviceCode)?.label ?? t.serviceCode}` : ''}</td>
              <td className="text-right"><button aria-label="Retirer" className="text-ko" onClick={async () => { await api.delete(orgPath(o, `/titulaires/${t.id}`)); tit.reload(); }}><Trash2 className="h-4 w-4" /></button></td></tr>))}</tbody></table>)}
      </div></details>

      <section className="card p-5"><h3 className="mb-3">Autorisations de rédaction hors direction</h3>
        <form onSubmit={grant} className="mb-4 grid gap-3 md:grid-cols-4 md:items-end">
          <Field label="Agent autorisé (@nom)"><AgentPicker value={a.username} onChange={(u) => setA({ ...a, username: u })} required /></Field>
          <Field label="Direction"><select className="input" required value={a.directionCode} onChange={(e) => setA({ ...a, directionCode: e.target.value, serviceCode: '' })}><option value="">— choisir —</option>{dirs.data?.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
          <Field label="Service (facultatif)"><select className="input" value={a.serviceCode} onChange={(e) => setA({ ...a, serviceCode: e.target.value })}><option value="">Toute la direction</option>{dirs.data?.find((x) => x.code === a.directionCode)?.services?.map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></Field>
          <button className="btn-primary">Autoriser</button>
        </form>
        {!aut.data?.length ? <p className="text-mute">Aucune autorisation étendue. Par défaut, un agent rédige pour sa propre direction.</p> : (
          <table className="w-full"><thead><tr><th>Agent</th><th>Périmètre</th><th>Accordée par</th><th /></tr></thead><tbody>{aut.data.map((g) => (
            <tr key={g.id}><td><AgentName u={g.username} /></td><td>{label(g.directionCode)}{g.serviceCode ? ` › ${g.serviceCode}` : ''}</td><td><AgentName u={g.grantedBy} /></td><td className="text-right"><button aria-label="Révoquer" className="text-ko" onClick={async () => { await api.delete(orgPath(o, `/redaction/autorisations/${g.id}`)); aut.reload(); }}><Trash2 className="h-4 w-4" /></button></td></tr>))}</tbody></table>)}
      </section>

      <section className="card p-5"><h3 className="mb-3">Groupes de valideurs (Service financier, juridique, SCC…)</h3>
        {grp.loading ? <Loading /> : <div className="grid gap-4 md:grid-cols-3">{grp.data?.map((g) => <GroupeCard key={g.id} g={g} o={o} reload={grp.reload} toast={toast} />)}</div>}
      </section>{node}
    </div>
  );
}

function GroupeCard({ g, o, reload, toast }: { g: any; o: number; reload: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const [members, setMembers] = useState<string[]>(g.membres as string[]);
  const save = async () => { try { await api.put(orgPath(o, `/groupes/${g.id}/membres`), { usernames: members }); toast('Groupe enregistré'); reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  return <div className="rounded border border-line p-3"><b>{g.nom}</b> <span className="text-[11px] text-mute">({g.code})</span>
    <div className="mt-2"><AgentList value={members} onChange={setMembers} /></div><button className="btn-secondary mt-2" onClick={save}>Enregistrer</button></div>;
}

/* -------------------------------------------------------------------------------------------------------- circuits */
/* --------------------------------------------------------------------------------------------- règles de notification */
const withMail = (channels: string[], mail: boolean): string[] => (mail ? [...new Set([...channels, 'inapp', 'mail'])] : (channels.filter((c) => c !== 'mail').length ? channels.filter((c) => c !== 'mail') : ['inapp']));

function Regles() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const r = useLoad(async () => (await api.get(orgPath(o, '/notifications/regles'))).data, [o]);
  const dash = useLoad(async () => (await api.get(orgPath(o, '/notifications/tableau'))).data, [o]);
  const [edit, setEdit] = useState<any>(null);
  const setMail = async (x: any, mail: boolean) => {
    try { await api.put(orgPath(o, `/notifications/regles/${x.code}`), { channels: withMail(x.channels ?? ['inapp', 'mail'], mail) }); toast(mail ? 'Notification par e-mail et dans l’outil' : 'Notification dans l’outil seulement (pas de mail)'); r.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const save = async () => { try { await api.put(orgPath(o, `/notifications/regles/${edit.code}`), { subject: edit.subject, body: edit.body, enabled: edit.enabled, channels: edit.channels }); toast('Règle enregistrée'); setEdit(null); r.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  return (
    <div className="space-y-6">
      {dash.data && <div className="grid gap-4 md:grid-cols-4">
        {[['Envoyés (7 j)', dash.data.last7Days.sent ?? 0], ['En échec', dash.data.last7Days.failed ?? 0], ['Actes sans titulaire', dash.data.blocked.length], ['Bloqués > 10 j', dash.data.stuckMoreThan10Days.length]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><div className="text-[12px] text-mute">{l}</div><div className="text-[28px] font-bold text-head">{v}</div></div>))}</div>}
      <div className="card">{r.loading ? <Loading /> : (
        <table className="w-full"><thead><tr><th>Règle</th><th>Type</th><th>Famille</th><th>État</th><th title="Décoché : la notification reste dans l’outil, aucun mail n’est envoyé">Par e-mail</th><th /></tr></thead><tbody>{r.data.items.map((x: any) => (
          <tr key={x.code}><td><b>{x.nom}</b><div className="text-[11px] text-mute">{x.code}{x.origin === 'organisme' && ' · personnalisée'}</div></td><td>{x.kind === 'event' ? 'Événement' : 'Relance'}</td><td>{r.data.families[x.family]?.label}</td>
            <td>{x.enabled ? <Badge tone="ok">active</Badge> : <Badge>désactivée</Badge>}{x.mandatory && <Badge tone="warn"> obligatoire</Badge>}</td>
            <td><span className="flex items-center gap-2"><MailSwitch on={(x.channels ?? []).includes('mail')} onChange={(v) => setMail(x, v)} label={`Envoyer aussi par e-mail : ${x.nom}`} /><span className="text-[11px] text-mute">{(x.channels ?? []).includes('mail') ? 'mail + outil' : 'outil seulement'}</span></span></td><td className="text-right"><button className="btn-secondary" onClick={() => setEdit({ ...x })}>Modifier</button></td></tr>))}</tbody></table>)}</div>
      {edit && <Modal title={edit.nom} onClose={() => setEdit(null)} wide><div className="space-y-4">
        {edit.palliers?.length > 0 && <p className="rounded bg-soft p-2 text-[12px]">Paliers : {edit.palliers.map((p: any) => p.id).join(' → ')} (jours ouvrés, 8 h – 18 h). Destinataires : {edit.recipients.join(', ')}</p>}
        <Field label="Objet"><input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
        <Field label="Corps" hint="Variables : {titre} {numero} {etape} {lien} {redacteur} {acteur} {motif} {echeance} {retard}"><textarea className="input" rows={7} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
        <label className="flex items-center gap-3"><MailSwitch on={(edit.channels ?? []).includes('mail')} onChange={(v) => setEdit({ ...edit, channels: withMail(edit.channels ?? ['inapp', 'mail'], v) })} label="Envoyer aussi par e-mail" /><span>Envoyer aussi par <b>e-mail</b> <span className="text-[12px] text-mute">— désactivé : la notification n’apparaît que dans l’outil (cloche)</span></span></label>
        {!edit.mandatory && <label className="flex items-center gap-2"><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Règle active</label>}
        <div className="flex justify-between"><button className="btn-secondary" onClick={async () => { try { await api.post(orgPath(o, `/notifications/regles/${edit.code}/test`), {}); toast('Mail de test envoyé'); } catch (e) { toast(errMsg(e), 'ko'); } }}>M'envoyer un test</button><button className="btn-primary" onClick={save}>Enregistrer</button></div></div></Modal>}{node}
    </div>
  );
}

/* --------------------------------------------------------------------------------------------------------- élus */
/* --------------------------------------------------------------------------------------------------- jours fériés */
function Calendrier() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const list = useLoad(async () => (await api.get(orgPath(o, '/calendrier/jours-feries'))).data.items as any[], [o]);
  const year = new Date().getFullYear();
  return (
    <div className="space-y-4"><p className="text-mute">Les jours fériés sont exclus du calcul des délais (jours ouvrés) et des relances.</p>
      <div className="flex gap-2">{[year, year + 1].map((y) => <button key={y} className="btn-secondary" onClick={async () => { await api.post(orgPath(o, '/calendrier/jours-feries/generer'), { year: y }); toast(`Jours fériés ${y} générés`); list.reload(); }}>Générer {y}</button>)}</div>
      <div className="card">{list.loading ? <Loading /> : !list.data?.length ? <Empty>Aucun jour férié défini.</Empty> : <table className="w-full"><tbody>{list.data.map((h) => <tr key={h.id}><td className="w-48 font-mono">{dt(h.day, { dateStyle: 'full' })}</td><td>{h.label}</td><td className="text-right">{h.origin === 'organisme' && <button className="text-ko" onClick={async () => { await api.delete(orgPath(o, `/calendrier/jours-feries/${h.id}`)); list.reload(); }}><Trash2 className="h-4 w-4" /></button>}</td></tr>)}</tbody></table>}</div>{node}</div>
  );
}

type Entree = { k: string; label: string; icon: LucideIcon };
export type Groupe = { titre: string; entrees: Entree[] };

/** Menu latéral des paramétrages (UI-05, D100) : entrées groupées par thème, selon les droits de la personne. */
export function menu(isAdmin: boolean, plateforme: boolean): Groupe[] {
  const g: Groupe[] = [
    { titre: 'Organisme', entrees: [
      { k: 'identite', label: 'Identité & logo', icon: Building2 }, { k: 'utilisateurs', label: 'Utilisateurs & rôles', icon: Users },
      { k: 'titulaires', label: 'Titulaires & droits', icon: ShieldCheck }, { k: 'calendrier', label: 'Jours fériés', icon: CalendarDays }] },
    { titre: 'Circuits et rédaction', entrees: [
      { k: 'circuits', label: 'Circuits', icon: GitBranch }, { k: 'gabarits', label: 'Gabarits PDF', icon: FileText },
      ...(isAdmin ? [{ k: 'champs', label: 'Champs personnalisés', icon: ListPlus }] : []),
      { k: 'notifications', label: 'Notifications & relances', icon: Bell }, { k: 'ia', label: 'Assistant IA', icon: Sparkles }] },
    { titre: 'Séances et élus', entrees: [
      { k: 'elus', label: 'Élus', icon: Landmark }, { k: 'espace-elus', label: 'Espace élus', icon: Smartphone }] },
    { titre: 'Intégrations', entrees: [
      { k: 'tdt', label: 'Télétransmission (TDT)', icon: Send }, { k: 'ged', label: 'GED (Alfresco)', icon: HardDrive },
      ...(isAdmin ? [{ k: 'cles', label: 'Clés API', icon: KeyRound }, { k: 'recherche', label: 'Recherche', icon: Search }] : [])] },
    ...(isAdmin ? [{ titre: 'Données et conformité', entrees: [{ k: 'rgpd', label: 'RGPD', icon: Scale }, { k: 'configuration', label: 'Export / import', icon: ArrowLeftRight }] }] : []),
    ...(plateforme ? [{ titre: 'Plateforme', entrees: [{ k: 'collectivites', label: 'Collectivités', icon: Network }, { k: 'sauvegarde', label: 'Sauvegarde', icon: DatabaseBackup }] }] : []),
  ];
  return g;
}

/** Colonne du menu (UI-05) : liste déroulante sur mobile, colonne fixe sous l'en-tête sur poste. */
export function MenuLateral({ groupes }: { groupes: Groupe[] }) {
  const [ouvert, setOuvert] = useState(false);
  const lien = ({ isActive }: { isActive: boolean }) => `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${isActive ? 'bg-action-solid text-white shadow-lift' : 'text-side-text hover:bg-white/10 hover:text-white'}`;
  return (
    <aside className="md:sticky md:top-[7.5rem] md:self-start">
      <div className="rounded-xl bg-side shadow-lift">
        <button type="button" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)} className="flex w-full items-center gap-2 px-4 py-3 text-[13px] font-bold text-white md:hidden"><Menu className="h-4 w-4" /> Menu des paramétrages<ChevronDown className={`ml-auto h-4 w-4 transition-transform ${ouvert ? 'rotate-180' : ''}`} /></button>
        <div className="hidden items-center gap-2 border-b border-white/10 px-4 py-3 text-white md:flex"><Settings2 className="h-5 w-5 text-azur" /><span className="text-[14px] font-bold tracking-tight">Paramétrages</span></div>
        <nav aria-label="Paramétrages" className={`max-h-[calc(100vh-13rem)] space-y-4 overflow-y-auto p-3 md:block ${ouvert ? 'block' : 'hidden'}`}>
          {groupes.map((x) => (
            <div key={x.titre}>
              <div className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-side-text/70">{x.titre}</div>
              <div className="space-y-0.5">
                {x.entrees.map((e) => (
                  <NavLink key={e.k} to={`/admin/${e.k}`} className={lien} onClick={() => setOuvert(false)}>
                    {({ isActive }) => (<><e.icon className="h-[18px] w-[18px] shrink-0" /><span className="min-w-0 flex-1 truncate">{e.label}</span>{isActive && <span aria-hidden="true" className="absolute right-0 h-5 w-1 rounded-l bg-white" />}</>)}
                  </NavLink>))}
              </div>
            </div>))}
        </nav>
      </div>
    </aside>
  );
}

export default function Admin() {
  const { isAdmin, me } = useAuth();
  const { pathname } = useLocation();
  const groupes = menu(isAdmin, !!me?.isPlatformAdmin);
  const courante = pathname.split('/')[2] ?? '';
  const actuelle = groupes.flatMap((x) => x.entrees.map((e) => ({ ...e, groupe: x.titre }))).find((e) => e.k === courante);
  return (
    <div>
      <PageTitle title="Paramétrages" sub={isAdmin ? "Paramétrage de l'organisme." : "Paramétrage accessible au SCC."} />
      <div className="grid gap-6 md:grid-cols-[250px_minmax(0,1fr)]">
        <MenuLateral groupes={groupes} />
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-1 text-[13px] font-semibold text-mute" aria-label="Fil d'Ariane">
            <span>Paramétrages</span>{actuelle && <><ChevronRight className="h-3.5 w-3.5" /><span>{actuelle.groupe}</span><ChevronRight className="h-3.5 w-3.5" /><span className="text-head">{actuelle.label}</span></>}
          </div>
          <Routes>
        <Route index element={<Navigate to="utilisateurs" replace />} />
        <Route path="identite" element={<Identite />} /><Route path="ia" element={<AdminIa />} /><Route path="utilisateurs" element={<Utilisateurs />} /><Route path="gabarits" element={<Gabarits />} />
        <Route path="titulaires" element={<Titulaires />} /><Route path="circuits" element={<Circuits />} /><Route path="notifications" element={<Regles />} />
        <Route path="collectivites" element={<Collectivites />} /><Route path="sauvegarde" element={<AdminSauvegarde />} /><Route path="cles" element={<AdminCles />} /><Route path="elus" element={<AdminMembres />} /><Route path="espace-elus" element={<AdminElus />} /><Route path="ged" element={<AdminGed />} /><Route path="tdt" element={<AdminTdt />} /><Route path="champs" element={<AdminChamps />} /><Route path="configuration" element={<AdminConfiguration />} /><Route path="recherche" element={<AdminRecherche />} /><Route path="rgpd" element={<AdminRgpd />} /><Route path="calendrier" element={<Calendrier />} />
      </Routes>
        </div>
      </div>
    </div>
  );
}
