import { useEffect, useState } from 'react';
import { Mail, UserCheck, UserX } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, MailSwitch, Spinner, useLoad, useToast } from '../ui';

const ETAT: Record<string, { label: string; tone?: 'ok' | 'warn' | 'ko' | 'blue' }> = { aucun: { label: 'Pas d’accès' }, invite: { label: 'Invité', tone: 'warn' }, actif: { label: 'Accès actif', tone: 'ok' }, desactive: { label: 'Désactivé', tone: 'ko' } };

const OUBLI: Record<string, { label: string; tone?: 'ok' | 'warn' | 'ko' | 'blue' }> = {
  demande: { label: 'Demande' }, code_envoye: { label: 'Code envoyé', tone: 'blue' }, code_valide: { label: 'Connexion réussie', tone: 'ok' }, code_refuse: { label: 'Code refusé', tone: 'warn' },
  code_expire: { label: 'Code expiré', tone: 'warn' }, compte_inconnu: { label: 'Compte inconnu', tone: 'warn' }, sans_mobile: { label: 'Mobile manquant', tone: 'ko' },
  echec_envoi: { label: 'Échec d’envoi', tone: 'ko' }, limite: { label: 'Limite atteinte', tone: 'ko' },
};

/** Journal des oublis de mot de passe (ELU-84) : chaque demande de code SMS et son issue. Jamais de code. */
function JournalOublis({ o }: { o: number }) {
  const [ev, setEv] = useState('');
  const j = useLoad(async () => (await api.get(orgPath(o, '/espace-elus/oublis'), { params: { evenement: ev || undefined, limit: 100 } })).data, [o, ev]);
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3"><h3>Oublis de mot de passe</h3>
        <select className="input !w-auto" aria-label="Filtrer par événement" value={ev} onChange={(e) => setEv(e.target.value)}><option value="">Tous les événements</option>{Object.entries(OUBLI).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select>
        <button className="btn-secondary !py-1" onClick={j.reload}>Actualiser</button>
        {j.data && <span className="ml-auto flex flex-wrap gap-1 text-[12px]" title="Dernières 24 heures">{Object.entries(j.data.dernieres24h as Record<string, number>).map(([k, n]) => <Badge key={k} tone={OUBLI[k]?.tone}>{OUBLI[k]?.label ?? k} : {n}</Badge>)}</span>}</div>
      {j.loading && !j.data ? <Loading /> : j.error ? <div className="p-4"><ErrorBox msg={j.error} /></div> : !j.data?.items.length ? <p className="p-6 text-center text-mute">Aucun oubli de mot de passe enregistré.</p> : (
        <div className="max-h-96 overflow-auto"><table className="w-full"><thead><tr><th>Date</th><th>Événement</th><th>Élu</th><th>Adresse saisie</th><th>IP</th><th>Détail</th></tr></thead><tbody>
          {j.data.items.map((x: any) => (
            <tr key={x.id}><td className="whitespace-nowrap text-[12px]">{dt(x.le, { dateStyle: 'short', timeStyle: 'medium' })}</td><td><Badge tone={OUBLI[x.evenement]?.tone}>{OUBLI[x.evenement]?.label ?? x.evenement}</Badge></td>
              <td className="font-semibold">{x.elu ?? <span className="font-normal text-mute">—</span>}</td><td className="text-[12px]">{x.email}</td><td className="font-mono text-[11px]">{x.ip}</td><td className="text-[12px] text-mute">{x.detail}</td></tr>))}
        </tbody></table></div>)}
      <p className="border-t border-line px-4 py-2 text-[12px] text-mute">Aucun code n’est conservé dans ce journal. Au plus 5 demandes par quart d’heure et par adresse ou par IP.</p>
    </section>
  );
}

/** Passerelle SMS (ELU-85) : simulation (rien n'est envoyé) ou passerelle HTTP ; le jeton est chiffré et jamais renvoyé. */
function SmsPasserelle({ o }: { o: number }) {
  const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/espace-elus/sms'))).data, [o]);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (d.data) setF({ mode: d.data.config.mode, url: d.data.config.url, expediteur: d.data.config.expediteur, modele: d.data.config.modele, jeton: '' }); }, [d.data]);
  if (!d.data || !f) return <Loading />;
  const enregistrer = async () => {
    setBusy(true);
    try { await api.put(orgPath(o, '/espace-elus/sms'), { mode: f.mode, url: f.url, expediteur: f.expediteur, modele: f.modele, ...(f.jeton ? { jeton: f.jeton } : {}) }); toast('Passerelle SMS enregistrée'); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const sim = f.mode !== 'http';
  return (
    <section className="card space-y-3 p-5"><h3>Passerelle SMS (mot de passe oublié)</h3>
      <p className="max-w-3xl text-mute">Quand un élu clique sur « Mot de passe oublié », un <b>code à 6 chiffres</b> part par SMS sur son mobile (valable 5 minutes ; connexion de 12 h). Renseignez le mobile de chaque élu dans <b>Élus</b>.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Mode"><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="simulation">Simulation (aucun SMS n’est envoyé)</option><option value="http">Passerelle HTTP</option></select></Field>
        {!sim && <Field label="Adresse de la passerelle" hint="Passerelle SMS de la Ville : http(s)://…/api/v1/messages"><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></Field>}
        {!sim && <Field label="Clé d’API / jeton" hint={d.data.config.jetonDefini ? 'Enregistré (chiffré) : laissez vide pour le conserver.' : 'Envoyé en « Authorization: Bearer », chiffré au repos.'}><input className="input" type="password" autoComplete="new-password" value={f.jeton} onChange={(e) => setF({ ...f, jeton: e.target.value })} /></Field>}
        {!sim && <Field label="Corps de la requête (JSON)" hint="Variables : {to} {message} {expediteur}. Vide : {&quot;recipient&quot;:&quot;{to}&quot;,&quot;message&quot;:&quot;{message}&quot;}"><input className="input font-mono text-[12px]" value={f.modele} onChange={(e) => setF({ ...f, modele: e.target.value })} /></Field>}
      </div>
      {sim && <p className="rounded bg-warn-bg px-3 py-2 text-[13px] text-warn">Mode simulation : les codes ne sont <b>pas envoyés</b> ; ils sont lisibles ci-dessous pour les essais. À ne pas utiliser en production.</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={busy} onClick={enregistrer}>{busy && <Spinner />} Enregistrer</button></div>
      {d.data.journal.length > 0 && (
        <div><h3 className="mb-1 text-[13px]">Derniers messages</h3><table className="w-full"><thead><tr><th>Date</th><th>Mobile</th><th>Mode</th><th>Statut</th><th>Message</th></tr></thead><tbody>
          {d.data.journal.slice(0, 8).map((m: any) => <tr key={m.id}><td className="whitespace-nowrap text-[12px]">{dt(m.le, { dateStyle: 'short', timeStyle: 'medium' })}</td><td className="text-[12px]">{m.mobile}</td><td>{m.mode}</td><td><Badge tone={m.statut === 'echec' ? 'ko' : 'ok'}>{m.statut}{m.erreur ? ` (${m.erreur})` : ''}</Badge></td><td className="text-[12px] text-mute">{m.message}</td></tr>)}
        </tbody></table></div>)}
      {node}
    </section>
  );
}

/** Paramétrage de l'espace élus (ELU-61 à ELU-69) : accès des élus, mise à disposition, preuve de consultation. */
export default function AdminElus() {
  const { org, isAdmin } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const comptes = useLoad(async () => (await api.get(orgPath(o, '/espace-elus/comptes'))).data.items as any[], [o]);
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/settings'))).data.settings as Record<string, { value: any }>, [o]);
  const seances = useLoad(async () => ((await api.get(orgPath(o, '/seances'), { params: { limit: 50 } })).data.items as any[]).filter((s) => s.kind !== 'commission'), [o]);
  const [sid, setSid] = useState<number | null>(null); const [q, setQ] = useState('');
  const cons = useLoad(async () => (sid ? (await api.get(orgPath(o, `/espace-elus/seances/${sid}/consultations`))).data.items as any[] : null), [sid, o]);
  const setSetting = async (key: string, value: unknown, ok: string) => { try { await api.put(orgPath(o, `/settings/${key}`), { value, scope: 'organisme' }); toast(ok); cfg.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); comptes.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (comptes.loading || !comptes.data) return <Loading />;
  const v = (k: string, d: any) => cfg.data?.[k]?.value ?? d;
  const liste = comptes.data.filter((c) => !q || `${c.nom} ${c.email ?? ''} ${c.groupe ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const compte = (e: string) => comptes.data!.filter((c) => c.compte === e).length;
  return (
    <div className="space-y-6">
      <p className="max-w-4xl text-mute">Les élus consultent les documents des séances dans un <b>espace dédié</b> (web et application mobile) : <b>uniquement des PDF finalisés</b>, jamais les notes de séance ni l’application de saisie. Chaque élu reçoit une <b>invitation personnelle par e-mail</b> et choisit son mot de passe ; à chaque connexion, un <b>code à usage unique</b> lui est envoyé par e-mail. Le secrétariat ne voit jamais les mots de passe.</p>
      <div className="flex flex-wrap gap-2"><Badge tone="ok">{compte('actif')} accès actifs</Badge><Badge tone="warn">{compte('invite')} invités</Badge><Badge>{compte('aucun')} sans accès</Badge>{compte('desactive') > 0 && <Badge tone="ko">{compte('desactive')} désactivés</Badge>}</div>

      {isAdmin && (
        <section className="card space-y-4 p-5"><h3>Mise à disposition et affichage</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Les élus voient une séance dès…" hint="Tous les membres de l’instance y accèdent au même instant.">
              <select className="input" value={v('elus.mad_declencheur', 'convocation')} onChange={(e) => setSetting('elus.mad_declencheur', e.target.value, 'Paramètre enregistré')}><option value="convocation">l’envoi de la convocation</option><option value="arret">l’arrêt de l’ordre du jour</option></select></Field>
            <Field label="Adresse de l’espace des élus" hint="Utilisée dans les invitations (ex. https://elus.ivry.local/elus.html)."><input className="input" defaultValue={v('elus.url_base', '')} placeholder="http://localhost:5160/elus.html" onBlur={(e) => e.target.value !== v('elus.url_base', '') && setSetting('elus.url_base', e.target.value.trim(), 'Adresse enregistrée')} /></Field>
          </div>
          <label className="flex items-center gap-3"><MailSwitch on={v('elus.suivi_direct', true) !== false} onChange={(b) => setSetting('elus.suivi_direct', b, 'Paramètre enregistré')} label="Suivi de la séance en direct" /><span>Permettre aux élus de <b>suivre la séance en direct</b> (point en cours)</span></label>
          <label className="flex items-center gap-3"><MailSwitch on={v('elus.affiche_resultats', true) !== false} onChange={(b) => setSetting('elus.affiche_resultats', b, 'Paramètre enregistré')} label="Résultats des votes" /><span>Afficher « adoptée / rejetée » aux élus une fois le vote clos (aucun décompte n’est jamais affiché)</span></label>
        </section>)}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3"><h3>Accès des élus</h3><input className="input !w-64" placeholder="Rechercher un élu…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un élu" /></div>
        <table className="w-full"><thead><tr><th>Élu</th><th>Groupe</th><th>E-mail</th><th>Accès</th><th>Dernière connexion</th><th /></tr></thead><tbody>{liste.map((c) => (
          <tr key={c.eluId}><td className="font-semibold">{c.nom}</td><td className="text-[12px]">{c.groupe ?? '—'}</td><td className="text-[12px]">{c.email ?? <span className="text-ko">aucune adresse</span>}</td>
            <td><Badge tone={ETAT[c.compte].tone}>{ETAT[c.compte].label}</Badge>{c.verrouille && <Badge tone="ko"> verrouillé</Badge>}</td><td className="text-[12px] text-mute">{c.derniereConnexion ? dt(c.derniereConnexion) : '—'}</td>
            <td className="whitespace-nowrap text-right">
              {c.compte !== 'desactive' && <button className="btn-secondary !py-1" disabled={!c.aUnEmail} title={c.aUnEmail ? '' : 'Renseignez d’abord son adresse e-mail'} onClick={() => act(() => api.post(orgPath(o, `/espace-elus/comptes/${c.eluId}/invitation`)), 'Invitation envoyée par e-mail')}><Mail className="h-3.5 w-3.5" /> {c.compte === 'aucun' ? 'Inviter' : 'Renvoyer l’invitation'}</button>}
              {c.compte === 'actif' || c.compte === 'invite' ? <button className="ml-1 rounded p-1.5 text-ko hover:bg-ko-bg" title="Désactiver l’accès" aria-label="Désactiver l’accès" onClick={() => act(() => api.put(orgPath(o, `/espace-elus/comptes/${c.eluId}/actif`), { actif: false }), 'Accès désactivé')}><UserX className="h-4 w-4" /></button>
                : c.compte === 'desactive' ? <button className="btn-secondary !py-1" onClick={() => act(() => api.put(orgPath(o, `/espace-elus/comptes/${c.eluId}/actif`), { actif: true }), 'Accès réactivé')}><UserCheck className="h-3.5 w-3.5" /> Réactiver</button> : null}
            </td></tr>))}</tbody></table>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3"><h3>Preuve de consultation</h3>
          <select className="input !w-auto" value={sid ?? ''} onChange={(e) => setSid(e.target.value ? Number(e.target.value) : null)} aria-label="Séance"><option value="">Choisir une séance…</option>{seances.data?.map((s) => <option key={s.id} value={s.id}>{s.instance} — {dt(s.dateSeance, { dateStyle: 'long' })}</option>)}</select>
          <span className="text-[12px] text-mute">Qui a consulté quoi et quand (métadonnées seulement : les notes des élus ne sont jamais accessibles).</span></div>
        {cons.data && <table className="w-full"><thead><tr><th>Élu</th><th>Documents lus</th><th>Ouvertures</th><th>Première lecture</th><th>Dernière lecture</th></tr></thead><tbody>{cons.data.map((c) => (
          <tr key={c.eluId}><td className="font-semibold">{c.nom}</td><td>{c.documentsLus}</td><td>{c.ouvertures}{c.horsLigne && <span className="ml-1 text-[11px] text-mute">(dont hors ligne)</span>}</td><td className="text-[12px]">{c.premiereLecture ? dt(c.premiereLecture) : <span className="text-mute">jamais</span>}</td><td className="text-[12px]">{c.derniereLecture ? dt(c.derniereLecture) : '—'}</td></tr>))}</tbody></table>}
      </section>

      {isAdmin && <SmsPasserelle o={o} />}
      <JournalOublis o={o} />{node}
    </div>
  );
}
