import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, BookOpen, CalendarPlus, ClipboardList, Copy, Mail, MoreVertical, Pencil, Radio, RefreshCw, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { AgentName } from '../AgentName';
import { dt } from '../format';
import { Badge, ErrorBox, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { TeamsLink } from '../Reunions';

export const jours = (v?: string | null) => (v ? Math.ceil((new Date(v).getTime() - Date.now()) / 86400000) : null);
const MOIS = ['JAN', 'FÉV', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
const ODJ: Record<string, { label: string; tone: 'ok' | 'warn' | 'blue' | 'gray' }> = {
  en_preparation: { label: 'En préparation', tone: 'warn' }, arrete: { label: 'Ordre du jour arrêté', tone: 'ok' }, convoque: { label: 'Convoquée', tone: 'ok' }, tenue: { label: 'Séance tenue', tone: 'gray' },
};

/** Bloc date « 04 / NOV / 2026 » de la carte (Stitch). */
export function BlocDate({ date, sombre }: { date: string; sombre?: boolean }) {
  const x = new Date(date);
  return (
    <div className={`flex h-[74px] w-[64px] shrink-0 flex-col items-center justify-center rounded-lg ${sombre ? 'bg-primary text-white' : 'bg-soft text-head'}`} aria-hidden="true">
      <span className="text-[22px] font-bold leading-none">{String(x.getDate()).padStart(2, '0')}</span>
      <span className="mt-0.5 text-[11px] font-bold tracking-wider">{MOIS[x.getMonth()]}</span>
      <span className="text-[10px] opacity-70">{x.getFullYear()}</span>
    </div>
  );
}

/** Une des trois tuiles d'indicateurs de la carte. */
function Tuile({ titre, droite, gros, note, children }: { titre: string; droite?: React.ReactNode; gros: React.ReactNode; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-soft/70 p-3">
      <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-bold uppercase tracking-wider text-mute">{titre}</span>{droite}</div>
      <div className="mt-1 flex items-end justify-between gap-2"><span className="text-[26px] font-bold leading-none text-head">{gros}</span>{note && <span className="text-right text-[11px] text-mute">{note}</span>}</div>
      {children}
    </div>
  );
}

/** Menu « ⋮ » d'une carte : modifier, supprimer. */
function Menu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <span className="relative">
      <button type="button" className="rounded-lg bg-soft p-2 text-mute hover:text-head" aria-haspopup="menu" aria-expanded={ouvert} aria-label="Plus d’actions" onClick={() => setOuvert(!ouvert)} onBlur={() => setTimeout(() => setOuvert(false), 150)}><MoreVertical className="h-4 w-4" /></button>
      {ouvert && <div role="menu" className="card absolute right-0 z-20 mt-1 w-44 p-1 shadow-float">
        <button role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-soft" onMouseDown={onEdit}><Pencil className="h-4 w-4" /> Modifier</button>
        <button role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-ko hover:bg-ko-bg" onMouseDown={onDelete}><Trash2 className="h-4 w-4" /> Supprimer</button></div>}
    </span>
  );
}

type Synth = { jours: number; cloture: { date: string; jours: number; passe: boolean } | null; jalons: { code: string; label: string; date: string; passe: boolean }[]; dossiers: number; prets: number; dansOdj: number; tauxRealisation: number;
  aTerminer: number; enRetard: number; directionsEnRetard: number; directionsATerminer: number; etape: { cle: string; label: string; retient: string[] } | null; terminee: boolean; indisponible?: boolean };

/** Carte d'une séance à venir (SEA-15) : bloc date, pastilles, titre, indicateurs, jalons, actions. `compacte` : une seule ligne. */
export function CarteSeance({ s, synth, isScc, compacte, onEdit, onDelete, onRelancer }: { s: any; synth?: Synth; isScc: boolean; compacte: boolean; onEdit: () => void; onDelete: () => void; onRelancer: () => void }) {
  const j = jours(s.dateSeance); const conseil = s.kind !== 'commission'; const annulee = s.statut === 'annulee'; const ok = synth && !synth.indisponible;
  const titre = `${s.instance} — ${dt(s.dateSeance, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} à ${dt(s.dateSeance, { hour: '2-digit', minute: '2-digit' })}`;
  const jal = ok ? synth!.jalons.filter((x) => x.code !== 'seance') : [];
  const nbServices = ok ? (synth!.directionsEnRetard || synth!.directionsATerminer) : 0;
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Link to={`/seances/${s.id}`} className="btn-primary !py-2"><ClipboardList className="h-4 w-4" /> Gérer l’ordre du jour</Link>
      {conseil && <Link to={`/seances/${s.id}#cahier`} className="btn-secondary !py-2"><BookOpen className="h-4 w-4" /> Cahier</Link>}
      {conseil && <Link to={`/seances/${s.id}/convocation`} className="btn-secondary !py-2"><Mail className="h-4 w-4" /> Convocation</Link>}
      {conseil && ['tenue', 'convoquee'].includes(s.statut) && <Link to={`/seances/${s.id}/suivi`} className="btn-secondary !py-2"><Radio className="h-4 w-4" /> Suivi de séance</Link>}
      {isScc && ok && synth!.aTerminer > 0 && <button className="btn-secondary !py-2" onClick={onRelancer}><BellRing className="h-4 w-4" /> Relancer les services ({nbServices})</button>}
      {isScc && <Menu onEdit={onEdit} onDelete={onDelete} />}
    </div>
  );
  if (compacte) {
    return (
      <article className={`card flex flex-wrap items-center gap-3 p-3 ${annulee ? 'opacity-60' : ''}`}>
        <BlocDate date={s.dateSeance} sombre={j !== null && j >= 0 && j <= 14} />
        <div className="min-w-0 flex-1"><div className="truncate font-bold text-head">{titre}</div><div className="text-[12px] text-mute">{s.lieu || 'Lieu à définir'}{j !== null && j >= 0 ? ` · dans ${j} jour(s)` : ''}{ok ? ` · ${synth!.dansOdj}/${synth!.dossiers} inscrites · ${synth!.tauxRealisation} % instruits` : ''}</div></div>
        {actions}
      </article>);
  }
  return (
    <article className={`card p-5 md:p-6 ${annulee ? 'opacity-60' : ''}`} aria-label={`Séance du ${dt(s.dateSeance, { dateStyle: 'long' })}`}>
      <div className="flex flex-wrap items-start gap-4">
        <BlocDate date={s.dateSeance} sombre={j !== null && j >= 0 && j <= 14} />
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{s.kind === 'commission' ? 'Commission' : s.instance}</span>
            {annulee ? <Badge tone="ko">Annulée</Badge> : conseil ? <Badge tone={ODJ[s.odjStatut]?.tone ?? 'gray'}>{ODJ[s.odjStatut]?.label ?? s.odjStatut}</Badge> : <Badge tone="blue">Projets présentés</Badge>}
            {s.type && s.type !== 'ordinaire' && <Badge tone="warn">{s.type}</Badge>}
            {j !== null && j >= 0 && j <= 9 && !annulee && <Badge tone="ko">Séance dans {j === 0 ? 'moins d’un jour' : `${j} jour(s)`}</Badge>}
          </div>
          <h2 className="mt-2 text-[22px] leading-snug">{titre}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute"><span>{s.lieu || 'Lieu à définir'}</span>{j !== null && j >= 0 && <span className="text-action">Dans {j} jour(s)</span>}{s.teams && <TeamsLink teams={s.teams} />}
            {conseil && s.dateLimiteRedaction && <span>Date limite de rédaction : <b className="text-ink">{dt(s.dateLimiteRedaction, { dateStyle: 'medium' })}</b></span>}</div>
        </div>
        {actions}
      </div>
      {isScc && conseil && ok && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Tuile titre="Compte à rebours" gros={`J-${Math.max(0, synth!.jours)}`}
              droite={synth!.cloture && !synth!.cloture.passe ? <Badge tone={synth!.cloture.jours <= 3 ? 'ko' : synth!.cloture.jours <= 7 ? 'warn' : 'gray'}>Clôture dépôts : J-{synth!.cloture.jours}</Badge> : synth!.cloture ? <Badge tone="gray">Dépôts clos</Badge> : undefined}
              note={synth!.cloture ? dt(synth!.cloture.date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Pas de date limite'} />
            <Tuile titre="Délibérations inscrites" gros={<>{synth!.dansOdj} <span className="text-mute">/ {synth!.dossiers}</span></>}
              droite={<Badge tone={synth!.tauxRealisation >= 100 ? 'ok' : synth!.tauxRealisation >= 50 ? 'warn' : 'ko'}>{synth!.tauxRealisation} % instruits</Badge>}
              note={synth!.enRetard ? <span className="font-semibold text-ko">{synth!.enRetard} en retard · {synth!.directionsEnRetard} direction(s)</span> : 'Aucun retard service'} />
            <Tuile titre="Étape" gros={<span className="text-[16px]">{synth!.terminee ? 'Terminée' : synth!.etape?.label ?? '—'}</span>}
              droite={<Link to={`/seances/${s.id}`} className="text-[12px] font-semibold text-action">{synth!.dossiers} délibération(s) →</Link>}>
              <ul className="mt-1 space-y-0.5 text-[12px] text-mute">{(synth!.etape?.retient ?? []).slice(0, 2).map((r, k) => <li key={k}>• {r}</li>)}</ul>
            </Tuile>
          </div>
          {jal.length > 0 && <p className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded bg-soft/70 px-3 py-2 text-[12px] text-mute">
            <span><b className="text-ink">Jalons</b> : {jal.map((x, k) => <span key={x.code}>{k > 0 && ' · '}{x.label} {dt(x.date, { dateStyle: 'short' })}</span>)}</span>
            <b className="text-ink">Séance : {dt(s.dateSeance, { dateStyle: 'short', timeStyle: 'short' })}</b></p>}
        </>)}
      {!conseil && <p className="mt-3 text-[12px] text-mute">Réunion de commission — <b>{s.actesEnAttente ?? 0}</b> projet(s) visé(s) · ordre du jour : projets présentés</p>}
    </article>
  );
}

/** Relancer les services (SEA-16) : par direction, les dossiers non terminés ; le SCC choisit, écrit un message et relance. */
export function RelanceServices({ seance, onClose, onDone }: { seance: any; onClose: () => void; onDone: () => void }) {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const [cible, setCible] = useState<'retard' | 'tous'>('retard'); const [retire, setRetire] = useState<Set<string>>(new Set()); const [message, setMessage] = useState(''); const [forcer, setForcer] = useState(false);
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<any>(null);
  const ap = useLoad(async () => (await api.get(orgPath(o, `/seances/${seance.id}/relance`), { params: { cible } })).data, [seance.id, cible]);
  const dirs: any[] = ap.data?.directions ?? []; const choisies = dirs.filter((d) => !retire.has(d.code));
  const nb = choisies.flatMap((d) => d.dossiers).filter((x: any) => forcer || !x.recemmentRelance).length;
  const go = async () => {
    setBusy(true);
    try { const r = (await api.post(orgPath(o, `/seances/${seance.id}/relance`), { cible, directions: choisies.map((d) => d.code), message: message || undefined, forcer })).data; setRes(r); toast(`${r.relances} dossier(s) relancé(s), ${r.personnesPrevenues} personne(s) prévenue(s)`); onDone(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Relancer les services — ${seance.instance} du ${dt(seance.dateSeance, { dateStyle: 'long' })}`} onClose={onClose} wide>
      {res ? (
        <div className="space-y-3">
          <p className="rounded bg-ok-bg px-3 py-2 text-[13px] text-ok-text"><b>{res.relances}</b> dossier(s) relancé(s), <b>{res.personnesPrevenues}</b> personne(s) prévenue(s){res.ignores ? `, ${res.ignores} ignoré(s)` : ''}.</p>
          <table className="w-full"><thead><tr><th>Dossier</th><th>Direction</th><th>Résultat</th></tr></thead><tbody>{res.items.map((x: any) => (
            <tr key={x.acteId}><td className="font-semibold">#{x.numeroSuivi} {x.titre}</td><td>{x.direction}</td><td className="text-[12px]">{x.relance ? <span className="text-ok">Relancé : {x.destinataires.map((u: string) => <AgentName key={u} u={u} />)}</span> : <span className="text-mute">Ignoré — {x.raison}</span>}</td></tr>))}</tbody></table>
          <div className="flex justify-end"><button className="btn-primary" onClick={onClose}>Fermer</button></div>
        </div>) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dossiers à relancer">
            {([['retard', 'Seulement les retards'], ['tous', 'Tous les dossiers non terminés']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setCible(k); setRetire(new Set()); }} aria-pressed={cible === k} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${cible === k ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-slate-700 hover:bg-soft'}`}>{l}</button>))}
            {ap.data && <span className="ml-auto text-[12px] text-mute">{ap.data.total} dossier(s) · {ap.data.enRetard} en retard{ap.data.dejaRelances ? ` · ${ap.data.dejaRelances} relancé(s) depuis moins de ${ap.data.delaiHeures} h` : ''}</span>}
          </div>
          {ap.loading && !ap.data ? <Loading /> : !ap.data ? <ErrorBox msg={ap.error} /> : !dirs.length ? <p className="rounded bg-ok-bg px-3 py-3 text-ok-text">{cible === 'retard' ? 'Aucun dossier en retard : rien à relancer.' : 'Tous les dossiers sont terminés.'}</p> : (
            <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">{dirs.map((dr) => (
              <section key={dr.code} className="rounded-lg border border-line">
                <label className="flex cursor-pointer items-center gap-2 border-b border-line bg-soft px-3 py-2"><input type="checkbox" checked={!retire.has(dr.code)} onChange={(e) => setRetire((r) => { const n = new Set(r); if (e.target.checked) n.delete(dr.code); else n.add(dr.code); return n; })} />
                  <b>{dr.direction || dr.code}</b><span className="text-[12px] text-mute">{dr.dossiers.length} dossier(s)</span>{dr.dossiers.some((x: any) => x.enRetard) && <Badge tone="ko">En retard</Badge>}</label>
                <ul className="divide-y divide-line">{dr.dossiers.map((x: any) => (
                  <li key={x.acteId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                    <span className="font-mono text-[11px] text-mute">#{x.numeroSuivi}</span><span className="min-w-0 flex-1 font-semibold">{x.titre}</span>
                    <span className="text-[12px] text-mute">{x.etape ?? (x.aRedacteur ? 'En rédaction' : '—')} · {x.destinataires.map((u: string) => <AgentName key={u} u={u} />)}</span>
                    {x.enRetard && <Badge tone="ko">{x.motifRetard ?? 'En retard'}</Badge>}
                    {x.derniereRelance && <span className={`text-[11px] ${x.recemmentRelance ? 'text-warn' : 'text-mute'}`}>relancé le {dt(x.derniereRelance, { dateStyle: 'short', timeStyle: 'short' })}</span>}
                  </li>))}</ul>
              </section>))}</div>)}
          <label className="block"><span className="label">Message (facultatif)</span><textarea className="input h-20" placeholder="Ex. « Merci de finaliser vos délibérations avant la clôture des dépôts. »" value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={forcer} onChange={(e) => setForcer(e.target.checked)} /> Relancer quand même les dossiers relancés récemment</label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !nb} onClick={go}>{busy ? <Spinner /> : <BellRing className="h-4 w-4" />} Relancer {nb} dossier(s)</button></div>
        </div>)}
      {node}
    </Modal>
  );
}

/** Lien de calendrier dynamique pour Outlook (SEA-17) : un abonnement, pas un export. */
export function LienCalendrier({ onClose }: { onClose: () => void }) {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/calendrier/lien'))).data, [o]);
  const [busy, setBusy] = useState(false);
  const agir = async (fn: () => Promise<any>, ok: string) => { setBusy(true); try { await fn(); toast(ok); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); } };
  const lien = d.data;
  return (
    <Modal title="Lien de calendrier pour Outlook" onClose={onClose}>
      {d.loading && !lien ? <Loading /> : !lien ? <ErrorBox msg={d.error} /> : (
        <div className="space-y-4">
          <p className="text-[13px] text-mute">Un <b>abonnement</b> (pas un export) : ajoutez ce lien <b>une seule fois</b> à Outlook, et vos agendas restent à jour tout seuls — séances déplacées, lieu modifié, séances annulées. Le lien est <b>personnel et secret</b> : ne le partagez pas.</p>
          {!lien.actif ? (
            <button className="btn-primary" disabled={busy} onClick={() => agir(() => api.post(orgPath(o, '/calendrier/lien'), {}), 'Lien créé')}>{busy ? <Spinner /> : <CalendarPlus className="h-4 w-4" />} Créer mon lien de calendrier</button>
          ) : (
            <>
              <div className="flex items-center gap-2"><input className="input font-mono text-[12px]" readOnly aria-label="Lien de calendrier" value={lien.url} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-secondary" onClick={async () => { await navigator.clipboard?.writeText(lien.url); toast('Lien copié'); }}><Copy className="h-4 w-4" /> Copier</button></div>
              <a className="btn-primary" href={lien.webcal}><CalendarPlus className="h-4 w-4" /> Ouvrir dans Outlook (webcal)</a>
              <ol className="list-decimal space-y-1 pl-5 text-[13px]">
                <li><b>Outlook (web ou nouvelle version)</b> : Calendrier › <i>Ajouter un calendrier</i> › <i>S’abonner à partir du web</i> › collez le lien.</li>
                <li><b>Outlook classique</b> : Fichier › Paramètres du compte › <i>Calendriers Internet</i> › Nouveau › collez le lien.</li>
                <li>Google Agenda, Apple Calendrier… : « Ajouter un calendrier par URL ». L’actualisation se fait environ toutes les heures.</li>
              </ol>
              <p className="text-[12px] text-mute">Créé le {dt(lien.creeLe, { dateStyle: 'medium' })}{lien.dernierAcces ? ` · dernière lecture par un agenda : ${dt(lien.dernierAcces, { dateStyle: 'short', timeStyle: 'short' })}` : ' · pas encore lu par un agenda'}. Contenu : séances et réunions (date, durée, lieu, lien Teams){' '}; pour l’administration et le SCC, aussi les jalons. Aucune donnée de dossier.</p>
              <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
                <button className="btn-secondary" disabled={busy} onClick={() => window.confirm('Générer un nouveau lien ? L’ancien cessera de fonctionner : il faudra le remplacer dans Outlook.') && agir(() => api.post(orgPath(o, '/calendrier/lien'), {}), 'Nouveau lien généré')}><RefreshCw className="h-4 w-4" /> Régénérer</button>
                <button className="btn-ko" disabled={busy} onClick={() => window.confirm('Révoquer le lien ? Les agendas abonnés cesseront de se mettre à jour.') && agir(() => api.delete(orgPath(o, '/calendrier/lien')), 'Lien révoqué')}><Trash2 className="h-4 w-4" /> Révoquer</button>
              </div>
            </>)}
        </div>)}
      {node}
    </Modal>
  );
}
