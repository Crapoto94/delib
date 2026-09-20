import { useState } from 'react';
import { CheckCircle2, ChevronRight, FileText, Folder, FolderPlus, Plug, XCircle } from 'lucide-react';
import { api, errMsg, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, MailSwitch, Spinner, useLoad, useToast } from '../ui';

/** Explorateur du plan de classement : on descend dossier par dossier (fil d'Ariane), les PDF s'ouvrent dans la visionneuse. */
function Explorateur({ o, rev }: { o: number; rev: number }) {
  const [pile, setPile] = useState<{ id: string | null; nom: string }[]>([{ id: null, nom: 'Racine du dépôt' }]);
  const cur = pile[pile.length - 1];
  const liste = useLoad(async () => (await api.get(orgPath(o, '/ged/explorateur'), { params: cur.id ? { nodeId: cur.id } : {} })).data.items as any[], [o, cur.id, rev]);
  const { toast } = useToast();
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2 text-[13px]">
        {pile.map((p, i) => <span key={i} className="flex items-center gap-1">{i > 0 && <ChevronRight className="h-3.5 w-3.5 text-mute" />}<button className={i === pile.length - 1 ? 'font-semibold' : 'text-action hover:underline'} onClick={() => setPile(pile.slice(0, i + 1))}>{p.nom}</button></span>)}
      </div>
      {liste.loading ? <Loading /> : liste.error ? <p className="p-4 text-ko">{liste.error}</p> : !liste.data?.length ? <p className="p-6 text-center text-mute">Dossier vide.</p> : (
        <ul className="divide-y divide-line">{liste.data.map((n) => (
          <li key={n.id}>
            <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-soft" onClick={async () => { if (n.dossier) setPile([...pile, { id: n.id, nom: n.nom }]); else { const m = await openPdf(() => api.get(orgPath(o, `/ged/noeuds/${n.id}/contenu`), { responseType: 'blob' }), n.nom); if (m) toast(m, 'ko'); } }}>
              {n.dossier ? <Folder className="h-4 w-4 shrink-0 text-warn" /> : <FileText className="h-4 w-4 shrink-0 text-mute" />}
              <span className="min-w-0 flex-1"><span className="font-semibold">{n.nom}</span>{n.description && <span className="block truncate text-[11px] text-mute" title={n.description}>{n.description}</span>}</span>
              {!n.dossier && <span className="text-[11px] text-mute">{n.version && `v${n.version} · `}{n.taille ? `${Math.round(n.taille / 1024)} Ko` : ''}</span>}
            </button>
          </li>))}</ul>)}
    </div>
  );
}

/** Paramétrage de la GED Alfresco (GED-01 à GED-07) : connexion, test, plan de classement, archivage des séances. */
export default function AdminGed() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/ged/config'))).data, [o]);
  const seances = useLoad(async () => (await api.get(orgPath(o, '/seances'), { params: { limit: 60 } })).data.items as any[], [o]);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<any>(null); const [plan, setPlan] = useState<any>(null); const [sid, setSid] = useState<number | null>(null); const [resultat, setResultat] = useState<any>(null); const [rev, setRev] = useState(0);
  const docs = useLoad(async () => (await api.get(orgPath(o, '/ged/documents'), { params: sid ? { seanceId: sid } : {} })).data.items as any[], [o, sid, rev]);
  if (cfg.loading || !cfg.data) return <Loading />;
  const v = f ?? { ...cfg.data, motDePasse: '' };
  const set = (p: Record<string, unknown>) => setF({ ...v, ...p });
  const alf = v.mode === 'alfresco';
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); } };
  const enregistrer = () => run('save', async () => { await api.put(orgPath(o, '/ged/config'), { actif: v.actif, mode: v.mode, url: v.url, utilisateur: v.utilisateur, racine: v.racine, autoArchivage: v.autoArchivage, motDePasse: v.motDePasse || '' }); toast('Paramétrage enregistré'); setF(null); cfg.reload(); });
  const tester = () => run('test', async () => { setTest((await api.post(orgPath(o, '/ged/test'), { mode: v.mode, url: v.url, utilisateur: v.utilisateur, racine: v.racine, motDePasse: v.motDePasse || undefined })).data); });
  const creerPlan = () => run('plan', async () => { const r = (await api.post(orgPath(o, '/ged/plan'))).data; setPlan(r); setRev((n) => n + 1); toast(r.nouveaux ? `${r.nouveaux} dossier(s) créé(s)` : 'Le plan de classement était déjà complet'); cfg.reload(); });
  const archiver = () => run('arch', async () => { const r = (await api.post(orgPath(o, `/ged/seances/${sid}/archivage`))).data; setResultat(r); setRev((n) => n + 1); toast(r.erreurs ? `${r.erreurs} document(s) en échec (rejouable)` : `${r.deposes} déposé(s), ${r.nouvellesVersions} nouvelle(s) version(s), ${r.inchanges} inchangé(s)`, r.erreurs ? 'ko' : 'ok'); });

  return (
    <div className="space-y-6">
      <p className="max-w-4xl text-mute">Tous les documents des séances (convocation, dossiers de chaque délibération, cahier, procès-verbal, extraits du registre, accusés de réception) peuvent être <b>archivés dans une GED Alfresco</b>, classés dans un <b>plan de classement</b> numéroté par année et par séance. Un document modifié devient une <b>nouvelle version</b> du même nœud, jamais un doublon.</p>

      <section className="card space-y-4 p-5"><h3>Connexion</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Mode" hint="La simulation garde une arborescence factice dans VibeDélib : elle permet de tout tester sans serveur Alfresco."><select className="input" value={v.mode} onChange={(e) => set({ mode: e.target.value })}><option value="simulation">Simulation (aucun serveur)</option><option value="alfresco">Alfresco</option></select></Field>
          <Field label="Dossier racine" hint="Identifiant de nœud, ou chemin relatif à Company Home (ex. /Sites/archives/documentLibrary). Vide : racine du dépôt."><input className="input" value={v.racine === '-root-' ? '' : v.racine} placeholder="Racine du dépôt" onChange={(e) => set({ racine: e.target.value })} disabled={!alf} /></Field>
          <Field label="URL du serveur Alfresco" hint="Ex. https://alfresco.ivry.local"><input className="input" value={v.url} onChange={(e) => set({ url: e.target.value })} disabled={!alf} placeholder="https://alfresco.exemple.fr" /></Field>
          <Field label="Compte technique"><input className="input" value={v.utilisateur} onChange={(e) => set({ utilisateur: e.target.value })} disabled={!alf} autoComplete="off" /></Field>
          <Field label="Mot de passe" hint={cfg.data.motDePasseDefini ? 'Un mot de passe est enregistré (chiffré, jamais affiché). Laissez vide pour le conserver.' : 'Chiffré au repos, jamais renvoyé par l’API.'}><input className="input" type="password" autoComplete="new-password" value={v.motDePasse} onChange={(e) => set({ motDePasse: e.target.value })} disabled={!alf} placeholder={cfg.data.motDePasseDefini ? '••••••••••••' : ''} /></Field>
        </div>
        <label className="flex items-center gap-3"><MailSwitch on={!!v.actif} onChange={(b) => set({ actif: b })} label="Archivage actif" /><span>Archivage <b>actif</b></span></label>
        <label className="flex items-center gap-3"><MailSwitch on={!!v.autoArchivage} onChange={(b) => set({ autoArchivage: b })} label="Archivage automatique" /><span>Archiver <b>automatiquement à la clôture de la séance</b> (sinon, bouton « Archiver » ci-dessous)</span></label>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary" disabled={busy === 'test'} onClick={tester}>{busy === 'test' ? <Spinner /> : <Plug className="h-4 w-4" />} Tester la connexion</button>
          <button className="btn-primary ml-auto" disabled={busy === 'save' || !f} onClick={enregistrer}>{busy === 'save' && <Spinner />} Enregistrer</button>
        </div>
        {test && (
          <div className={`rounded-lg border p-3 text-[13px] ${test.ok ? 'border-ok/30 bg-ok-bg text-ok-text' : 'border-ko/30 bg-ko-bg text-ko'}`} role="status">
            <div className="flex items-center gap-2 font-semibold">{test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.message}</div>
            {test.ok && test.details && <ul className="mt-1 text-[12px]"><li>Serveur : {test.details.serveur}{test.details.version ? ` ${test.details.version}` : ''}{test.details.edition ? ` (${test.details.edition})` : ''}</li><li>Dossier racine : {test.details.racine?.nom}</li><li>Temps de réponse : {test.details.ms} ms</li></ul>}
            {!test.ok && test.details?.etape && <div className="mt-1 text-[12px]">Étape en échec : {test.details.etape}</div>}
          </div>)}
      </section>

      <section className="card space-y-3 p-5"><h3>Plan de classement</h3>
        <p className="text-[13px] text-mute">Crée l’arborescence <code>VibeDélib — Collectivité / 01 Séances / année / date Instance / …</code> et <code>02 Registre des délibérations / année</code>, avec la finalité et la durée de conservation indicative de chaque dossier (à valider par le service des archives). L’opération peut être rejouée sans risque : ce qui existe n’est jamais recréé.</p>
        <div className="flex items-center gap-3"><button className="btn-primary" disabled={busy === 'plan'} onClick={creerPlan}>{busy === 'plan' ? <Spinner /> : <FolderPlus className="h-4 w-4" />} Créer le plan de classement</button>{cfg.data.planCreeLe && <span className="text-[12px] text-mute">Dernière création : {dt(cfg.data.planCreeLe)}</span>}</div>
        {plan && <div className="rounded bg-soft p-3 text-[12px]"><b>{plan.nouveaux ? `${plan.nouveaux} dossier(s) créé(s)` : 'Plan déjà complet'}</b>{plan.nouveaux > 0 && <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-[11px]">{plan.dossiers.map((d: string) => <li key={d}>{d}</li>)}</ul>}</div>}
        <Explorateur o={o} rev={rev} />
      </section>

      <section className="card space-y-3 p-5"><h3>Archivage d’une séance</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Séance"><select className="input !w-auto" value={sid ?? ''} onChange={(e) => { setSid(e.target.value ? Number(e.target.value) : null); setResultat(null); }}><option value="">Choisir une séance…</option>{seances.data?.map((s) => <option key={s.id} value={s.id}>{s.instance} — {dt(s.dateSeance, { dateStyle: 'long' })}</option>)}</select></Field>
          <button className="btn-primary" disabled={!sid || busy === 'arch'} onClick={archiver}>{busy === 'arch' && <Spinner />} Archiver la séance</button>
        </div>
        <ErrorBox msg={null} />
        {resultat && <div className="flex flex-wrap gap-2"><Badge tone="ok">{resultat.deposes} déposé(s)</Badge><Badge tone="blue">{resultat.nouvellesVersions} nouvelle(s) version(s)</Badge><Badge>{resultat.inchanges} inchangé(s)</Badge>{resultat.erreurs > 0 && <Badge tone="ko">{resultat.erreurs} en échec</Badge>}</div>}
        {docs.data && docs.data.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>Document</th><th>Emplacement</th><th>Version</th><th>Archivé</th><th /></tr></thead><tbody>{docs.data.map((d) => (
            <tr key={d.id}><td className="font-semibold">{d.nom}</td><td className="text-[11px] text-mute">{d.chemin}</td><td>{d.version ?? '—'}</td><td className="text-[12px]">{dt(d.archiveLe)}</td><td>{d.statut === 'erreur' ? <span className="text-[12px] text-ko" title={d.erreur}>échec</span> : <Badge tone="ok">ok</Badge>}</td></tr>))}</tbody></table></div>)}
      </section>{node}
    </div>
  );
}
