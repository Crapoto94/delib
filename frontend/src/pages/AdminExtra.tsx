import { useEffect, useRef, useState } from 'react';
import { FileText, Search, Shield, Trash2, Upload } from 'lucide-react';
import { api, errMsg, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { OrgLogo, resetBranding } from '../Brand';
import { VisibiliteUtilisateur } from '../VisibiliteActes';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

/* ------------------------------------------------------------------------------------------ utilisateurs et rôles */
const ROLES: Record<string, string> = { org_admin: 'Administrateur', scc: 'SCC', teletransmission: 'Télétransmission', lecteur: 'Lecteur' };
const ROLE_HELP: Record<string, string> = {
  org_admin: "Paramètre l'organisme (circuits, référentiels, utilisateurs, titulaires…)", scc: 'Séances, ordre du jour, dérogations, avis de commission, circuit',
  teletransmission: 'Prépare et confirme l’envoi au contrôle de légalité', lecteur: 'Consultation seule de tous les actes',
};

function Fiche({ username, onClose, onChanged }: { username: string; onClose: () => void; onChanged: () => void }) {
  const { org, me, reload } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const f = useLoad(async () => (await api.get(orgPath(o, `/utilisateurs/${username}`))).data, [username]);
  const admins = useLoad(async () => (me?.isPlatformAdmin ? (await api.get('/platform/admins')).data.items : []) as any[], [me?.isPlatformAdmin]);
  const has = (role: string) => f.data?.roles.find((r: any) => r.role === role);
  const toggle = async (role: string) => {
    try {
      const cur = has(role);
      if (cur) await api.delete(orgPath(o, `/utilisateurs/roles/${cur.id}`)); else await api.post(orgPath(o, `/utilisateurs/${username}/roles`), { role });
      toast(cur ? 'Rôle retiré' : 'Rôle attribué'); f.reload(); onChanged(); if (username === me?.username) reload();
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const platform = (admins.data ?? []).find((a: any) => a.username === username);
  const togglePlatform = async () => {
    try { if (platform) await api.delete(`/platform/admins/${platform.id}`); else await api.post('/platform/admins', { username }); toast('Administrateur de plateforme mis à jour'); admins.reload(); f.reload(); onChanged(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  return (
    <Modal title="Utilisateur" onClose={onClose} wide>
      {f.loading ? <Loading /> : f.error ? <ErrorBox msg={f.error} /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">{f.data.agent.displayName.split(' ').map((x: string) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div><div className="text-[18px] font-bold text-head">{f.data.agent.displayName}</div><div className="text-mute">{f.data.agent.poste || '—'} · {f.data.agent.direction?.label || 'direction inconnue'}{f.data.agent.service ? ` › ${f.data.agent.service.label}` : ''}</div>
              <div className="text-[12px] text-mute">{f.data.agent.email} · identifiant <code>{f.data.agent.username}</code> · dernière connexion {dt(f.data.agent.lastLoginAt)}</div></div>
          </div>
          <section><h3 className="mb-2">Rôles dans {org!.nom}</h3>
            <ul className="divide-y divide-line rounded border border-line">{Object.entries(ROLES).map(([k, l]) => (
              <li key={k} className="flex items-center gap-3 px-3 py-2"><label className="flex flex-1 items-start gap-3"><input type="checkbox" className="mt-1" checked={!!has(k)} onChange={() => toggle(k)} />
                <span><b>{l}</b><br /><span className="text-[12px] text-mute">{ROLE_HELP[k]}</span></span></label>{has(k) && <span className="text-[11px] text-mute">depuis {dt(has(k).createdAt, { dateStyle: 'short' })}{has(k).createdBy ? ` par ${has(k).createdBy}` : ''}</span>}</li>))}
              {me?.isPlatformAdmin && <li className="flex items-center gap-3 bg-warn-bg px-3 py-2"><label className="flex flex-1 items-start gap-3"><input type="checkbox" className="mt-1" checked={!!platform} onChange={togglePlatform} />
                <span><b><Shield className="mr-1 inline h-4 w-4" />Administrateur de plateforme</b><br /><span className="text-[12px] text-mute">Tous les organismes, tous les droits. À réserver à la DSI.</span></span></label></li>}
            </ul>
            <p className="mt-2 text-[12px] text-mute">Les fonctions de validation (chef de service, directeur, DGA, DGS) se désignent dans « Titulaires & droits ».</p></section>
          {f.data.visibiliteActes && <VisibiliteUtilisateur username={username} data={f.data.visibiliteActes} onChanged={f.reload} toast={toast} />}
          <section className="grid gap-4 md:grid-cols-2">
            <div><h3 className="mb-1">Fonctions et groupes</h3>
              {!f.data.titulaires.length && !f.data.groupes.length ? <p className="text-mute">Aucune fonction de validation ni groupe.</p> : <ul className="space-y-1">{f.data.titulaires.map((t: any) => <li key={t.id}><Badge tone="blue">{t.fonction.replace('_', ' ')}</Badge> {t.directionCode ?? 'toute la collectivité'}{t.serviceCode ? ` › ${t.serviceCode}` : ''}</li>)}{f.data.groupes.map((g: any) => <li key={g.code}><Badge>groupe</Badge> {g.nom}</li>)}</ul>}</div>
            <div><h3 className="mb-1">Accès</h3>
              <ul className="space-y-1">{f.data.accessibleOrganismes.map((a: any) => <li key={a.id}><b>{a.nom}</b> <span className="text-[12px] text-mute">({a.via.join(', ')}){a.roles.length ? ` · ${a.roles.join(', ')}` : ''}</span></li>)}</ul>
              <p className="mt-1 text-[12px] text-mute">{f.data.actesRediges} acte(s) rédigé(s) · {f.data.autorisationsRedaction.length} autorisation(s) de rédaction · {f.data.delegations.length} délégation(s) active(s)</p></div>
          </section>
        </div>)}{node}
    </Modal>
  );
}

export function Utilisateurs() {
  const { org } = useAuth(); const o = org!.id;
  const [q, setQ] = useState(''); const [typed, setTyped] = useState(''); const [open, setOpen] = useState<string | null>(null); const [avecRole, setAvecRole] = useState(false);
  const res = useLoad(async () => (await api.get(orgPath(o, '/utilisateurs'), { params: { q: q.trim().length >= 2 ? q : undefined, avecRole: avecRole || undefined } })).data.items as any[], [o, q, avecRole]);
  useEffect(() => { const t = setTimeout(() => setQ(typed), 350); return () => clearTimeout(t); }, [typed]);
  return (
    <div className="space-y-4">
      <p className="text-mute">Les agents qui se sont déjà connectés à l'application. Recherchez par nom, identifiant ou e-mail (l'annuaire RH est aussi interrogé) pour attribuer ou retirer des rôles.</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-[280px] flex-1 items-center rounded border border-slate-300 bg-surface px-3"><Search className="h-4 w-4 text-mute" /><input autoFocus className="w-full bg-transparent px-2 py-3 outline-none" placeholder="Filtrer ou rechercher un utilisateur…" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Rechercher un utilisateur" /></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={avecRole} onChange={(e) => setAvecRole(e.target.checked)} /> Seulement ceux qui ont un rôle</label>
        {res.data && <span className="text-[12px] text-mute">{res.data.length} utilisateur(s)</span>}
      </div>
      <div className="card overflow-x-auto">
        {res.loading && !res.data ? <Loading /> : !res.data?.length ? <Empty>Aucun utilisateur trouvé.</Empty> : (
          <table className="w-full"><thead><tr><th>Agent</th><th>Direction</th><th>Rôles ici</th><th>Dernière connexion</th><th /></tr></thead><tbody>{res.data.map((a: any) => (
            <tr key={a.username} className="hover:bg-soft"><td><b>{a.displayName}</b><div className="text-[12px] text-mute">{a.username} · {a.email}</div></td><td className="text-mute">{a.direction?.label}{a.poste ? <div className="text-[12px]">{a.poste}</div> : null}</td>
              <td>{a.isPlatformAdmin && <Badge tone="warn">plateforme</Badge>} {a.roles.map((r: any) => <Badge key={r.id} tone="blue">{ROLES[r.role]}</Badge>)}{!a.roles.length && !a.isPlatformAdmin && <span className="text-mute">—</span>}</td>
              <td className="text-[12px] text-mute">{a.lastLoginAt ? dt(a.lastLoginAt, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
              <td className="text-right">{a.knownLocally ? <button className="btn-secondary" onClick={() => setOpen(a.username)}>Gérer</button> : <span className="text-[12px] text-mute">Jamais connecté</span>}</td></tr>))}</tbody></table>)}
      </div>
      {open && <Fiche username={open} onClose={() => setOpen(null)} onChanged={res.reload} />}
    </div>
  );
}

/* --------------------------------------------------------------------------------------------------- gabarits PDF */
const DOCS: Record<string, string> = {
  expose: 'Exposé des motifs', deliberation: 'Délibération', dossier: 'Dossier complet', garde: 'Page de garde', intercalaire: 'Intercalaire de point', sommaire: 'Sommaire', odj: 'Ordre du jour', convocation: 'Convocation', registre: 'Extrait du registre',
};
const VARS = '{organisme} {titre} {rubrique} {matiere} {nature} {direction} {service} {redacteur} {numero_suivi} {numero} {date_seance} {date_du_jour} {statut}';

export function Gabarits() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const list = useLoad(async () => (await api.get(orgPath(o, '/gabarits'))).data.items as any[], [o]);
  const fonts = useLoad(async () => (await api.get(orgPath(o, '/gabarits-polices'))).data.items as any[], [o]);
  const [sel, setSel] = useState('deliberation'); const [cfg, setCfg] = useState<any>(null); const [busy, setBusy] = useState(false);
  const cur = list.data?.find((t) => t.docType === sel);
  useEffect(() => { if (cur) setCfg(JSON.parse(JSON.stringify(cur.cfg))); }, [cur?.docType, cur?.version, list.data]);
  const first = useRef<HTMLInputElement>(null); const next = useRef<HTMLInputElement>(null);
  if (list.loading && !list.data) return <Loading />;
  if (!cur || !cfg) return <Empty>Aucun gabarit.</Empty>;
  const set = (path: string[], v: any) => { const c = JSON.parse(JSON.stringify(cfg)); let t = c; path.slice(0, -1).forEach((k) => { t[k] = t[k] ?? {}; t = t[k]; }); t[path[path.length - 1]] = v; setCfg(c); };
  const save = async () => {
    setBusy(true);
    try { await api.put(orgPath(o, `/gabarits/${sel}`), { marges: cfg.marges, police: cfg.police, pied: cfg.pied, entete: cfg.entete, filigrane: cfg.filigrane, a4Strict: cfg.a4Strict }); toast('Gabarit enregistré (nouvelle version)'); list.reload(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const upload = async (which: 'first' | 'next', file: File) => {
    try { const fd = new FormData(); fd.append('file', file); await api.post(orgPath(o, `/gabarits/${sel}/fond/${which}`), fd); toast('Fond déposé'); list.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const calibrate = async () => { const m = await openPdf(() => api.get(orgPath(o, `/gabarits/${sel}/etalonnage`), { responseType: 'blob' }), `Étalonnage du gabarit « ${sel} »`); if (m) toast(`Étalonnage impossible : ${m}`, 'ko'); };
  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Gabarits" className="card h-fit p-2">
        {list.data!.map((t) => (
          <button key={t.docType} onClick={() => setSel(t.docType)} className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-[13px] font-semibold ${sel === t.docType ? 'bg-primary text-white' : 'hover:bg-soft'}`}>
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" />{DOCS[t.docType] ?? t.docType}</span>{t.personnalise && <span className={`h-2 w-2 rounded-full ${sel === t.docType ? 'bg-surface' : 'bg-action-solid'}`} title="Personnalisé" />}
          </button>))}
      </nav>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2>{DOCS[sel] ?? sel} {cur.personnalise ? <Badge tone="blue">v{cur.version}</Badge> : <Badge>par défaut</Badge>}</h2>
          <div className="flex gap-2"><button className="btn-secondary" onClick={calibrate}>Aperçu d'étalonnage (PDF)</button><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} Enregistrer</button></div></div>

        <section className="card p-5"><h3 className="mb-3">Police et texte</h3>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Police"><Select className="input" value={cfg.police.famille ?? 'interstate'} onChange={(e) => set(['police', 'famille'], e.target.value)}>
              {fonts.data?.map((f) => <option key={f.id} value={f.id} disabled={!f.disponible}>{f.label}{f.disponible ? '' : ' — non installée'}</option>)}</Select></Field>
            <Field label="Taille (pt)"><input className="input" type="number" min={7} max={18} step={0.5} value={cfg.police.taille} onChange={(e) => set(['police', 'taille'], Number(e.target.value))} /></Field>
            <Field label="Interligne"><input className="input" type="number" min={1} max={2.5} step={0.05} value={cfg.police.interligne} onChange={(e) => set(['police', 'interligne'], Number(e.target.value))} /></Field>
            <label className="mt-6 flex items-center gap-2"><input type="checkbox" checked={!!cfg.police.justifie} onChange={(e) => set(['police', 'justifie'], e.target.checked)} /> Texte justifié</label>
          </div></section>

        <section className="card p-5"><h3 className="mb-3">Marges (mm) et pied de page</h3>
          <div className="grid gap-4 md:grid-cols-4">{(['haut', 'bas', 'gauche', 'droite'] as const).map((k) => <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input className="input" type="number" min={0} max={80} value={cfg.marges[k]} onChange={(e) => set(['marges', k], Number(e.target.value))} /></Field>)}</div>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]"><Field label="Texte du pied de page" hint={`Variables : ${VARS}`}><input className="input" value={cfg.pied.texte ?? ''} onChange={(e) => set(['pied', 'texte'], e.target.value)} /></Field>
            <label className="mt-6 flex items-center gap-2"><input type="checkbox" checked={cfg.pied.pagination !== false} onChange={(e) => set(['pied', 'pagination'], e.target.checked)} /> Pagination</label></div>
          <Field label="Filigrane (vide = aucun)"><input className="input" value={cfg.filigrane ?? ''} onChange={(e) => set(['filigrane'], e.target.value)} /></Field></section>

        <section className="card p-5"><h3 className="mb-1">En-tête</h3><p className="mb-3 text-[12px] text-mute">Variables : {VARS}</p>
          <ul className="space-y-2">{cfg.entete.map((b: any, i: number) => (
            <li key={i} className="grid items-center gap-2 rounded border border-line p-2 md:grid-cols-[1fr_90px_110px_auto_auto_auto]">
              <input className="input" aria-label="Texte" value={b.texte} onChange={(e) => set(['entete', String(i), 'texte'], e.target.value)} />
              <input className="input" aria-label="Taille" type="number" min={6} max={40} value={b.taille ?? 11} onChange={(e) => set(['entete', String(i), 'taille'], Number(e.target.value))} />
              <Select className="input" aria-label="Alignement" value={b.align ?? 'left'} onChange={(e) => set(['entete', String(i), 'align'], e.target.value)}><option value="left">Gauche</option><option value="center">Centré</option><option value="right">Droite</option></Select>
              <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={!!b.gras} onChange={(e) => set(['entete', String(i), 'gras'], e.target.checked)} /> Gras</label>
              <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={!!b.encadre} onChange={(e) => set(['entete', String(i), 'encadre'], e.target.checked)} /> Encadré</label>
              <button className="text-ko" aria-label="Supprimer la ligne" onClick={() => set(['entete'], cfg.entete.filter((_: any, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </li>))}</ul>
          <button className="btn-secondary mt-3" onClick={() => set(['entete'], [...cfg.entete, { texte: '', align: 'left', taille: 11, apres: 6 }])}>+ Ajouter une ligne</button></section>

        <section className="card p-5"><h3 className="mb-1">PDF de fond (papier à en-tête)</h3><p className="mb-3 text-[12px] text-mute">Un PDF A4 sert de fond de page : première page et pages suivantes, ou un seul pour toutes.</p>
          <div className="grid gap-4 md:grid-cols-2">{([['first', 'Première page', cur.bgFirstFileId, first], ['next', 'Pages suivantes', cur.bgNextFileId, next]] as const).map(([w, l, id, ref]) => (
            <div key={w} className="rounded border border-line p-3"><b>{l}</b><div className="my-2">{id ? <Badge tone="ok">fond déposé</Badge> : <span className="text-mute">aucun</span>}</div>
              <input ref={ref} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(w, f); e.target.value = ''; }} />
              <div className="flex gap-2"><button className="btn-secondary" onClick={() => ref.current?.click()}><Upload className="h-3.5 w-3.5" /> Déposer un PDF</button>
                {id && <button className="btn-ko" onClick={async () => { await api.delete(orgPath(o, `/gabarits/${sel}/fond/${w}`)); list.reload(); }}>Retirer</button>}</div></div>))}</div></section>
      </div>{node}
    </div>
  );
}

/* ---------------------------------------------------------------------------- identité de l'organisme (nom, logo…) */
export function Identite() {
  const { org, reload } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const cur = useLoad(async () => (await api.get(`/organismes/${o}`)).data, [o]);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState(false); const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (cur.data) setF({ nom: cur.data.nom, adresse: cur.data.adresse ?? '', siren: cur.data.siren ?? '', ...Object.fromEntries(['adresse2', 'codePostal', 'ville', 'telephone', 'email', 'siteWeb', 'signataire', 'signataireQualite'].map((k) => [k, cur.data.contact?.[k] ?? ''])) }); }, [cur.data]);
  if (cur.loading && !f) return <Loading />;
  if (!f) return <ErrorBox msg={cur.error} />;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true);
    try {
      const { nom, adresse, siren, ...contact } = f;
      await api.put(`/organismes/${o}`, { nom, adresse: adresse || undefined, siren: siren || undefined, contact });
      toast('Identité enregistrée'); await reload(); cur.reload();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const upload = async (fl: File) => { try { const fd = new FormData(); fd.append('file', fl); await api.post(`/organismes/${o}/logo`, fd); resetBranding(); toast('Logo enregistré'); await reload(); cur.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const c = cur.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="card h-fit p-5"><h3 className="mb-3">Logo</h3>
        <div className="flex h-32 items-center justify-center rounded border border-dashed border-line bg-soft p-4"><OrgLogo orgId={o} nom={c.nom} hasLogo={c.hasLogo} version={c.logoVersion} className="h-24" /></div>
        <p className="mt-2 text-[12px] text-mute">PNG ou JPEG, 1,5 Mo au plus. C'est aussi <b>le logo de l'application</b> (en-tête, page de connexion, icône de l'onglet) et celui des <b>PDF</b> (option dans les gabarits).</p>
        <input ref={file} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const fl = e.target.files?.[0]; if (fl) upload(fl); e.target.value = ''; }} />
        <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={() => file.current?.click()}><Upload className="h-3.5 w-3.5" /> {c.hasLogo ? 'Remplacer' : 'Déposer un logo'}</button>
          {c.hasLogo && <button className="btn-ko" onClick={async () => { await api.delete(`/organismes/${o}/logo`); resetBranding(); toast('Logo retiré'); await reload(); cur.reload(); }}>Retirer</button>}</div>
      </section>
      <section className="card p-5"><h3 className="mb-3">Nom et coordonnées</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2"><Field label="Nom de la collectivité" hint="Affiché dans l'application, les mails et les PDF ({organisme}).">
            <input className="input" value={f.nom} onChange={(e) => set('nom', e.target.value)} /></Field></div>
          <div className="md:col-span-2"><Field label="Adresse"><input className="input" value={f.adresse} onChange={(e) => set('adresse', e.target.value)} /></Field></div>
          <Field label="Complément d'adresse"><input className="input" value={f.adresse2} onChange={(e) => set('adresse2', e.target.value)} /></Field>
          <div className="grid grid-cols-[120px_1fr] gap-3"><Field label="Code postal"><input className="input" value={f.codePostal} onChange={(e) => set('codePostal', e.target.value)} /></Field><Field label="Ville"><input className="input" value={f.ville} onChange={(e) => set('ville', e.target.value)} /></Field></div>
          <Field label="Téléphone"><input className="input" value={f.telephone} onChange={(e) => set('telephone', e.target.value)} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Site web"><input className="input" value={f.siteWeb} onChange={(e) => set('siteWeb', e.target.value)} /></Field>
          <Field label="SIREN"><input className="input" value={f.siren} onChange={(e) => set('siren', e.target.value)} /></Field>
          <Field label="Signataire des convocations"><input className="input" value={f.signataire} onChange={(e) => set('signataire', e.target.value)} placeholder="Prénom Nom" /></Field>
          <Field label="Qualité du signataire"><input className="input" value={f.signataireQualite} onChange={(e) => set('signataireQualite', e.target.value)} placeholder="Le Maire" /></Field>
        </div>
        <p className="mt-3 text-[12px] text-mute">Variables utilisables dans les gabarits PDF : {'{organisme} {adresse} {ville} {code_postal} {telephone} {email} {site_web} {signataire}'}.</p>
        <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} Enregistrer</button></div>
      </section>{node}
    </div>
  );
}
