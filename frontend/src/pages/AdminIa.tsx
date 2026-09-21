import { useState } from 'react';
import { Star } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, MailSwitch, Field, Loading, Spinner, useLoad, useToast } from '../ui';
import { AgentName } from '../AgentName';
import { oublierIa } from '../useIa';
import { Select } from '../Select';

const LIMITS: [string, string, string][] = [
  ['max_concurrent', 'Requêtes simultanées', "Nombre maximal d'appels à l'IA en même temps, tous utilisateurs confondus (l'IA est partagée : restez prudent)."],
  ['max_par_utilisateur', 'Par utilisateur', "Nombre de demandes d'un même utilisateur traitées en même temps ; les autres attendent (file « à tour de rôle »)."],
  ['file_max', 'Taille de la file', "Au-delà, les nouvelles demandes sont refusées (« file pleine »)."],
  ['file_max_par_utilisateur', 'Demandes par utilisateur', "En attente + en cours, par utilisateur."],
  ['intervalle_ms', 'Intervalle entre deux appels (ms)', "Délai minimal entre deux appels à l'IA, pour lisser la charge."],
  ['timeout_s', "Délai d'un appel (s)", "Au-delà, l'appel est abandonné (et retenté)."],
  ['tentatives', 'Essais par demande', "Nombre d'essais (avec temporisation croissante) avant de déclarer l'échec."],
];

type Prompt = { code: string; label: string; aide: string; defaut: string | null; texte: string | null; personnalise: boolean; format: string | null; modele: string | null; actif: boolean; sansConsigne?: boolean };

/** Une fonction de l'IA : sa consigne (modifiable), le format de réponse imposé (lecture seule) et son modèle. */
function PromptCard({ p, modeles, onSaved }: { p: Prompt; modeles: string[] | null; onSaved: () => void }) {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const [texte, setTexte] = useState(p.texte ?? ''); const [modele, setModele] = useState(p.modele ?? ''); const [busy, setBusy] = useState(false);
  const dirty = texte.trim() !== (p.texte ?? '').trim() || (modele || '') !== (p.modele ?? '');
  const call = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try { await api.put(orgPath(o, `/ia/prompts/${p.code}`), body); oublierIa(); toast(ok); onSaved(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  // le modèle actuellement configuré reste sélectionnable même s'il ne figure plus dans la liste de l'IA
  const choix = [...new Set([...(modeles ?? []), ...(p.modele ? [p.modele] : [])])];
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2"><label className="flex items-center gap-2" title={p.actif ? 'Cet usage de l’IA est activé' : 'Cet usage de l’IA est désactivé : aucun bouton, aucun appel'}><MailSwitch on={p.actif} disabled={busy} onChange={(v) => call({ actif: v }, v ? 'Usage de l’IA activé' : 'Usage de l’IA désactivé : boutons masqués, aucun appel')} label={`Activer : ${p.label}`} /><h4 className="!text-[15px]">{p.label}</h4></label>{!p.actif && <Badge tone="ko">désactivé</Badge>}{p.personnalise && <Badge tone="blue">consigne personnalisée</Badge>}{p.modele && <Badge tone="ok">modèle : {p.modele}</Badge>}</div>
      <p className="mb-3 text-[12px] text-mute">{p.aide}</p>
      {p.sansConsigne ? null : <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <Field label="Consigne envoyée à l’IA" hint="Rôle et mission : ce que l’IA doit faire, et ne pas faire. Le format de réponse ci-dessous est ajouté automatiquement.">
          <textarea className="input min-h-[150px] font-mono text-[12px] leading-relaxed" value={texte} onChange={(e) => setTexte(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Modèle" hint={modeles ? 'Liste fournie par l’IA interne.' : 'La liste des modèles n’est pas disponible : saisissez le nom du modèle.'}>
          {modeles ? (
            <Select className="input" value={modele} onChange={(e) => setModele(e.target.value)}><option value="">Modèle par défaut de l’IA</option>{choix.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
          ) : <input className="input" value={modele} onChange={(e) => setModele(e.target.value)} placeholder="Modèle par défaut de l’IA" />}
        </Field>
      </div>}
      {!p.sansConsigne && <details className="mt-2 text-[12px]"><summary className="cursor-pointer font-semibold text-mute">Format de réponse imposé (non modifiable)</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-soft p-2 text-[11px] leading-relaxed">{p.format}</pre></details>}
      {!p.sansConsigne && <div className="mt-3 flex flex-wrap justify-end gap-2">
        {(p.personnalise || p.modele) && <button className="btn-secondary" disabled={busy} onClick={() => { setTexte(p.defaut ?? ''); setModele(''); call({ texte: null, modele: null }, 'Valeurs par défaut rétablies'); }}>Rétablir les valeurs par défaut</button>}
        <button className="btn-secondary" disabled={busy || texte === p.defaut} onClick={() => setTexte(p.defaut ?? '')}>Consigne d’origine</button>
        <button className="btn-primary" disabled={busy || !dirty} onClick={() => call({ texte: texte.trim() === (p.defaut ?? '').trim() ? null : texte, modele: modele || null }, 'Consigne et modèle enregistrés')}>{busy && <Spinner />} Enregistrer</button>
      </div>}{node}
    </div>
  );
}

function Prompts() {
  const { org } = useAuth(); const o = org!.id;
  const r = useLoad(async () => (await api.get(orgPath(o, '/ia/prompts'))).data as { items: Prompt[]; modeles: string[] | null }, [o]);
  if (r.loading || !r.data) return <Loading />;
  return (
    <section className="card p-5"><h3 className="mb-1">Consignes et modèles</h3>
      <p className="mb-4 text-[13px] text-mute">Pour chaque fonction de l’assistant, modifiez la consigne envoyée à l’IA et choisissez le modèle qui la traite. La consigne d’origine peut être rétablie à tout moment ; le format de réponse attendu reste imposé pour que les propositions restent lisibles. Les modifications s’appliquent à la prochaine demande.</p>
      <div className="space-y-4">{r.data.items.map((p) => <PromptCard key={`${p.code}:${p.texte}:${p.modele}:${p.actif}`} p={p} modeles={r.data!.modeles} onSaved={r.reload} />)}</div>
    </section>
  );
}

/** Journal de l'aide IA de Del-IA : questions, réponses, notes et commentaires, avec la moyenne des notes. */
function JournalAide() {
  const { org } = useAuth(); const o = org!.id;
  const r = useLoad(async () => (await api.get(orgPath(o, '/ia/delia/journal'))).data, [o]);
  if (r.loading) return <Loading />;
  if (r.error) return <section className="card p-5"><ErrorBox msg={r.error} /></section>;
  const st = r.data?.stats ?? { notes: 0, moyenne: null, repartition: { 1: 0, 2: 0, 3: 0, 4: 0 } };
  const Etoiles = ({ n }: { n: number | null }) => n ? <span className="whitespace-nowrap">{[1, 2, 3, 4].map((k) => <Star key={k} className={`inline h-3.5 w-3.5 ${k <= n ? 'fill-warn text-warn' : 'text-mute'}`} />)}</span> : <span className="text-mute">—</span>;
  return (
    <section className="card p-5">
      <h3 className="mb-1">Aide IA d'Evelyne Del-IA — journal et satisfaction</h3>
      <p className="mb-4 text-[13px] text-mute">Questions posées à Evelyne Del-IA, réponses apportées, note de l'agent (« ma réponse vous a-t-elle convenu ? », 1 à 4 étoiles) et commentaire éventuel. La moyenne des notes mesure la qualité des réponses.</p>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-line p-4">
          <div className="text-[12px] text-mute">Note moyenne</div>
          <div className="text-[28px] font-bold text-head">{st.moyenne ?? '—'}{st.moyenne !== null && <span className="text-[14px] font-normal text-mute"> / 4</span>}</div>
          <div className="text-[12px] text-mute">{st.notes} réponse(s) notée(s)</div>
        </div>
        <div className="rounded-lg border border-line p-4"><div className="text-[12px] text-mute">Questions posées</div><div className="text-[28px] font-bold text-head">{r.data?.total ?? 0}</div></div>
        <div className="rounded-lg border border-line p-4">
          <div className="text-[12px] text-mute">Répartition des notes</div>
          <ul className="mt-1 space-y-0.5 text-[12px]">{[4, 3, 2, 1].map((k) => <li key={k} className="flex items-center gap-2"><Etoiles n={k} /> <b>{st.repartition[k]}</b></li>)}</ul>
        </div>
      </div>
      {!r.data?.items.length ? <p className="p-6 text-center text-mute">Aucune question posée pour l'instant.</p> : (
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>Date</th><th>Agent</th><th>Question</th><th>Réponse</th><th>Note</th><th>Commentaire</th></tr></thead><tbody>
          {r.data.items.map((j: any) => (
            <tr key={j.id}>
              <td className="whitespace-nowrap text-[12px] text-mute">{dt(j.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td><AgentName u={j.username} /></td>
              <td className="max-w-[280px] text-[12px]">{j.question}</td>
              <td className="max-w-[380px] text-[12px]"><details><summary className="cursor-pointer text-action">Voir la réponse</summary><div className="mt-1 whitespace-pre-wrap text-slate-700">{j.reponse}</div></details></td>
              <td><Etoiles n={j.note} /></td>
              <td className="max-w-[220px] text-[12px] text-slate-700">{j.commentaire || <span className="text-mute">—</span>}</td>
            </tr>))}
        </tbody></table></div>
      )}
    </section>
  );
}

/** Paramétrage et supervision de la file d'attente de l'IA (D52). */
export default function AdminIa() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const ov = useLoad(async () => (await api.get(orgPath(o, '/ia/file'))).data, [o]);
  const jobs = useLoad(async () => (await api.get(orgPath(o, '/ia/taches'), { params: { scope: 'all' } })).data.items as any[], [o]);
  const [vals, setVals] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  if (ov.loading && !ov.data) return <Loading />;
  const cur = (k: string) => vals[k] ?? String(ov.data?.limits[k] ?? '');
  const save = async () => {
    setBusy(true);
    try {
      for (const [k] of LIMITS) if (vals[k] !== undefined && vals[k] !== String(ov.data.limits[k])) await api.put(orgPath(o, `/settings/ai.${k}`), { value: Number(vals[k]), scope: 'organisme' });
      toast('Paramètres enregistrés'); setVals({}); ov.reload();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const cancel = async (id: number) => { try { await api.delete(orgPath(o, `/ia/taches/${id}`)); jobs.reload(); ov.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const TONE: Record<string, any> = { queued: 'gray', running: 'blue', done: 'ok', error: 'ko', cancelled: 'warn' };
  const LABEL: Record<string, string> = { queued: 'en attente', running: 'en cours', done: 'terminée', error: 'échec', cancelled: 'annulée' };
  return (
    <div className="space-y-6">
      <Prompts />
      <JournalAide />
      <p className="text-mute">Toute interrogation de l'IA se fait <b>en arrière plan</b>, dans une file d'attente : les agents continuent à travailler et voient un indicateur d'avancement. Ces limites évitent de surcharger l'IA.</p>
      <div className="grid gap-4 md:grid-cols-4">{[['En attente', ov.data.queued], ['En cours', ov.data.running], ['Terminées (24 h)', ov.data.done], ['En échec (24 h)', ov.data.errors]].map(([l, v]) => (
        <div key={l as string} className="card p-4"><div className="text-[12px] text-mute">{l}</div><div className="text-[28px] font-bold text-head">{v}</div></div>))}</div>
      <section className="card p-5"><h3 className="mb-3">Limites</h3>
        <div className="grid gap-4 md:grid-cols-2">{LIMITS.map(([k, l, h]) => (
          <Field key={k} label={l} hint={`${h} Défaut : ${ov.data.defaults[k]}.`}><input className="input" type="number" min={k === 'intervalle_ms' ? 0 : 1} value={cur(k)} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>))}</div>
        <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={busy || !Object.keys(vals).length} onClick={save}>{busy && <Spinner />} Enregistrer</button></div>
      </section>
      <section className="card"><div className="border-b border-line px-5 py-3"><h3>Demandes récentes</h3></div>
        {jobs.loading ? <Loading /> : !jobs.data?.length ? <p className="p-6 text-center text-mute">Aucune demande.</p> : (
          <table className="w-full"><thead><tr><th>#</th><th>Demandeur</th><th>Dossier</th><th>Statut</th><th>Avancement</th><th>Déposée</th><th /></tr></thead><tbody>{jobs.data.map((j) => (
            <tr key={j.id}><td>{j.id}</td><td><AgentName u={j.requestedBy} /></td><td>{j.acteId ? `#${j.acteId}` : '—'}</td><td><Badge tone={TONE[j.status]}>{LABEL[j.status]}</Badge>{j.status === 'queued' && <span className="ml-1 text-[11px] text-mute">n° {j.position}</span>}</td>
              <td className="text-[12px]">{j.status === 'error' ? <span className="text-ko">{j.error}</span> : `${j.progress}/${j.total || '?'} ${j.stepLabel ?? ''}`}</td><td className="text-[12px] text-mute">{dt(j.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className="text-right">{(j.status === 'queued' || j.status === 'running') && <button className="btn-secondary !py-1" onClick={() => cancel(j.id)}>Annuler</button>}</td></tr>))}</tbody></table>)}
      </section>{node}
    </div>
  );
}
