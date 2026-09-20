import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FastForward, FileText, FlaskConical, RefreshCw, Send, Stamp, XCircle } from 'lucide-react';
import { api, errMsg, openPdf, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, MailSwitch, Modal, PageTitle, Spinner, useLoad, useToast } from '../ui';

const STATUS_TONE: Record<string, 'ok' | 'ko' | 'warn' | 'blue' | 'gray'> = { '-1': 'ko', '0': 'gray', '1': 'blue', '2': 'blue', '3': 'blue', '4': 'ok', '5': 'ok', '6': 'ko', '17': 'warn' };
const DOC_LABEL: Record<number, string> = { 2: 'Courrier simple', 3: 'Demande de pièces complémentaires', 4: 'Lettre d’observations', 5: 'Déféré au tribunal administratif' };
const JOURNAL: Record<string, string> = { prepare: 'Préparée', poste: 'Postée à S²LOW', confirme: 'Confirmée', statut: 'Changement de statut', document: 'Document de la préfecture reçu', reponse: 'Réponse à la préfecture', annule: 'Annulée', echec: 'Refus de S²LOW' };
const TABS = [['lot', 'À transmettre'], ['suivi', 'Suivi'], ['documents', 'Documents de la préfecture'], ['simulation', 'Simulation'], ['params', 'Paramètres']] as const;
type Tab = typeof TABS[number][0];

const StatusBadge = ({ tx }: { tx: any }) => (tx.etat === 'prepare' ? <Badge tone="warn">Préparée — à envoyer</Badge> : tx.etat === 'erreur' ? <Badge tone="ko">Refusée par S²LOW</Badge>
  : <Badge tone={STATUS_TONE[String(tx.status)] ?? 'gray'}>{tx.status !== null ? `${tx.status} · ` : ''}{tx.statusLabel ?? tx.etat}</Badge>);

/** Contrôle de légalité : télétransmission des délibérations adoptées à la préfecture via S²LOW (TLT-01 à TLT-19). Mode simulation tant que l'accès n'est pas obtenu. */
export default function Teletransmission() {
  const { org, isAdmin } = useAuth(); const o = org!.id; const root = (p = '') => orgPath(o, `/teletransmission${p}`); const { toast, node } = useToast();
  const [tab, setTab] = useState<Tab>('lot'); const [busy, setBusy] = useState<string | null>(null);
  const cfg = useLoad(async () => (await api.get(root('/config'))).data, [o]);
  const tab$ = useLoad(async () => (await api.get(root('/tableau'))).data, [o]);
  const [rev, setRev] = useState(0); const bump = () => { setRev((n) => n + 1); tab$.reload(); };
  const sim = cfg.data?.mode === 'simulation';

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast(ok); bump(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); } };
  const suivre = () => act('suivi', () => api.post(root('/suivi')), 'Suivi effectué : statuts et documents à jour');

  if (cfg.loading || !cfg.data) return <Loading />;
  const t = tab$.data;
  return (
    <div>
      <PageTitle title="Contrôle de légalité" sub="Télétransmission des délibérations adoptées à la préfecture, via S²LOW." actions={<button className="btn-secondary" disabled={busy === 'suivi'} onClick={suivre}>{busy === 'suivi' ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Interroger S²LOW</button>} />
      {sim && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn-bg p-3 text-[13px] text-warn" role="status">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
          <div><b>Mode simulation.</b> L’accès à S²LOW n’est pas encore obtenu : les envois sont joués par un simulateur qui reproduit les réponses de S²LOW et les retours de la préfecture (accusé de réception, demande de pièces, observations, refus…). Aucun document ne part vers une préfecture. Utilisez l’onglet « Simulation » pour faire avancer les dossiers.</div>
        </div>)}
      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {([['À préparer', t.aPreparer], ['Préparées', t.preparees], ['À confirmer', t.enAttenteConfirmation], ['En attente d’AR', t.enAttenteAr], ['Acquittées', t.acquittees], ['En erreur', t.enErreur], ['Documents préfecture', t.documentsATraiter]] as const).map(([l, v]) => (
            <div key={l} className="card p-3"><div className="text-[11px] uppercase tracking-wider text-mute">{l}</div><div className={`text-[24px] font-bold ${(l === 'En erreur' || l === 'Documents préfecture') && v > 0 ? 'text-ko' : 'text-head'}`}>{v}</div></div>))}
        </div>)}
      <div className="mb-4 flex w-fit max-w-full overflow-x-auto rounded bg-surface p-1 shadow-card" role="tablist">{TABS.filter(([k]) => k !== 'params' || isAdmin).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded px-3 py-2 text-[13px] font-semibold ${tab === k ? 'bg-primary text-white' : ''}`}>{l}</button>))}</div>

      {tab === 'lot' && <Lot root={root} cfg={cfg.data} onDone={bump} toast={toast} />}
      {tab === 'suivi' && <Suivi root={root} rev={rev} cfg={cfg.data} act={act} busy={busy} />}
      {tab === 'documents' && <Documents root={root} rev={rev} onDone={bump} toast={toast} />}
      {tab === 'simulation' && <Simulation root={root} rev={rev} cfg={cfg.data} act={act} busy={busy} />}
      {tab === 'params' && isAdmin && <Params root={root} cfg={cfg.data} onSaved={() => { cfg.reload(); bump(); }} toast={toast} />}
      {node}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------------- lot d'une séance */
function Lot({ root, cfg, onDone, toast }: { root: (p?: string) => string; cfg: any; onDone: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const { org } = useAuth(); const o = org!.id;
  const seances = useLoad(async () => ((await api.get(orgPath(o, '/seances'), { params: { limit: 100, kind: 'conseil' } })).data.items as any[]).filter((s) => ['tenue', 'close'].includes(s.statut)), [o]);
  const [sid, setSid] = useState<number | null>(null); const [pick, setPick] = useState<Set<number>>(new Set()); const [scenario, setScenario] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (sid === null && seances.data?.length) setSid(seances.data[0].id); }, [seances.data, sid]);
  const lot = useLoad(async () => (sid ? (await api.get(root(`/seances/${sid}/lot`))).data : null), [sid, o]);
  const items: any[] = lot.data?.items ?? [];
  const prets = items.filter((i) => i.statut === 'a_preparer' && !i.controles.some((c: any) => c.niveau === 'bloquant'));
  const toggle = (id: number) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const preparer = async () => {
    setBusy(true);
    try {
      const r = (await api.post(root(`/seances/${sid}/preparation`), { itemIds: [...pick], scenario: scenario || undefined })).data;
      toast(`${r.crees.length} transmission(s) préparée(s)${r.refuses.length ? `, ${r.refuses.length} refusée(s) : ${r.refuses.map((x: any) => x.raisons.join(' ; ')).join(' | ')}` : ''}`, r.refuses.length ? 'ko' : 'ok');
      setPick(new Set()); lot.reload(); onDone();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  if (seances.loading) return <Loading />;
  if (!seances.data?.length) return <div className="card p-8 text-center text-mute">Aucune séance tenue : le lot de télétransmission se construit à partir des résultats du suivi de séance.</div>;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <Field label="Séance"><select className="input !w-auto" value={sid ?? ''} onChange={(e) => { setSid(Number(e.target.value)); setPick(new Set()); }}>{seances.data.map((s) => <option key={s.id} value={s.id}>{s.instance} — {dt(s.dateSeance, { dateStyle: 'long' })}</option>)}</select></Field>
        {cfg.mode === 'simulation' && <Field label="Scénario de simulation"><select className="input !w-auto" value={scenario} onChange={(e) => setScenario(e.target.value)}><option value="">Par défaut ({cfg.scenarios.find((s: any) => s.code === cfg.scenario)?.label})</option>{cfg.scenarios.map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></Field>}
        <div className="ml-auto flex items-center gap-2"><button className="btn-secondary" onClick={() => setPick(new Set(prets.map((i) => i.itemId)))} disabled={!prets.length}>Tout sélectionner</button>
          <button className="btn-primary" disabled={busy || !pick.size} onClick={preparer}>{busy ? <Spinner /> : <Send className="h-4 w-4" />} Préparer {pick.size || ''} transmission(s)</button></div>
      </div>
      {lot.loading ? <Loading /> : lot.data?.message ? <p className="p-6 text-mute">{lot.data.message}</p> : (
        <table className="w-full"><thead><tr><th className="w-8" /><th>N°</th><th>Délibération</th><th>Vote</th><th>Numéro transmis</th><th>Contrôles</th></tr></thead><tbody>{items.map((i) => {
          const bloque = i.controles?.some((c: any) => c.niveau === 'bloquant');
          return (
            <tr key={i.itemId} className={i.statut === 'exclu' ? 'bg-slate-50 text-mute' : ''}>
              <td>{i.statut === 'a_preparer' && <input type="checkbox" aria-label={`Sélectionner ${i.titre}`} disabled={bloque} checked={pick.has(i.itemId)} onChange={() => toggle(i.itemId)} />}</td>
              <td className="font-mono text-[12px]">{i.numero ?? '—'}</td><td className="font-semibold">{i.titre}</td>
              <td>{i.resultat ? <Badge tone={i.resultat.startsWith('adopte') ? 'ok' : 'ko'}>{i.resultat.startsWith('adopte') ? 'Adoptée' : 'Rejetée'}</Badge> : <Badge>{i.etatPoint}</Badge>}</td>
              <td className="font-mono text-[12px]">{i.numeroTransmis ?? i.transaction?.numeroTransmis ?? '—'}</td>
              <td className="text-[12px]">
                {i.statut === 'exclu' && <span>Exclue : {i.raison}</span>}
                {i.statut === 'en_cours' && <span className="text-ok">Déjà préparée ou transmise <StatusBadge tx={i.transaction} /></span>}
                {i.statut === 'a_preparer' && (i.controles.length ? <ul>{i.controles.map((c: any, k: number) => <li key={k} className={c.niveau === 'bloquant' ? 'font-semibold text-ko' : 'text-warn'}>{c.niveau === 'bloquant' ? '⛔' : '⚠'} {c.message}</li>)}</ul> : <span className="text-ok">✓ Prête</span>)}
              </td>
            </tr>);
        })}</tbody></table>)}
    </div>
  );
}

/* --------------------------------------------------------------------------------------------------------------- suivi */
function Suivi({ root, rev, cfg, act, busy }: { root: (p?: string) => string; rev: number; cfg: any; act: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<void>; busy: string | null }) {
  const list = useLoad(async () => (await api.get(root('/transactions'))).data.items as any[], [rev]);
  const [open, setOpen] = useState<number | null>(null); const detail = useLoad(async () => (open ? (await api.get(root(`/transactions/${open}`))).data : null), [open, rev]);
  const { toast } = useToast();
  const pdf = async (path: string, titre: string) => { const m = await openPdf(() => api.get(root(path), { responseType: 'blob' }), titre); if (m) toast(m, 'ko'); };
  if (list.loading) return <Loading />;
  if (!list.data?.length) return <div className="card p-8 text-center text-mute">Aucune transmission. Préparez-en depuis l’onglet « À transmettre ».</div>;
  return (
    <div className="card overflow-hidden">
      <table className="w-full"><thead><tr><th>Numéro transmis</th><th>Délibération</th><th>État</th><th>Identifiant S²LOW</th><th>AR préfecture</th><th /></tr></thead><tbody>{list.data.map((x) => (
        <>
          <tr key={x.id}>
            <td className="font-mono text-[12px]">{x.numeroTransmis}<div className="font-sans text-[11px] text-mute">{x.mode === 'simulation' ? 'simulation' : x.mode} · {x.enAttente ? 'mode B' : 'mode A'}</div></td>
            <td><b>{x.titre}</b><div className="text-[11px] text-mute">Dossier #{x.numeroSuivi} · acte : {x.acteStatut.replace(/_/g, ' ')}</div></td>
            <td><StatusBadge tx={x} />{x.erreur && <div className="mt-1 text-[11px] text-ko">{x.erreur}</div>}</td>
            <td className="font-mono text-[12px]">{x.remoteId ?? '—'}</td>
            <td className="text-[12px]">{x.arLe ? <><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-ok" />{dt(x.arLe)}<div className="font-mono text-[10px] text-mute">{x.arId}</div></> : '—'}</td>
            <td className="whitespace-nowrap text-right">
              {x.etat === 'prepare' && <button className="btn-primary !py-1" disabled={busy === `e${x.id}`} onClick={() => act(`e${x.id}`, () => api.post(root(`/transactions/${x.id}/envoi`)), cfg.modeEnvoi === 'A' ? 'Transaction postée à S²LOW' : 'Transaction postée « en attente » : à confirmer')}><Send className="h-3.5 w-3.5" /> Envoyer</button>}
              {x.etat === 'poste' && x.status === 17 && <button className="btn-primary !py-1" disabled={busy === `c${x.id}`} onClick={() => act(`c${x.id}`, () => api.post(root(`/transactions/${x.id}/confirmation`)), 'Transaction confirmée : posté')}><CheckCircle2 className="h-3.5 w-3.5" /> Confirmer</button>}
              {x.arId && <><button className="btn-secondary !py-1" onClick={() => pdf(`/transactions/${x.id}/bordereau`, `Bordereau d’acquittement — ${x.numeroTransmis}`)}><FileText className="h-3.5 w-3.5" /> Bordereau</button>
                <button className="btn-secondary ml-1 !py-1" onClick={() => pdf(`/transactions/${x.id}/acte-tamponne`, `Acte tamponné — ${x.numeroTransmis}`)}><Stamp className="h-3.5 w-3.5" /> Acte tamponné</button></>}
              {(x.etat === 'prepare' || (x.etat === 'poste' && ![4, 5, 6].includes(x.status))) && <button className="ml-1 rounded p-1 text-ko hover:bg-ko-bg" title="Annuler" aria-label="Annuler" onClick={() => act(`a${x.id}`, () => api.post(root(`/transactions/${x.id}/annulation`), {}), 'Transaction annulée')}><XCircle className="h-4 w-4" /></button>}
              <button className="ml-1 text-[12px] font-semibold text-action" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'Masquer' : 'Journal'}</button>
            </td>
          </tr>
          {open === x.id && <tr key={`d${x.id}`}><td colSpan={6} className="bg-soft">{detail.loading || !detail.data ? <Loading /> : (
            <ul className="divide-y divide-line text-[12px]">{detail.data.journal.map((j: any) => <li key={j.id} className="flex flex-wrap gap-x-3 py-1"><span className="w-36 shrink-0 font-mono text-mute">{dt(j.at, { dateStyle: 'short', timeStyle: 'medium' })}</span><b>{JOURNAL[j.type] ?? j.type}</b><span className="text-mute">{j.detail ? JSON.stringify(j.detail) : ''}</span><span className="ml-auto text-mute">{j.actor}</span></li>)}</ul>)}</td></tr>}
        </>))}</tbody></table>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ documents de la préfecture */
function Documents({ root, rev, onDone, toast }: { root: (p?: string) => string; rev: number; onDone: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const docs = useLoad(async () => (await api.get(root('/documents'))).data.items as any[], [rev]);
  const [rep, setRep] = useState<any>(null); const [type, setType] = useState<3 | 4>(4); const [msg, setMsg] = useState('');
  const send = async () => { try { await api.post(root(`/documents/${rep.id}/reponse`), { typeEnvoie: type, message: msg || undefined }); toast('Réponse transmise à la préfecture'); setRep(null); setMsg(''); onDone(); docs.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (docs.loading) return <Loading />;
  if (!docs.data?.length) return <div className="card p-8 text-center text-mute">Aucun document de la préfecture.</div>;
  return (
    <div className="space-y-3">
      {docs.data.map((d) => (
        <div key={d.id} className={`card border-l-4 p-4 ${d.statut === 'a_traiter' && d.prioritaire ? 'border-l-ko bg-ko-bg/30' : 'border-l-slate-300'}`}>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={d.statut === 'a_traiter' ? 'ko' : 'ok'}>{d.statut === 'a_traiter' ? 'À traiter' : d.statut === 'repondu' ? 'Répondu' : 'Clos'}</Badge><b>{DOC_LABEL[d.type] ?? d.titre}</b>
            <span className="text-[12px] text-mute">reçu le {dt(d.recuLe)} · {d.numeroTransmis} — {d.acteTitre}</span></div>
          <p className="mt-2 text-[13px]">{d.contenu}</p>
          {d.statut === 'a_traiter' && <div className="mt-3 flex gap-2">{d.type === 3 && <button className="btn-primary" onClick={() => setRep(d)}>Répondre à la préfecture</button>}
            <button className="btn-secondary" onClick={async () => { try { await api.post(root(`/documents/${d.id}/cloture`)); onDone(); docs.reload(); } catch (e) { toast(errMsg(e), 'ko'); } }}>Marquer comme traité</button></div>}
        </div>))}
      {rep && (
        <Modal title="Répondre à la demande de pièces" onClose={() => setRep(null)}>
          <div className="space-y-4"><p className="text-[13px] text-mute">{rep.titre}</p>
            <Field label="Réponse"><select className="input" value={type} onChange={(e) => setType(Number(e.target.value) as 3 | 4)}><option value={4}>Envoi de pièces</option><option value={3}>Refus d’envoi de pièces</option></select></Field>
            <Field label="Message (facultatif)"><textarea className="input" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setRep(null)}>Annuler</button><button className="btn-primary" onClick={send}>Envoyer la réponse</button></div></div>
        </Modal>)}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- simulation */
function Simulation({ root, rev, cfg, act, busy }: { root: (p?: string) => string; rev: number; cfg: any; act: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<void>; busy: string | null }) {
  const sim = useLoad(async () => (await api.get(root('/simulation'))).data, [rev]);
  if (sim.loading || !sim.data) return <Loading />;
  if (!sim.data.actif) return <div className="card p-8 text-center text-mute">La simulation n’est active qu’en mode « simulation » (Paramètres).</div>;
  const avancer = (body: Record<string, unknown>, ok: string, key: string) => act(key, async () => { await api.post(root('/simulation/avancer'), body); sim.reload(); }, ok);
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-[13px] text-mute">Le serveur S²LOW factice fait franchir <b>une étape</b> du scénario à chaque clic : posté → en attente de transmission → transmis → acquittement (ARActe), avec, selon le scénario, une demande de pièces, une lettre d’observations, un déféré ou un refus. Une transaction « en attente d’être postée » attend votre confirmation ; une demande de pièces attend votre réponse.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button className="btn-primary" disabled={busy === 'sa'} onClick={() => avancer({ pas: 1 }, 'Le serveur factice a avancé d’une étape', 'sa')}><FastForward className="h-4 w-4" /> Tout faire avancer d’une étape</button>
          <button className="btn-secondary" disabled={busy === 'sb'} onClick={() => avancer({ pas: 10 }, 'Scénarios déroulés jusqu’au bout (ou jusqu’à la prochaine attente)', 'sb')}>Dérouler jusqu’au bout</button></div>
      </div>
      <div className="card overflow-hidden">
        {!sim.data.serveur.length ? <p className="p-6 text-center text-mute">Le serveur factice n’a encore reçu aucune transaction.</p> : (
          <table className="w-full"><thead><tr><th>Identifiant</th><th>Numéro</th><th>Scénario</th><th>Statut</th><th>Étape</th><th /></tr></thead><tbody>{sim.data.serveur.map((x: any) => (
            <tr key={x.remoteId}><td className="font-mono text-[12px]">{x.remoteId}</td><td className="font-mono text-[12px]">{x.numero}</td>
              <td className="text-[12px]">{sim.data.scenarios.find((s: any) => s.code === x.scenario)?.label}</td>
              <td><Badge tone={STATUS_TONE[String(x.status)] ?? 'gray'}>{x.status} · {x.label}</Badge>{x.attente && <div className="text-[11px] text-warn">La préfecture attend votre réponse</div>}{x.status === 17 && <div className="text-[11px] text-warn">En attente de confirmation</div>}</td>
              <td className="text-[12px]">{x.etape}/{x.etapes}</td>
              <td className="text-right"><button className="btn-secondary !py-1" disabled={!x.peutAvancer || busy === x.remoteId} onClick={() => avancer({ remoteId: x.remoteId, pas: 1 }, 'Étape franchie', x.remoteId)}>Avancer</button></td></tr>))}</tbody></table>)}
      </div>
      <div className="card p-4"><h3 className="mb-2">Scénarios disponibles</h3><ul className="list-disc space-y-0.5 pl-5 text-[13px]">{sim.data.scenarios.map((s: any) => <li key={s.code}><b>{s.code}</b> — {s.label} ({s.etapes} étape{s.etapes > 1 ? 's' : ''})</li>)}</ul>
        <p className="mt-2 text-[12px] text-mute">Le scénario se choisit à la préparation de la transmission (onglet « À transmettre »), ou par défaut dans les paramètres.</p></div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ paramètres */
function Params({ root, cfg, onSaved, toast }: { root: (p?: string) => string; cfg: any; onSaved: () => void; toast: (m: string, k?: 'ok' | 'ko') => void }) {
  const [f, setF] = useState({ mode: cfg.mode, modeEnvoi: cfg.modeEnvoi, scenario: cfg.scenario, siren: cfg.siren, departement: cfg.departement, arrondissement: cfg.arrondissement, motif: cfg.motif, doubleValidation: cfg.doubleValidation });
  const [busy, setBusy] = useState(false);
  const exemple = useMemo(() => f.motif.replace(/\{(\w+)(?::(\d+))?\}/g, (_m: string, k: string, w?: string) => String(({ ANNEE: 2026, TYPE_SEANCE: 'CM', N_SEANCE: 4, ORDRE: 12 } as Record<string, string | number>)[k] ?? '').padStart(Number(w) || 0, '0')).toUpperCase(), [f.motif]);
  const valide = /^[A-Z0-9_]{1,15}$/.test(exemple);
  const save = async () => { setBusy(true); try { await api.put(root('/config'), f); toast('Paramètres enregistrés'); onSaved(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); } };
  return (
    <div className="card space-y-4 p-5">
      <ErrorBox msg={null} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Mode" hint="Les modes « test » et « production » seront disponibles quand le certificat et l’instance de test S²LOW auront été obtenus."><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="simulation">Simulation (aucun envoi réel)</option><option value="test">Instance de test S²LOW</option><option value="production">Production</option></select></Field>
        <Field label="Transmission" hint="Mode B : la transaction est postée « en attente » puis confirmée par une personne identifiée (recommandé)."><select className="input" value={f.modeEnvoi} onChange={(e) => setF({ ...f, modeEnvoi: e.target.value })}><option value="B">B — préparation puis confirmation</option><option value="A">A — envoi direct</option></select></Field>
        <Field label="Scénario de simulation par défaut"><select className="input" value={f.scenario} onChange={(e) => setF({ ...f, scenario: e.target.value })}>{cfg.scenarios.map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></Field>
        <Field label="SIREN"><input className="input" inputMode="numeric" maxLength={9} value={f.siren} onChange={(e) => setF({ ...f, siren: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Département (3 chiffres)"><input className="input" inputMode="numeric" maxLength={3} value={f.departement} onChange={(e) => setF({ ...f, departement: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Arrondissement"><input className="input" inputMode="numeric" maxLength={1} value={f.arrondissement} onChange={(e) => setF({ ...f, arrondissement: e.target.value.replace(/\D/g, '') })} /></Field>
      </div>
      <Field label="Motif du numéro transmis" hint="Variables : {ANNEE} {TYPE_SEANCE} {N_SEANCE:02} {ORDRE:03}. 15 caractères au plus, majuscules, chiffres ou « _ ».">
        <input className="input font-mono" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Field>
      <p className={`text-[13px] ${valide ? 'text-ok' : 'font-semibold text-ko'}`}>Exemple : <code>{exemple}</code> {valide ? '✓ conforme à S²LOW' : `✗ non conforme (${exemple.length} caractères, ou caractère interdit)`}</p>
      <label className="flex items-center gap-3"><MailSwitch on={f.doubleValidation} onChange={(v) => setF({ ...f, doubleValidation: v })} label="Double validation" /><span>Double validation : l’envoi doit être fait par une autre personne que celle qui a préparé la transmission</span></label>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy || !valide} onClick={save}>{busy && <Spinner />} Enregistrer</button></div>
    </div>
  );
}
