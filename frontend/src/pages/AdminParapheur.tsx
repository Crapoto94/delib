import { useEffect, useState } from 'react';
import { CheckCircle2, Plug, Send, XCircle } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const SENS: Record<string, string> = { sortant: 'Envoyé', entrant: 'Retourné' };

/** Configuration du parapheur (décisions et arrêtés) : DSIHUB par défaut, iParapheur prévu (non disponible). */
export default function AdminParapheur() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/parapheur/config'))).data, [o]);
  const journal = useLoad(async () => (await api.get(orgPath(o, '/parapheur/journal'), { params: { limit: 50 } })).data.items as any[], [o]);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null); const [test, setTest] = useState<any>(null);
  useEffect(() => {
    if (cfg.data) setF({ fournisseur: cfg.data.fournisseur, actif: cfg.data.actif, mode: cfg.data.mode, url: cfg.data.url || '', utilisateur: cfg.data.utilisateur || '', motDePasse: '', email_test: cfg.data.email_test || '', signataire_nom: cfg.data.signataire_nom || '', signataire_email: cfg.data.signataire_email || '', signataire_qualite: cfg.data.signataire_qualite || '', signature_mode: cfg.data.signature_mode || 'securise', signataire_telephone: cfg.data.signataire_telephone || '' });
  }, [cfg.data]);
  if (cfg.loading && !cfg.data) return <Loading />;
  if (!cfg.data || !f) return <ErrorBox msg={cfg.error} />;
  const fournisseurs: any[] = cfg.data.fournisseurs; const cur = fournisseurs.find((x) => x.code === f.fournisseur) || fournisseurs[0];
  const choisir = (x: any) => { if (!x.disponible) return; setTest(null); setF({ ...f, fournisseur: x.code }); };
  const corps = () => ({ fournisseur: f.fournisseur, actif: f.actif, mode: f.mode, url: f.url, utilisateur: f.utilisateur, ...(f.motDePasse ? { motDePasse: f.motDePasse } : {}), email_test: f.email_test, signataire_nom: f.signataire_nom, signataire_email: f.signataire_email, signataire_qualite: f.signataire_qualite, signature_mode: f.signature_mode, signataire_telephone: f.signataire_telephone || '' });
  const enregistrer = async (silencieux = false) => {
    setBusy('save');
    try { await api.put(orgPath(o, '/parapheur/config'), corps()); if (!silencieux) toast('Paramétrage enregistré'); setF({ ...f, motDePasse: '' }); cfg.reload(); return true; }
    catch (e) { toast(errMsg(e), 'ko'); return false; } finally { setBusy(null); }
  };
  const tester = async () => {
    setBusy('test'); setTest(null);
    try { const ok = await enregistrer(true); if (!ok) return; setTest((await api.post(orgPath(o, '/parapheur/test'), corps())).data); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  // Envoie un vrai document au parapheur (pièce de test « sans valeur ») : le chemin complet, sans engager d'acte.
  const envoyerTest = async () => {
    if (!window.confirm('Envoyer un document de test au parapheur ?\n\nUne pièce « sans valeur » sera remise au parapheur comme une vraie demande de signature, au destinataire configuré. Aucun dossier n’est engagé.')) return;
    setBusy('envoi'); setTest(null);
    try { const ok = await enregistrer(true); if (!ok) return; setTest((await api.post(orgPath(o, '/parapheur/test-envoi'), corps())).data); toast('Document de test envoyé au parapheur'); journal.reload(); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2>Parapheur (signature du maire)</h2>
        <p className="mb-3 text-mute">Les <b>décisions</b> et <b>arrêtés</b> ne sont pas inscrits au conseil : à la fin de leur circuit, ils partent au parapheur pour la signature du maire. Choisissez le parapheur ; les échanges (ce qui est envoyé et retourné) sont journalisés plus bas et sur la fiche de chaque dossier.</p>
        <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Parapheur">
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
        <h3>Envoi en signature</h3>
        <label className="flex items-center gap-3"><input type="checkbox" checked={!!f.actif} onChange={(e) => { setTest(null); setF({ ...f, actif: e.target.checked }); }} /> <span>Parapheur <b>actif</b> — l'envoi en signature se déclenche automatiquement à la fin du circuit.</span></label>
        <Field label="Mode" hint="« dev » : tous les documents partent vers une adresse d'essai unique. « prod » : le document part au signataire paramétré.">
          <Select className="input !w-auto" value={f.mode} onChange={(e) => { setTest(null); setF({ ...f, mode: e.target.value }); }}>
            <option value="dev">dev — adresse d'essai unique</option><option value="prod">prod — signataire</option>
          </Select>
        </Field>
        {f.mode === 'dev'
          ? <Field label="Adresse d'essai (mode dev)" hint="Tous les envois de signature vont à cette adresse tant que le mode dev est actif."><input className="input" type="email" required value={f.email_test} placeholder="parapheur-dev@ville.fr" onChange={(e) => setF({ ...f, email_test: e.target.value })} /></Field>
          : (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nom du signataire *"><input className="input" value={f.signataire_nom} onChange={(e) => setF({ ...f, signataire_nom: e.target.value })} /></Field>
          <Field label="E-mail du signataire *"><input className="input" type="email" value={f.signataire_email} onChange={(e) => setF({ ...f, signataire_email: e.target.value })} /></Field>
          <Field label="Qualité"><input className="input" value={f.signataire_qualite} placeholder="Maire" onChange={(e) => setF({ ...f, signataire_qualite: e.target.value })} /></Field>
        </div>)}
        <Field label="Mode de signature" hint="Par défaut : P12 (certificat personnel du signataire). « Simple » : signature manuscrite mémorisée. « SMS » : un code de validation est envoyé au portable du signataire.">
          <Select className="input !w-auto" value={f.signature_mode} onChange={(e) => { setTest(null); setF({ ...f, signature_mode: e.target.value }); }}>
            {(cfg.data.modes_signature || []).map((m: any) => <option key={m.code} value={m.code}>{m.nom}</option>)}
          </Select>
        </Field>
        {(cfg.data.modes_signature || []).find((m: any) => m.code === f.signature_mode)?.description && (
          <p className="-mt-2 text-[12px] text-mute">{(cfg.data.modes_signature || []).find((m: any) => m.code === f.signature_mode)?.description}</p>)}
        {f.signature_mode === 'sms' && (
          <Field label="Portable du signataire *" hint="Requis pour la signature par SMS (ex. 06 12 34 56 78)."><input className="input" value={f.signataire_telephone} placeholder="06 12 34 56 78" onChange={(e) => setF({ ...f, signataire_telephone: e.target.value })} /></Field>)}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Adresse du Hub DSI"><input className="input" type="url" value={f.url} placeholder="https://dsihub.ville.local" onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
          <Field label="Compte technique"><input className="input" autoComplete="off" value={f.utilisateur} onChange={(e) => setF({ ...f, utilisateur: e.target.value })} /></Field>
          <Field label="Mot de passe" hint={cfg.data.secretDefini ? 'Enregistré (chiffré) : laissez vide pour le conserver.' : 'Chiffré au repos, jamais affiché.'}>
            <input className="input" type="password" autoComplete="new-password" value={f.motDePasse} placeholder={cfg.data.secretDefini ? '••••••••••' : ''} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} /></Field>
        </div>
        <p className="text-[12px] text-mute">Sans URL ni compte, VibeDélib utilise un <b>simulateur</b> : le dossier passe en signature et vous pouvez simuler le retour (signé / refusé) depuis la fiche. Renseignez le Hub pour des envois réels.</p>
        <div className="rounded border border-line bg-soft p-3 text-[12px] text-mute">
          <b className="text-slate-700">Vérifier de bout en bout.</b> « Tester la connexion » s’assure que VibeDélib <b>joint</b> le parapheur. « Envoyer un document de test » va plus loin : il <b>remet une vraie pièce</b> au parapheur — une page « sans valeur », au gabarit de la collectivité — au destinataire configuré (adresse d’essai en mode dev). Aucun acte ni circuit n’est engagé. L’échange apparaît dans le journal ci-dessous.
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {test && <span className={`mr-auto flex items-center gap-1 text-[13px] ${test.ok ? 'text-ok-text' : 'text-ko'}`} role="status">{test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.message}</span>}
          <button className="btn-secondary" onClick={tester} disabled={!!busy}>{busy === 'test' ? <Spinner /> : <Plug className="h-4 w-4" />} Tester la connexion</button>
          <button className="btn-secondary" onClick={envoyerTest} disabled={!!busy}>{busy === 'envoi' ? <Spinner /> : <Send className="h-4 w-4" />} Envoyer un document de test</button>
          <button className="btn-primary" onClick={() => enregistrer()} disabled={!!busy}>{busy === 'save' && <Spinner />} Enregistrer</button>
        </div>
      </section>

      <section className="card p-5">
        <h3 className="mb-2">Journal des échanges</h3>
        <p className="mb-3 text-[13px] text-mute">Ce qui est envoyé au parapheur et ce qu'il renvoie (demande, accusé, état, retour).</p>
        {journal.loading && !journal.data ? <Loading /> : !journal.data?.length ? <p className="text-mute">Aucun échange enregistré.</p> : (
          <table className="w-full"><thead><tr><th>Date</th><th>Sens</th><th>Résumé</th><th>Détail</th></tr></thead><tbody>
            {journal.data.map((x) => (
              <tr key={x.id}><td className="whitespace-nowrap text-mute">{dt(x.at)}</td>
                <td><Badge tone={x.sens === 'sortant' ? 'blue' : 'gray'}>{SENS[x.sens] || x.sens}</Badge></td>
                <td>{x.resume || '—'}{x.erreur && <span className="block text-ko">{x.erreur}</span>}</td>
                <td className="text-[11px] text-mute">{x.methode} {x.httpStatus ? `· HTTP ${x.httpStatus}` : ''}</td></tr>))}
          </tbody></table>)}
      </section>
      {node}
    </div>
  );
}
