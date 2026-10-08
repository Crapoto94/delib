import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

type Reglage = (cle: string, def: any) => any;
type Enregistrer = (cle: string, valeur: unknown, ok: string) => void;

/** Interrupteur « activé / désactivé » d'un réglage de publication. */
function Activation({ label, hint, cle, v, set, textes }: { label: string; hint: string; cle: string; v: Reglage; set: Enregistrer; textes: [string, string] }) {
  return (
    <Field label={label} hint={hint}>
      <Select className="input" value={v(cle, false) ? 'oui' : 'non'} onChange={(e) => set(cle, e.target.value === 'oui', e.target.value === 'oui' ? textes[0] : textes[1])}><option value="non">Désactivé</option><option value="oui">Activé</option></Select>
    </Field>
  );
}

function Periode({ label, hint, cle, v, set }: { label: string; hint: string; cle: string; v: Reglage; set: Enregistrer }) {
  return (
    <Field label={label} hint={hint}>
      <input className="input" type="number" min={1} max={1200} defaultValue={v(cle, 6)} onBlur={(e) => { const n = Math.min(1200, Math.max(1, Number(e.target.value) || 6)); if (n !== v(cle, 6)) set(cle, n, 'Période enregistrée'); }} />
    </Field>
  );
}

/** Arrêtés pris par le Maire repris du site de la Ville : état, lancement de la reprise, progression et erreurs. */
function ArretesSite({ o, toast }: { o: number; toast: (m: string, t?: 'ok' | 'ko') => void }) {
  const d = useLoad(async () => (await api.get(orgPath(o, '/arretes-site'))).data, [o]);
  const [busy, setBusy] = useState(false); const [url, setUrl] = useState('');
  const encours = d.data?.importation?.etat === 'en_cours';
  const rafraichir = useRef(d.reload); rafraichir.current = d.reload;
  useEffect(() => { if (!encours) return; const t = setInterval(() => rafraichir.current(), 2000); return () => clearInterval(t); }, [encours]);
  useEffect(() => { if (d.data && !url) setUrl(d.data.url); }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const lancer = async () => {
    setBusy(true);
    try { await api.post(orgPath(o, '/arretes-site/reprise'), url && url !== d.data?.url ? { url } : {}); toast('Reprise lancée'); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(false); }
  };
  const j = d.data?.importation;
  return (
    <section className="card space-y-3 p-5"><div className="flex flex-wrap items-center gap-2"><h3>Arrêtés du site de la Ville</h3>{d.data && <Badge tone="blue">{d.data.total} repris</Badge>}</div>
      <p className="text-[13px] text-mute">Reprend les arrêtés publiés sur le site (liens PDF) : chacun devient un <b>arrêté signé marqué « site »</b>, consultable dans la bibliothèque et publié sur la page publique. La <b>date</b> est lue dans l’accusé de réception de la préfecture, à défaut le mois du dossier. Les arrêtés « site » <b>survivent à un effacement général</b> des données et ne se suppriment pas depuis l’application. La reprise est rejouable : un arrêté déjà repris est ignoré.</p>
      {d.loading && !d.data ? <Loading /> : !d.data ? <ErrorBox msg={d.error} /> : (
        <>
          <Field label="Page du site listant les arrêtés (HTTPS)"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.ivry94.fr/2214/arretes-pris-par-le-maire.htm" /></Field>
          <div className="flex flex-wrap items-center gap-3"><button className="btn-primary" disabled={busy || encours || !url.trim()} onClick={lancer}>{(busy || encours) && <Spinner />} {d.data.total ? 'Mettre à jour depuis le site' : 'Importer les arrêtés du site'}</button>
            {d.data.parAnnee.length > 0 && <span className="text-[12px] text-mute">{d.data.parAnnee.map((x: any) => `${x.annee} : ${x.nb}`).join(' · ')}</span>}</div>
          {j && (
            <div className="rounded border border-line p-3 text-[13px]" role="status">
              <div className="flex flex-wrap items-center gap-2"><b>Dernière reprise</b>
                {j.etat === 'en_cours' ? <Badge tone="blue">En cours</Badge> : j.etat === 'termine' ? <Badge tone={j.erreurs.length ? 'warn' : 'ok'}>Terminée</Badge> : <Badge tone="ko">Échec</Badge>}
                <span className="text-mute">lancée le {dt(j.debut)} par {j.par}{j.fin ? ` · terminée le ${dt(j.fin)}` : ''}</span></div>
              <p className="mt-1">{j.faits} / {j.total} traités · <b>{j.nouveaux}</b> nouveaux · {j.ignores} déjà repris · {j.erreurs.length} erreur{j.erreurs.length > 1 ? 's' : ''}</p>
              {j.total > 0 && <div className="mt-1 h-2 overflow-hidden rounded bg-soft"><div className="h-full bg-action" style={{ width: `${Math.round((j.faits / j.total) * 100)}%` }} /></div>}
              {j.message && <p className="mt-2 text-ko">{j.message}</p>}
              {j.erreurs.length > 0 && (
                <details className="mt-2"><summary className="cursor-pointer text-ko">Voir les erreurs</summary>
                  <ul className="mt-1 max-h-48 space-y-1 overflow-auto text-[12px]">{j.erreurs.map((e: any) => <li key={e.url}><code className="break-all">{e.url}</code> — {e.message}</li>)}</ul></details>)}
            </div>)}
        </>)}
    </section>
  );
}

/** Mise à disposition et affichage : ce qui est publié sans connexion (délibérations, arrêtés), et la reprise des arrêtés du site. Les réglages propres aux élus restent dans « Espace élus ». */
export default function AdminMiseADisposition() {
  const { org, isAdmin } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/settings'))).data.settings as Record<string, { value: any }>, [o]);
  const setSetting: Enregistrer = async (key, value, ok) => { try { await api.put(orgPath(o, `/settings/${key}`), { value, scope: 'organisme' }); toast(ok); cfg.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (!isAdmin) return <ErrorBox msg="Réservé à l’administrateur de l’organisme." />;
  if (cfg.loading && !cfg.data) return <Loading />;
  if (!cfg.data) return <ErrorBox msg={cfg.error} />;
  const v: Reglage = (k, d) => cfg.data?.[k]?.value ?? d;
  return (
    <div className="space-y-6">
      <p className="max-w-4xl text-mute">Ce qui est <b>publié sans connexion</b> : les <b>délibérations</b> et les <b>arrêtés</b> (liste des derniers mois et moteur de recherche), à incruster dans le site de la collectivité (iframe) ou à intégrer avec un script. Seules les délibérations <b>exécutoires</b> et les arrêtés <b>signés non confidentiels</b> sont publiés, avec leurs annexes publiables ; jamais l’exposé des motifs.</p>

      <section className="card space-y-4 p-5"><h3>Délibérations</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Activation label="Page publique des délibérations" cle="publication.deliberations_actif" v={v} set={setSetting} textes={['Page publique activée', 'Page publique désactivée']}
            hint="Sans connexion, à incruster en iframe : <adresse de l’espace des élus>/deliberations. Délibérations exécutoires, extrait du registre et annexes publiables, jamais l’exposé des motifs." />
          <Activation label="Moteur de recherche des délibérations (public)" cle="publication.recherche_actif" v={v} set={setSetting} textes={['Moteur de recherche activé', 'Moteur de recherche désactivé']}
            hint="<adresse de l’espace des élus>/deliberations-recherche. Sans limite de durée : séance, rapporteur, thématique, dates, texte du titre et/ou du corps." />
          <Periode label="Période affichée sur la page publique" cle="publication.deliberations_mois" v={v} set={setSetting} hint="Délibérations des N derniers mois (aucune limite à 24 mois)." />
        </div>
      </section>

      <section className="card space-y-4 p-5"><h3>Arrêtés</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Activation label="Page publique des arrêtés" cle="publication.arretes_actif" v={v} set={setSetting} textes={['Page publique des arrêtés activée', 'Page publique des arrêtés désactivée']}
            hint="<adresse de l’espace des élus>/arretes. Arrêtés signés non confidentiels (signés dans l’application, déjà signés saisis, ou repris du site), avec leurs annexes publiables." />
          <Activation label="Moteur de recherche des arrêtés (public)" cle="publication.arretes_recherche_actif" v={v} set={setSetting} textes={['Moteur de recherche des arrêtés activé', 'Moteur de recherche des arrêtés désactivé']}
            hint="<adresse de l’espace des élus>/arretes-recherche. Sans limite de durée : texte de l’objet ou numéro, année, dates." />
          <Periode label="Période affichée sur la page publique des arrêtés" cle="publication.arretes_mois" v={v} set={setSetting} hint="Arrêtés des N derniers mois." />
        </div>
      </section>

      <ArretesSite o={o} toast={toast} />

      <section className="card space-y-2 p-5"><h3>Code d’intégration</h3>
        <p className="text-[13px] text-mute">Pages à intégrer, sur l’adresse publique de l’espace des élus (en DMZ) :</p>
        <ul className="list-disc space-y-1 pl-5 text-[13px]">
          <li><b>Liste des délibérations</b> : <code>/deliberations</code> (iframe) · <code>/deliberations-code</code> (code à copier)</li>
          <li><b>Moteur de recherche des délibérations</b> : <code>/deliberations-recherche</code> (iframe) · <code>/deliberations-recherche-code</code> (code à copier)</li>
          <li><b>Liste des arrêtés</b> : <code>/arretes</code> (iframe) · <code>/arretes-code</code> (code à copier)</li>
          <li><b>Moteur de recherche des arrêtés</b> : <code>/arretes-recherche</code> (iframe) · <code>/arretes-recherche-code</code> (code à copier)</li>
        </ul>
        <p className="text-[12px] text-mute">Les clés d’API pour les applications externes se gèrent dans <Link className="text-action underline" to="/admin/cles">Clés API</Link>.</p>
      </section>
      {node}
    </div>
  );
}
