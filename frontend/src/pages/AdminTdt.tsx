import { useEffect, useState } from 'react';
import { CheckCircle2, Plug, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, Field, Loading, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const MODES: [string, string][] = [['simulation', 'Simulation (sans envoi réel)'], ['test', 'Test (instance de test du fournisseur)'], ['production', 'Production']];

/** Choix du tiers de télétransmission (TLT-30) : S²LOW par défaut, d'autres fournisseurs (FAST-Actes…) sont prévus. */
export default function AdminTdt() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/teletransmission/config'))).data, [o]);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null); const [test, setTest] = useState<any>(null);
  useEffect(() => {
    if (cfg.data) setF({ fournisseur: cfg.data.fournisseur, mode: cfg.data.mode, url: cfg.data.connexionFournisseur?.url || '', utilisateur: cfg.data.connexionFournisseur?.utilisateur || '', motDePasse: '' });
  }, [cfg.data]);
  if (cfg.loading && !cfg.data) return <Loading />;
  if (!cfg.data || !f) return <ErrorBox msg={cfg.error} />;
  const fournisseurs: any[] = cfg.data.fournisseurs; const cur = fournisseurs.find((x) => x.code === f.fournisseur) || fournisseurs[0];
  const choisir = (x: any) => { if (!x.disponible) return; setTest(null); setF({ ...f, fournisseur: x.code, mode: x.modes[f.mode] ? f.mode : 'simulation' }); };
  const enregistrer = async () => {
    setBusy('save');
    try { await api.put(orgPath(o, '/teletransmission/config'), { fournisseur: f.fournisseur, mode: f.mode, url: f.url, utilisateur: f.utilisateur, ...(f.motDePasse ? { motDePasse: f.motDePasse } : {}) }); toast('Paramétrage enregistré'); setF({ ...f, motDePasse: '' }); cfg.reload(); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const tester = async () => {
    setBusy('test'); setTest(null);
    try { await enregistrerSiBesoin(); setTest((await api.post(orgPath(o, '/teletransmission/test'))).data); } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  // le test porte sur ce qui est enregistré : on enregistre d'abord ce qui a été saisi
  const enregistrerSiBesoin = () => api.put(orgPath(o, '/teletransmission/config'), { fournisseur: f.fournisseur, mode: f.mode, url: f.url, utilisateur: f.utilisateur, ...(f.motDePasse ? { motDePasse: f.motDePasse } : {}) }).then(() => { setF({ ...f, motDePasse: '' }); cfg.reload(); });
  const conn = cfg.data.connexionFournisseur;

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
          {test && <span className={`mr-auto flex items-center gap-1 text-[13px] ${test.ok ? 'text-ok-text' : 'text-ko'}`} role="status">{test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.message}</span>}
          <button className="btn-secondary" onClick={tester} disabled={!!busy}>{busy === 'test' ? <Spinner /> : <Plug className="h-4 w-4" />} Tester la connexion</button>
          <button className="btn-primary" onClick={enregistrer} disabled={!!busy}>{busy === 'save' && <Spinner />} Enregistrer</button>
        </div>
      </section>
      {node}
    </div>
  );
}
