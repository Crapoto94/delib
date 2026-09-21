import { useMemo, useState } from 'react';
import { AlertTriangle, Ban, Check, ChevronLeft, Cog, FileJson, Play, Plus, RefreshCw, Upload, Wand2, XCircle } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const AXES: Record<string, string> = { organisme: 'Organisme', instance: 'Instance / type de sÃ©ance', direction: 'Direction', service: 'Service', agent: 'Agent', elu: 'Ã‰lu', commission: 'Commission', type_acte: "Type d'acte", nature: 'Nature', rubrique: 'Rubrique', matiere: 'MatiÃ¨re' };
const CIBLE_TYPE: Record<string, string> = { direction: 'directions', service: 'services', agent: 'agents', elu: 'elus', commission: 'commissions', instance: 'instances', organisme: 'organismes', type_acte: 'ref_items', nature: 'ref_items', rubrique: 'ref_items', matiere: 'ref_items' };
const ETAT: Record<string, { label: string; tone: 'ok' | 'warn' | 'ko' | 'gray' | 'blue' }> = {
  a_faire: { label: 'Ã€ faire', tone: 'gray' }, proposee: { label: 'ProposÃ©e', tone: 'warn' }, automatique: { label: 'Automatique', tone: 'blue' },
  manuelle: { label: 'ValidÃ©e', tone: 'ok' }, ignoree: { label: 'IgnorÃ©e', tone: 'gray' },
};
const LOT: Record<string, { label: string; tone: 'ok' | 'warn' | 'ko' | 'gray' | 'blue' }> = {
  brouillon: { label: 'Brouillon', tone: 'gray' }, charge: { label: 'ChargÃ©', tone: 'blue' }, analyse: { label: 'AnalysÃ©', tone: 'blue' },
  concordances: { label: 'Concordances', tone: 'warn' }, pret: { label: 'PrÃªt', tone: 'warn' }, publie: { label: 'PubliÃ©', tone: 'ok' }, annule: { label: 'AnnulÃ©', tone: 'ko' },
};
const clamp = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}â€¦` : s);

function NouveauLot({ o, onClose, onDone }: { o: number; onClose: () => void; onDone: (lot: any) => void }) {
  const [f, setF] = useState({ label: `Reprise AIRS ${new Date().getFullYear()}`, sourceKind: 'json', mode: 'passes' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { onDone((await api.post(orgPath(o, '/import-airs/lots'), f)).data); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  return (
    <Modal title="Nouveau lot de reprise AIRS DELIB" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Field label="LibellÃ© du lot *"><input className="input" autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Source"><Select className="input" value={f.sourceKind} onChange={(e) => setF({ ...f, sourceKind: e.target.value })}><option value="json">Fichier / export JSON du HUB</option><option value="tables">Tables airs_* (schÃ©ma partagÃ©)</option></Select></Field>
          <Field label="PÃ©rimÃ¨tre"><Select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="passes">SÃ©ances passÃ©es (dÃ©faut)</option><option value="preparation">SÃ©ances passÃ©es + actes en prÃ©paration</option></Select></Field>
        </div>
        <p className="text-[12px] text-mute">Les donnÃ©es sont dÃ©posÃ©es dans un <b>sas</b> : rien n'entre dans l'outil avant la validation des concordances puis la publication.</p>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || f.label.trim().length < 2} onClick={go}>{busy && <Spinner />} CrÃ©er le lot</button></div>
      </div>
    </Modal>
  );
}

function Charger({ o, lot, onDone, onClose }: { o: number; lot: any; onDone: () => void; onClose: () => void }) {
  const [contenu, setContenu] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const lire = async (file?: File) => { if (file) setContenu(await file.text()); };
  const envoyer = async (data: any, demo = false) => {
    setBusy(true); setErr(null);
    try { demo ? await api.post(orgPath(o, `/import-airs/lots/${lot.id}/charger-demo`), {}) : await api.post(orgPath(o, `/import-airs/lots/${lot.id}/charger`), { data }); onDone(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const chargerFichier = () => { try { envoyer(JSON.parse(contenu)); } catch { setErr('JSON illisible'); } };
  return (
    <Modal title="Charger les donnÃ©es AIRS dans le sas" onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <p className="text-[13px] text-mute">Format attendu : objet <code>{'{ "seances": [ â€¦ ], "rapports": [ â€¦ ] }'}</code>. Les lignes sont conservÃ©es telles quelles (JSONB) : aucune interprÃ©tation avant l'analyse.</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".json" onChange={(e) => lire(e.target.files?.[0])} />
          <button className="btn-secondary" disabled={busy} onClick={() => envoyer(null, true)}><Wand2 className="h-4 w-4" /> Charger le jeu d'essai</button>
        </div>
        <textarea className="input h-44 font-mono text-[12px]" placeholder="Ou collez l'export JSON du HUB ici" value={contenu} onChange={(e) => setContenu(e.target.value)} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Fermer</button><button className="btn-primary" disabled={busy || contenu.trim().length < 2} onClick={chargerFichier}>{busy && <Spinner />} Charger</button></div>
      </div>
    </Modal>
  );
}

function Mapping({ o, onClose, onDone }: { o: number; onClose: () => void; onDone: () => void }) {
  const d = useLoad(async () => (await api.get(orgPath(o, '/import-airs/mapping'))).data.items as any[], [o]);
  const [txt, setTxt] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const initial = useMemo(() => (d.data ? JSON.stringify(d.data.map((m) => ({ tableName: m.table_name, libelle: m.libelle, entiteCible: m.entite_cible, cleColonne: m.cle_colonne, colonnes: m.colonnes, ordre: m.ordre, actif: m.actif })), null, 2) : ''), [d.data]);
  const save = async () => { setBusy(true); setErr(null); try { await api.put(orgPath(o, '/import-airs/mapping'), { items: JSON.parse(txt) }); onDone(); } catch (e) { setErr(e instanceof SyntaxError ? 'JSON illisible' : errMsg(e)); setBusy(false); } };
  return (
    <Modal title="Mapping dÃ©claratif des tables AIRS" onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <p className="text-[13px] text-mute">Le MCD d'AIRS n'Ã©tant pas connu, chaque table source et la correspondance de ses colonnes vers les champs canoniques (<code>titre</code>, <code>direction</code>, <code>service</code>, <code>date</code>â€¦) se dÃ©finissent ici. C'est de la <b>configuration</b>, pas du code.</p>
        {d.loading ? <Loading /> : <textarea className="input h-72 font-mono text-[12px]" value={txt || initial} onChange={(e) => setTxt(e.target.value)} onFocus={() => { if (!txt) setTxt(initial); }} />}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Fermer</button><button className="btn-primary" disabled={busy || !(txt || initial)} onClick={save}>{busy && <Spinner />} Enregistrer le mapping</button></div>
      </div>
    </Modal>
  );
}

function LigneConcordance({ o, lotId, c, cibles, onDone }: { o: number; lotId: number; c: any; cibles: any[]; onDone: () => void }) {
  const { toast } = useToast();
  const [verif, setVerif] = useState<any>(null);
  const cle = (x: any) => (x.id != null ? `i${x.id}` : `c${x.code ?? x.libelle}`);
  const courante = cibles.find((x) => (c.cibleId != null && String(x.id) === String(c.cibleId)) || (c.cibleCode && x.code === c.cibleCode));
  const decide = async (x: any | null) => {
    try {
      await api.post(orgPath(o, `/import-airs/lots/${lotId}/concordances/${c.id}`), x ? { cibleType: CIBLE_TYPE[c.axe], cibleId: x.id ?? null, cibleCode: x.code ?? null, cibleLibelle: x.libelle, etat: 'manuelle' } : { etat: 'ignoree' });
      toast(x ? 'Concordance validÃ©e' : 'Valeur ignorÃ©e'); onDone();
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const verifierAd = async () => { try { setVerif((await api.post(orgPath(o, '/import-airs/agents/verifier'), { valeurs: [{ nom: c.sourceCode }] })).data.items[0]); } catch (e) { toast(errMsg(e), 'ko'); } };
  const e = ETAT[c.etat] ?? ETAT.a_faire;
  return (
    <tr className={c.bloquant && !['manuelle', 'ignoree'].includes(c.etat) ? 'bg-warn-bg/40' : ''}>
      <td><div className="font-semibold">{c.sourceCode}</div><div className="text-[11px] text-mute">{c.bloquant && <span className="text-ko">bloquant Â· </span>}{c.occurrence} acte(s)</div></td>
      <td><Badge tone={e.tone}>{e.label}</Badge>{c.confiance != null && c.etat === 'proposee' && <span className="ml-1 text-[11px] text-mute">{Math.round(c.confiance * 100)} %</span>}</td>
      <td>
        <Select className="input" value={courante ? cle(courante) : ''} onChange={(event) => { const x = cibles.find((y) => cle(y) === event.target.value); if (x) decide(x); }}>
          <option value="">â€” choisir une cible â€”</option>
          {cibles.map((x) => <option key={cle(x)} value={cle(x)}>{x.libelle}{x.code && x.code !== x.libelle ? ` (${x.code})` : ''}</option>)}
        </Select>
      </td>
      <td className="whitespace-nowrap text-right">
        {c.axe === 'agent' && <button className="btn-secondary mr-1 !px-2 !py-1 text-[12px]" onClick={verifierAd}>ContrÃ´le AD</button>}
        <button className="rounded p-2 text-ko hover:bg-slate-100" title="Ignorer cette valeur" aria-label={`Ignorer ${c.sourceCode}`} onClick={() => decide(null)}><Ban className="h-4 w-4" /></button>
        {verif && <div className="mt-1 text-left text-[11px] text-mute">{verif.statut === 'connu' ? `AD : connu (${verif.trouves?.[0]?.libelle ?? ''})` : verif.statut === 'jamais_connecte' ? `AD : ${verif.trouves?.[0]?.libelle ?? 'trouvÃ©'}` : `AD : ${verif.statut}`}</div>}
      </td>
    </tr>
  );
}

function Concordances({ o, lotId, conc, onDone }: { o: number; lotId: number; conc: any; onDone: () => void }) {
  const axes = [...new Set((conc.items as any[]).map((c) => c.axe))] as string[];
  const cibles = useLoad(async () => {
    const out: Record<string, any[]> = {};
    await Promise.all(axes.map(async (axe) => { out[axe] = (await api.get(orgPath(o, '/import-airs/cibles'), { params: { axe } })).data.items as any[]; }));
    return out;
  }, [o, lotId, axes.join(',')]);
  if (!conc.items.length) return <Empty>Aucune valeur Ã  concorder : analysez le lot.</Empty>;
  if (cibles.loading) return <Loading />;
  return (
    <div className="space-y-4">
      {conc.items.some((c: any) => c.bloquant && !['manuelle', 'ignoree'].includes(c.etat)) && <p className="flex items-center gap-2 rounded bg-warn-bg px-3 py-2 text-[13px] text-warn"><AlertTriangle className="h-4 w-4" /> La publication reste bloquÃ©e tant que les concordances bloquantes ne sont pas validÃ©es ou ignorÃ©es.</p>}
      {axes.map((axe) => {
        const rows = conc.items.filter((c: any) => c.axe === axe);
        return (
          <section key={axe} className="card overflow-x-auto">
            <div className="flex items-center justify-between border-b border-line px-4 py-2"><b>{AXES[axe] ?? axe}</b><span className="text-[12px] text-mute">{rowCount(rows)}</span></div>
            <table className="w-full"><thead><tr><th>Valeur AIRS</th><th>Ã‰tat</th><th>Cible dans VibeDÃ©lib</th><th /></tr></thead>
              <tbody>{rows.map((c: any) => <LigneConcordance key={c.id} o={o} lotId={lotId} c={c} cibles={cibles.data?.[axe] ?? []} onDone={onDone} />)}</tbody></table>
          </section>
        );
      })}
    </div>
  );
}

const rowCount = (rows: any[]) => `${rows.filter((c) => ['manuelle', 'ignoree'].includes(c.etat)).length}/${rows.length} rÃ©solue(s)`;

function Actes({ o, lotId, detail, onDone }: { o: number; lotId: number; detail: any; onDone: () => void }) {
  const { toast } = useToast();
  const actes = (detail.items as any[]).filter((x) => x.kind === 'acte');
  const agir = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); onDone(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (!actes.length) return <Empty>Aucun acte dÃ©tectÃ© dans ce lot.</Empty>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full"><thead><tr><th>Acte</th><th>SÃ©ance</th><th>Ã‰tat</th><th /></tr></thead><tbody>{actes.map((x) => (
        <tr key={x.id}>
          <td><div className="font-semibold">{clamp(String(x.payload.titre ?? x.payload.objet ?? '(sans objet)'))}</div><div className="text-[11px] text-mute">{x.sourceKey} Â· {x.payload.numero ?? ''}</div></td>
          <td className="text-[12px]">{x.payload.date ? dt(x.payload.date, { dateStyle: 'medium' }) : 'â€”'}</td>
          <td>{x.statut === 'publie' ? <Badge tone="ok">PubliÃ©</Badge> : x.statut === 'ignore' ? <Badge tone="gray">IgnorÃ©</Badge> : x.problemes?.length ? <span className="text-[12px] text-ko">{x.problemes.map((p: any) => p.label).join(' Â· ')}</span> : <Badge tone="blue">PrÃªt</Badge>}</td>
          <td className="whitespace-nowrap text-right">
            {x.statut !== 'publie' && <button className="btn-primary mr-1 !px-2 !py-1 text-[12px]" disabled={!!x.problemes?.length} onClick={() => agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/actes/${x.id}/publier`), {}), 'Acte publiÃ©')}><Check className="h-3.5 w-3.5" /> Publier</button>}
            {x.statut !== 'publie' && <button className="rounded p-2 text-ko hover:bg-slate-100" title="Ignorer" aria-label="Ignorer" onClick={() => agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/actes/${x.id}/ignorer`), {}), 'Acte ignorÃ©')}><XCircle className="h-4 w-4" /></button>}
          </td>
        </tr>))}</tbody></table>
    </div>
  );
}

function Detail({ o, lotId, onRetour, onRechargeListe }: { o: number; lotId: number; onRetour: () => void; onRechargeListe: () => void }) {
  const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, `/import-airs/lots/${lotId}`))).data as any, [o, lotId]);
  const [charger, setCharger] = useState(false); const [mapping, setMapping] = useState(false);
  const recharger = () => { d.reload(); onRechargeListe(); };
  const agir = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); recharger(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (d.loading && !d.data) return <Loading />;
  const lot = d.data.lot;
  const etapes = [
    { k: 'charger', label: '1. Charger le sas', fait: ['charge', 'concordances', 'analyse', 'pret', 'publie'].includes(lot.statut) },
    { k: 'analyser', label: '2. Analyser', fait: ['concordances', 'pret', 'publie'].includes(lot.statut) },
    { k: 'concordances', label: '3. Concordances', fait: d.data.blocage.bloquantesNonResolues === 0 && ['concordances', 'pret', 'publie'].includes(lot.statut) },
    { k: 'publier', label: '4. Publier', fait: lot.statut === 'publie' },
  ];
  return (
    <div className="space-y-4">
      <button className="btn-secondary" onClick={onRetour}><ChevronLeft className="h-4 w-4" /> Tous les lots</button>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1"><div className="text-[15px] font-bold text-head">{lot.label}</div><div className="text-[12px] text-mute">{lot.mode === 'passes' ? 'SÃ©ances passÃ©es' : 'SÃ©ances passÃ©es + actes en prÃ©paration'} Â· source {lot.sourceKind} Â· crÃ©Ã© le {dt(lot.createdAt, { dateStyle: 'medium' })}</div></div>
        <Badge tone={(LOT[lot.statut] ?? LOT.brouillon).tone}>{(LOT[lot.statut] ?? LOT.brouillon).label}</Badge>
        <span className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={lot.statut === 'annule'} onClick={() => setCharger(true)}><Upload className="h-4 w-4" /> Charger</button>
          <button className="btn-secondary" disabled={!['charge', 'concordances', 'pret'].includes(lot.statut)} onClick={() => agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/analyser`), {}), 'Lot analysÃ©')}><Play className="h-4 w-4" /> Analyser</button>
          <button className="btn-secondary" onClick={() => setMapping(true)}><Cog className="h-4 w-4" /> Mapping</button>
          <button className="btn-primary" disabled={!['concordances', 'pret'].includes(lot.statut) || d.data.blocage.bloquantesNonResolues > 0} onClick={() => agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/publier`), {}), 'Publication traitÃ©e')}><Check className="h-4 w-4" /> Publier tout</button>
          {(d.data.compteurs.publies > 0 || lot.statut !== 'annule') && <button className="btn-secondary text-ko" onClick={() => window.confirm('Annuler ce lot et retirer ses publications ?') && agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/annuler`), {}), 'Lot annulÃ©')}><Ban className="h-4 w-4" /> Annuler</button>}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">{etapes.map((e) => <span key={e.k} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${e.fait ? 'bg-ok-bg text-ok-text' : 'bg-soft text-mute'}`}>{e.fait ? 'âœ“ ' : ''}{e.label}</span>)}</div>

      <div className="grid gap-3 md:grid-cols-4">
        {[['SÃ©ances', d.data.compteurs.seances], ['Actes', d.data.compteurs.actes], ['PrÃªts Ã  publier', d.data.compteurs.prets], ['PubliÃ©s', d.data.compteurs.publies]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><div className="text-[12px] text-mute">{l}</div><div className="text-[24px] font-bold text-head">{v as number}</div></div>))}
      </div>

      <section className="space-y-3"><h3>Concordances</h3><Concordances o={o} lotId={lotId} conc={d.data.concordances} onDone={recharger} /></section>
      <section className="space-y-3"><h3>Actes du sas</h3><Actes o={o} lotId={lotId} detail={d.data} onDone={recharger} /></section>

      <section className="card p-4"><h3 className="mb-2">Journal du lot</h3>
        <table className="w-full"><tbody>{d.data.events.map((e: any, i: number) => <tr key={i}><td className="w-40 text-[12px] text-mute">{dt(e.at)}</td><td className="font-mono text-[12px]">{e.action}</td><td className="text-[12px]">{e.actor}</td></tr>)}</tbody></table>
      </section>

      {charger && <Charger o={o} lot={lot} onClose={() => setCharger(false)} onDone={() => { setCharger(false); recharger(); }} />}
      {mapping && <Mapping o={o} onClose={() => setMapping(false)} onDone={() => { setMapping(false); recharger(); }} />}
      {node}
    </div>
  );
}

export default function AdminImportAirs() {
  const { org } = useAuth(); const o = org!.id;
  const liste = useLoad(async () => (await api.get(orgPath(o, '/import-airs'))).data as any, [o]);
  const [lotId, setLotId] = useState<number | null>(null);
  const [nouveau, setNouveau] = useState(false);
  if (lotId) return <Detail o={o} lotId={lotId} onRetour={() => setLotId(null)} onRechargeListe={liste.reload} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-mute">Reprise de l'historique <b>AIRS DELIB</b> en trois temps : <b>sas</b> (donnÃ©es brutes, invisibles), <b>concordances</b> (rapprochement avec vos Ã©lus, directions, services, agents et rÃ©fÃ©rentiels dÃ©jÃ  paramÃ©trÃ©s, validÃ© par vous), puis <b>publication</b> des actes des sÃ©ances passÃ©es. La source est fournie par le HUB DSI ; rien n'est Ã©crit dans l'outil avant validation.</p>
        <button className="btn-primary" onClick={() => setNouveau(true)}><Plus className="h-4 w-4" /> Nouveau lot</button>
      </div>
      <div className="card overflow-x-auto">
        {liste.loading && !liste.data ? <Loading /> : !liste.data?.items?.length ? <Empty>Aucun lot de reprise. CrÃ©ez un lot, chargez l'export du HUB (ou le jeu d'essai) puis analysez-le.</Empty> : (
          <table className="w-full"><thead><tr><th>Lot</th><th>PÃ©rimÃ¨tre</th><th>Ã‰tat</th><th>Actes</th><th>PubliÃ©s</th><th /></tr></thead><tbody>{liste.data.items.map((l: any) => (
            <tr key={l.id} className="cursor-pointer hover:bg-soft" onClick={() => setLotId(l.id)}>
              <td><div className="font-semibold">{l.label}</div><div className="text-[11px] text-mute">{dt(l.createdAt, { dateStyle: 'medium' })}</div></td>
              <td className="text-[12px]">{l.mode === 'passes' ? 'SÃ©ances passÃ©es' : '+ prÃ©paration'}</td>
              <td><Badge tone={(LOT[l.statut] ?? LOT.brouillon).tone}>{(LOT[l.statut] ?? LOT.brouillon).label}</Badge></td>
              <td>{l.items.actes}</td>
              <td>{l.items.publies}</td>
              <td className="text-right">{l.statut === 'annule' ? <Ban className="ml-auto h-4 w-4 text-mute" /> : <FileJson className="ml-auto h-4 w-4 text-mute" />}</td>
            </tr>))}</tbody></table>)}
      </div>
      <p className="flex items-center gap-2 text-[12px] text-mute"><RefreshCw className="h-3.5 w-3.5" /> Le mapping des tables AIRS est dÃ©claratif : il sera renseignÃ© dÃ¨s que le MCD d'AIRS sera connu (Q-AIRS2).</p>
      {nouveau && <NouveauLot o={o} onClose={() => setNouveau(false)} onDone={(lot) => { setNouveau(false); liste.reload(); setLotId(lot.id); }} />}
    </div>
  );
}
