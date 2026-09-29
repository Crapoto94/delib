import { useEffect, useState } from 'react';
import { CheckCircle2, FileUp, Plug, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, Field, Loading, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const MODES: [string, string][] = [['simulation', 'Simulation (sans envoi réel)'], ['test', 'Test (instance de test du fournisseur)'], ['production', 'Production']];
const poids = (n?: number | null) => (n == null ? '' : n < 1024 ? `${n} o` : `${Math.round(n / 1024)} Ko`);

/** Choix du tiers de télétransmission (TLT-30) : S²LOW par défaut, d'autres fournisseurs (FAST-Actes…) sont prévus. */
export default function AdminTdt() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/teletransmission/config'))).data, [o]);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null); const [test, setTest] = useState<any>(null);
  const [cert, setCert] = useState<any>(null); const [fichierCert, setFichierCert] = useState<File | null>(null); const [mdpCert, setMdpCert] = useState('');
  const [fichierActe, setFichierActe] = useState<File | null>(null); const [acte, setActe] = useState<any>(null); const [acteBusy, setActeBusy] = useState<string | null>(null);
  useEffect(() => {
    if (cfg.data) setF({ fournisseur: cfg.data.fournisseur, mode: cfg.data.mode, url: cfg.data.connexionFournisseur?.url || '', utilisateur: cfg.data.connexionFournisseur?.utilisateur || '', motDePasse: '' });
  }, [cfg.data]);
  const chargerCert = () => api.get(orgPath(o, '/teletransmission/certificat')).then((r) => setCert(r.data)).catch(() => setCert({ configure: false }));
  useEffect(() => { void chargerCert(); }, [o]); // eslint-disable-line react-hooks/exhaustive-deps
  if (cfg.loading && !cfg.data) return <Loading />;
  if (!cfg.data || !f) return <ErrorBox msg={cfg.error} />;
  const fournisseurs: any[] = cfg.data.fournisseurs; const cur = fournisseurs.find((x) => x.code === f.fournisseur) || fournisseurs[0];
  const choisir = (x: any) => { if (!x.disponible) return; setTest(null); setF({ ...f, fournisseur: x.code, mode: x.modes[f.mode] ? f.mode : 'simulation' }); };
  const corps = { fournisseur: f.fournisseur, mode: f.mode, url: f.url, utilisateur: f.utilisateur, ...(f.motDePasse ? { motDePasse: f.motDePasse } : {}) };
  const enregistrer = async () => {
    setBusy('save');
    try { await api.put(orgPath(o, '/teletransmission/config'), corps); toast('Paramétrage enregistré'); setF({ ...f, motDePasse: '' }); cfg.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const tester = async () => {
    setBusy('test'); setTest(null);
    try { await api.put(orgPath(o, '/teletransmission/config'), corps); setF({ ...f, motDePasse: '' }); cfg.reload(); setTest((await api.post(orgPath(o, '/teletransmission/test'))).data); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const importerCert = async () => {
    if (!fichierCert) return toast('Choisissez le fichier .p12', 'ko');
    setBusy('cert');
    try {
      const fd = new FormData(); fd.append('certificat', fichierCert); fd.append('motDePasse', mdpCert);
      setCert((await api.post(orgPath(o, '/teletransmission/certificat'), fd)).data); setFichierCert(null); setMdpCert(''); toast('Certificat importé');
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const supprimerCert = async () => {
    if (!window.confirm('Supprimer le certificat S²LOW de cette collectivité ?')) return;
    setBusy('cert'); try { setCert((await api.delete(orgPath(o, '/teletransmission/certificat'))).data); toast('Certificat supprimé'); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const envoyerActe = async () => {
    if (!fichierActe) return toast('Choisissez le PDF de l’acte à envoyer', 'ko');
    setBusy('acte'); setActe(null);
    try { const fd = new FormData(); fd.append('fichier', fichierActe); setActe((await api.post(orgPath(o, '/teletransmission/test-acte'), fd)).data); setFichierActe(null); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const statutActe = async () => {
    if (!acte) return; setActeBusy('statut');
    try { setActe({ ...acte, ...(await api.get(orgPath(o, `/teletransmission/test-acte/${acte.remoteId}/statut`))).data }); } catch (e) { toast(errMsg(e), 'ko'); } finally { setActeBusy(null); }
  };
  const ouvrirDocument = async (type: string) => {
    if (!acte) return; setActeBusy(type);
    try { const r = await api.get(orgPath(o, `/teletransmission/test-acte/${acte.remoteId}/${type}`), { responseType: 'blob' }); const u = URL.createObjectURL(r.data); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setActeBusy(null); }
  };
  const conn = cfg.data.connexionFournisseur;
  const reel = f.mode !== 'simulation';

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2>Tiers de télétransmission (TDT)</h2>
        <p className="mb-3 text-mute">Choisissez le fournisseur par lequel les délibérations sont transmises au contrôle de légalité. Les paramètres d’envoi (SIREN, motif du numéro, mode A/B…) restent dans <Link className="text-action underline" to="/controle-legalite">Contrôle de légalité</Link>.</p>
        <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Fournisseur">
          {fournisseurs.map((x) => (
            <button key={x.code} role="radio" aria-checked={f.fournisseur === x.code} disabled={!x.disponible} onClick={() => choisir(x)}
              className={`rounded border p-4 text-left ${f.fournisseur === x.code ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-line'} ${x.disponible ? 'hover:bg-soft' : 'cursor-not-allowed opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="text-[15px] font-bold">{x.nom}</span><span className="text-[12px] text-mute">{x.editeur}</span>
                {x.defaut && <Badge tone="blue">Par défaut</Badge>}{!x.disponible && <Badge>Bientôt</Badge>}{f.fournisseur === x.code && <Badge tone="ok">Choisi</Badge>}</div>
              <p className="mt-1 text-[13px] text-mute">{x.description}</p>
            </button>))}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3>Connexion à {cur.nom}</h3></div>
        <p className="text-[13px] text-mute">{cur.note}</p>
        <Field label="Mode" hint="Le mode « simulation » teste toute la chaîne sans rien envoyer à la préfecture.">
          <Select className="input !w-auto" value={f.mode} onChange={(e) => { setTest(null); setF({ ...f, mode: e.target.value }); }}>
            {MODES.map(([k, l]) => <option key={k} value={k} disabled={!cur.modes[k]}>{l}{cur.modes[k] ? '' : ' — pas encore disponible'}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Adresse du serveur"><input className="input" type="url" value={f.url} placeholder="https://…" onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
          <Field label="Identifiant technique"><input className="input" autoComplete="off" value={f.utilisateur} onChange={(e) => setF({ ...f, utilisateur: e.target.value })} /></Field>
          <Field label="Mot de passe" hint={conn?.motDePasseDefini ? 'Enregistré (chiffré) : laissez vide pour le conserver.' : 'Chiffré au repos, jamais affiché.'}>
            <input className="input" type="password" autoComplete="new-password" value={f.motDePasse} placeholder={conn?.motDePasseDefini ? '••••••••••' : ''} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {test && <span className={`mr-auto flex items-center gap-1 text-[13px] ${test.ok ? 'text-ok-text' : 'text-ko'}`} role="status">{test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.message}{test.identite?.collectivite && <span className="text-mute"> · autorité : {test.identite.collectivite}{test.identite.departement ? ` (dép. ${test.identite.departement})` : ''}</span>}</span>}
          <button className="btn-secondary" onClick={tester} disabled={!!busy}>{busy === 'test' ? <Spinner /> : <Plug className="h-4 w-4" />} Tester la connexion et le certificat</button>
          <button className="btn-primary" onClick={enregistrer} disabled={!!busy}>{busy === 'save' && <Spinner />} Enregistrer</button>
        </div>
      </section>

      {/* Certificat client : un par collectivité, indispensable aux modes test/production (authentification mutuelle). */}
      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-action" /><h3>Certificat client S²LOW (par collectivité)</h3>
          {cert?.configure ? <Badge tone="ok">Importé</Badge> : <Badge>Absent</Badge>}</div>
        <p className="text-[13px] text-mute">Le certificat identifie votre collectivité auprès de S²LOW (fichier <b>.p12</b> fourni par la plateforme de test ou de production). Il est stocké sur le serveur, jamais renvoyé par l’interface ; sa phrase de passe est chiffrée au repos.</p>
        {cert?.configure && (
          <p className="text-[13px]">Fichier : <b>{cert.nom}</b>{cert.taille ? ` · ${poids(cert.taille)}` : ''}{cert.deposeLe ? ` · importé le ${new Date(cert.deposeLe).toLocaleString('fr-FR')}` : ''}{cert.motDePasseDefini ? ' · phrase de passe enregistrée' : ' · sans phrase de passe'}</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Fichier .p12"><input className="input" type="file" accept=".p12,application/x-pkcs12" onChange={(e) => setFichierCert(e.target.files?.[0] || null)} /></Field>
          <Field label="Phrase de passe du certificat" hint="Laissez vide si le certificat n’en a pas."><input className="input" type="password" autoComplete="new-password" value={mdpCert} onChange={(e) => setMdpCert(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {cert?.configure && <button className="btn-ko" onClick={supprimerCert} disabled={!!busy}><Trash2 className="h-4 w-4" /> Supprimer</button>}
          <button className="btn-primary" onClick={importerCert} disabled={!!busy || !fichierCert}>{busy === 'cert' ? <Spinner /> : <FileUp className="h-4 w-4" />} Importer le certificat</button>
        </div>
      </section>

      {/* Envoi d'un ACTE DE TEST : un vrai PDF d'acte, marqué TEST. Refusé en production par le serveur. */}
      {reel && (
        <section className="card space-y-4 p-5">
          <h3>Envoyer un acte de test</h3>
          <p className="text-[13px] text-mute">Envoie un vrai PDF d’acte sur l’instance <b>{f.mode === 'test' ? 'de test' : 'de production'}</b> avec un numéro marqué <b>TEST…</b> (sans valeur juridique), pour valider toute la chaîne (dépôt, numéro S²LOW, statut). {f.mode === 'production' && <b>Refusé en production.</b>}</p>
          <Field label="PDF de l’acte"><input className="input" type="file" accept="application/pdf,.pdf" onChange={(e) => setFichierActe(e.target.files?.[0] || null)} /></Field>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button className="btn-secondary" onClick={envoyerActe} disabled={!!busy || !fichierActe || f.mode === 'production'}>{busy === 'acte' ? <Spinner /> : <FileUp className="h-4 w-4" />} Envoyer l’acte de test</button>
          </div>
          {acte && (
            <div className="space-y-2 rounded border border-line bg-soft p-3 text-[13px]">
              <p role="status">Acte de test envoyé : transaction S²LOW <b>{acte.remoteId}</b> · n° {acte.numero} · statut : <b>{acte.label || '—'}</b>{acte.status === 4 ? ' (acquitté)' : ''}</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary !py-1.5 text-[12px]" onClick={statutActe} disabled={!!acteBusy}>{acteBusy === 'statut' ? <Spinner /> : null} Rafraîchir le statut</button>
                <button className="btn-secondary !py-1.5 text-[12px]" onClick={() => ouvrirDocument('bordereau')} disabled={!!acteBusy}>Bordereau d’acquittement</button>
                <button className="btn-secondary !py-1.5 text-[12px]" onClick={() => ouvrirDocument('ar')} disabled={!!acteBusy}>ARActe (XML)</button>
                <button className="btn-secondary !py-1.5 text-[12px]" onClick={() => ouvrirDocument('tampon')} disabled={!!acteBusy}>Acte tamponné</button>
              </div>
              <p className="text-[12px] text-mute">Ces documents (« retour » de la préfecture) n’existent qu’après l’acquittement : rafraîchissez le statut, puis ouvrez-les.</p>
            </div>
          )}
        </section>
      )}
      {node}
    </div>
  );
}
