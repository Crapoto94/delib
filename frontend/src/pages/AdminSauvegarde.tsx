import { useEffect, useState } from 'react';
import { CheckCircle2, DatabaseBackup, Plug, XCircle } from 'lucide-react';
import { api, errMsg } from '../api';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, MailSwitch, Spinner, useLoad, useToast } from '../ui';

const octets = (n: number | null) => (n === null || n === undefined ? '—' : n > 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`);
const duree = (s: number | null) => (s === null ? '…' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** Sauvegarde de la base et des fichiers vers un dossier réseau (SAV-01 à SAV-07) — administrateur de la plateforme. */
export default function AdminSauvegarde() {
  const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get('/plateforme/sauvegarde')).data, []);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null); const [test, setTest] = useState<any>(null);
  useEffect(() => { if (d.data && !f) setF({ ...d.data.config, motDePasse: '' }); }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const enCours = !!d.data?.enCours;
  useEffect(() => { if (!enCours) return; const t = setInterval(() => d.reload(), 3000); return () => clearInterval(t); }, [enCours]); // eslint-disable-line react-hooks/exhaustive-deps

  if (d.loading && !d.data) return <Loading />;
  if (!d.data || !f) return <ErrorBox msg={d.error} />;
  const corps = () => ({ actif: f.actif, cible: f.cible, utilisateur: f.utilisateur, heure: f.heure, retentionJours: Number(f.retentionJours), inclureFichiers: f.inclureFichiers, ...(f.motDePasse ? { motDePasse: f.motDePasse } : {}) });
  const enregistrer = async () => { await api.put('/plateforme/sauvegarde/config', corps()); setF({ ...f, motDePasse: '' }); d.reload(); };
  const run = async (cle: string, fn: () => Promise<void>) => { setBusy(cle); try { await fn(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); } };
  const tester = () => run('test', async () => { await enregistrer(); setTest((await api.post('/plateforme/sauvegarde/test')).data); });
  const lancer = () => run('lancer', async () => { await enregistrer(); await api.post('/plateforme/sauvegarde/lancer'); toast('Sauvegarde lancée en arrière-plan'); d.reload(); });
  const unc = /^\\\\/.test(f.cible);

  return (
    <div className="space-y-6">
      <p className="max-w-4xl text-mute">Sauvegarde de <b>toute la base</b> (tous les organismes) et des <b>fichiers locaux</b> vers un dossier réseau, chaque nuit. Le contenu est sensible (données personnelles, secrets chiffrés) : la destination doit être <b>réservée à la DSI</b>. Les fichiers stockés dans Alfresco sont sauvegardés par la GED.</p>

      <section className="card space-y-4 p-5"><h3>Destination et planification</h3>
        <label className="flex items-center gap-3"><MailSwitch on={f.actif} onChange={(b) => setF({ ...f, actif: b })} label="Sauvegarde automatique chaque nuit" /> <span>Sauvegarde automatique chaque nuit</span></label>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Destination" hint="Chemin réseau (UNC), lecteur monté ou dossier local."><input className="input font-mono text-[13px]" value={f.cible} onChange={(e) => setF({ ...f, cible: e.target.value })} placeholder={String.raw`\\SRVIVRY2\shares3\DSI`} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Heure"><input className="input" type="time" value={f.heure} onChange={(e) => setF({ ...f, heure: e.target.value })} /></Field>
            <Field label="Conservation (jours)"><input className="input" type="number" min={1} max={3650} value={f.retentionJours} onChange={(e) => setF({ ...f, retentionJours: e.target.value })} /></Field>
          </div>
          {unc && <Field label="Identifiant" hint="DOMAINE\compte. Vide : le compte du service applicatif doit déjà avoir accès au partage."><input className="input" autoComplete="off" value={f.utilisateur} onChange={(e) => setF({ ...f, utilisateur: e.target.value })} placeholder={String.raw`IVRY\svc-sauvegarde`} /></Field>}
          {unc && <Field label="Mot de passe" hint={d.data.config.motDePasseDefini ? 'Enregistré (chiffré) : laissez vide pour le conserver.' : 'Chiffré au repos, jamais affiché ni écrit sur une ligne de commande.'}><input className="input" type="password" autoComplete="new-password" value={f.motDePasse} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} /></Field>}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.inclureFichiers} onChange={(e) => setF({ ...f, inclureFichiers: e.target.checked })} /> Copier aussi les fichiers du volume local (annexes, pièces, logo — copie incrémentale)</label>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {test && <span className={`mr-auto flex items-center gap-1 text-[13px] ${test.ok ? 'text-ok-text' : 'text-ko'}`} role="status">{test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.message}</span>}
          <button className="btn-secondary" disabled={!!busy || !f.cible} onClick={tester}>{busy === 'test' ? <Spinner /> : <Plug className="h-4 w-4" />} Tester la destination</button>
          <button className="btn-secondary" disabled={!!busy || !f.cible || enCours} onClick={lancer}>{busy === 'lancer' || enCours ? <Spinner /> : <DatabaseBackup className="h-4 w-4" />} {enCours ? 'Sauvegarde en cours…' : 'Sauvegarder maintenant'}</button>
          <button className="btn-primary" disabled={!!busy} onClick={() => run('save', async () => { await enregistrer(); toast('Paramètres enregistrés'); })}>{busy === 'save' && <Spinner />} Enregistrer</button>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><h3>Dernières sauvegardes</h3><button className="btn-secondary !py-1" onClick={d.reload}>Actualiser</button></div>
        {!d.data.journal.length ? <p className="p-6 text-center text-mute">Aucune sauvegarde pour l’instant.</p> : (
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>Début</th><th>Dossier</th><th>Statut</th><th>Durée</th><th>Base</th><th>Fichiers</th><th>Purgées</th><th /></tr></thead><tbody>
            {d.data.journal.map((s: any) => (
              <tr key={s.id}><td className="whitespace-nowrap text-[12px]">{dt(s.debut, { dateStyle: 'short', timeStyle: 'short' })}<div className="text-[11px] text-mute">{s.declencheur === 'planifie' ? 'planifiée' : `par ${s.lancePar}`}</div></td>
                <td className="font-mono text-[11px]">{s.dossier}</td>
                <td>{s.statut === 'ok' ? <Badge tone="ok">Réussie</Badge> : s.statut === 'erreur' ? <Badge tone="ko">Échec</Badge> : <Badge tone="blue">En cours</Badge>}</td>
                <td className="text-[12px]">{duree(s.dureeSec)}</td><td className="text-[12px]">{s.lignes === null ? '—' : `${s.tables} tables, ${s.lignes.toLocaleString('fr-FR')} lignes (${octets(s.octetsBase)})`}</td>
                <td className="text-[12px]">{s.fichiers === null ? '—' : `${s.fichiers} (${octets(s.octetsFichiers)})`}</td><td className="text-[12px]">{s.purgees ?? '—'}</td>
                <td className="max-w-xs text-[12px] text-ko">{s.erreur}</td></tr>))}
          </tbody></table></div>)}
      </section>

      <section className="card space-y-2 p-5"><h3>Restaurer</h3>
        <p className="text-[13px] text-mute">À faire par la DSI, d’abord dans un schéma vide de test. La restauration recrée le schéma par les migrations, recharge les données, réaligne les compteurs et contrôle les nombres de lignes contre le manifeste.</p>
        <pre className="overflow-x-auto rounded bg-soft p-3 text-[12px]">{String.raw`node backend/scripts/restaurer-sauvegarde.js "\\SRVIVRY2\shares3\DSI\vibedelib_AAAA-MM-JJ_HHMM" --schema ivrydelib_restaure`}</pre>
        <p className="text-[12px] text-mute">Ensuite : pointer <code>DB_SCHEMA</code> sur le schéma restauré, recopier le dossier <code>fichiers</code> dans le stockage, redémarrer, ré-indexer la recherche (« Paramétrages › Recherche ») ; les utilisateurs se reconnectent (les sessions ne sont pas sauvegardées).</p>
      </section>
      {node}
    </div>
  );
}
