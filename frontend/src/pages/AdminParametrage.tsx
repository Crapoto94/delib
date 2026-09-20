import { useEffect, useState } from 'react';
import { Download, Pencil, Plus, Upload } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';

const TYPES: [string, string][] = [['texte', 'Texte'], ['nombre', 'Nombre'], ['date', 'Date'], ['liste', 'Liste de valeurs'], ['booleen', 'Oui / non'], ['elu', 'Élu'], ['agent', 'Agent']];
const ROLES: [string, string][] = [['redacteur', 'Rédacteur'], ['scc', 'SCC'], ['org_admin', 'Administrateur']];

/** Définition ou modification d'un champ personnalisé (PAR-10). Le code et le type ne changent plus une fois le champ créé. */
function ChampForm({ champ, champs, types, onClose, onSaved }: { champ: any | null; champs: any[]; types: any[]; onClose: () => void; onSaved: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [f, setF] = useState<any>(champ ? {
    code: champ.code, libelle: champ.libelle, aide: champ.aide ?? '', kind: champ.kind, options: (champ.options || []).map((x: any) => `${x.valeur}=${x.libelle}`).join('\n'), obligatoire: champ.obligatoire, typeActeId: champ.typeActeId ?? '',
    condChamp: champ.visibleSi?.champ ?? '', condValeur: champ.visibleSi?.egal ?? '', roles: champ.rolesSaisie || [], etapes: (champ.etapesSaisie || []).join(', '), ordre: champ.ordre,
  } : { code: '', libelle: '', aide: '', kind: 'texte', options: '', obligatoire: false, typeActeId: '', condChamp: '', condValeur: '', roles: [], etapes: '', ordre: (champs.length + 1) * 10 });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const enregistrer = async () => {
    setBusy(true); setErr(null);
    const options = String(f.options).split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [v, ...r] = l.split('='); return { valeur: v.trim(), libelle: (r.join('=') || v).trim() }; });
    const corps: any = {
      libelle: f.libelle, aide: f.aide || null, obligatoire: !!f.obligatoire, options, ordre: Number(f.ordre) || 0,
      visibleSi: f.condChamp ? { champ: f.condChamp, egal: f.condValeur } : null, rolesSaisie: f.roles, etapesSaisie: String(f.etapes).split(',').map((x) => x.trim()).filter(Boolean),
    };
    try {
      if (champ) await api.put(orgPath(o, `/champs/${champ.id}`), corps);
      else await api.post(orgPath(o, '/champs'), { ...corps, code: f.code, kind: f.kind, typeActeId: f.typeActeId === '' ? null : Number(f.typeActeId) });
      onSaved();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={champ ? `Champ « ${champ.libelle} »` : 'Nouveau champ personnalisé'} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Libellé *"><input className="input" autoFocus value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Field>
          <Field label="Code *" hint="Définitif : minuscules, chiffres et _"><input className="input font-mono" disabled={!!champ} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Type"><select className="input" disabled={!!champ} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="S'applique à"><select className="input" disabled={!!champ} value={f.typeActeId} onChange={(e) => setF({ ...f, typeActeId: e.target.value })}><option value="">Tous les types d'actes</option>{types.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</select></Field>
        </div>
        {f.kind === 'liste' && <Field label="Valeurs" hint="Une par ligne : valeur=Libellé affiché"><textarea className="input h-24 font-mono text-[13px]" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} placeholder={'haute=Haute\nbasse=Basse'} /></Field>}
        <Field label="Aide affichée sous le champ"><input className="input" value={f.aide} onChange={(e) => setF({ ...f, aide: e.target.value })} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.obligatoire} onChange={(e) => setF({ ...f, obligatoire: e.target.checked })} /> Obligatoire (bloque l'envoi au circuit)</label>
        <fieldset className="rounded border border-line p-3"><legend className="px-1 text-[12px] font-semibold uppercase text-mute">Afficher seulement si…</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <select className="input" value={f.condChamp} onChange={(e) => setF({ ...f, condChamp: e.target.value })}><option value="">Toujours affiché</option>{champs.filter((c) => c.code !== f.code).map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}</select>
            {f.condChamp && <input className="input" placeholder="…vaut (valeur exacte)" value={f.condValeur} onChange={(e) => setF({ ...f, condValeur: e.target.value })} />}
          </div>
        </fieldset>
        <fieldset className="rounded border border-line p-3"><legend className="px-1 text-[12px] font-semibold uppercase text-mute">Qui peut le renseigner ?</legend>
          <div className="flex flex-wrap gap-4">{ROLES.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={f.roles.includes(k)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, k] : f.roles.filter((x: string) => x !== k) })} /> {l}</label>)}</div>
          <p className="mt-1 text-[12px] text-mute">Aucun rôle coché : tout éditeur du dossier. L'administrateur peut toujours corriger.</p>
          <Field label="À quelles étapes du circuit ?" hint="Clés d'étapes séparées par des virgules ; « brouillon » = avant l'envoi. Vide : à toutes."><input className="input" value={f.etapes} onChange={(e) => setF({ ...f, etapes: e.target.value })} placeholder="brouillon, dga" /></Field>
        </fieldset>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !f.libelle || (!champ && !f.code)} onClick={enregistrer}>{busy && <Spinner />} Enregistrer</button></div>
      </div>
    </Modal>
  );
}

/** Champs personnalisés (PAR-10). */
export function AdminChamps() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const liste = useLoad(async () => (await api.get(orgPath(o, '/champs/definitions'))).data.items as any[], [o]);
  const types = useLoad(async () => (await api.get(orgPath(o, '/referentiels/type_acte'))).data.items as any[], [o]);
  const [edit, setEdit] = useState<any | 'nouveau' | null>(null);
  const basculer = async (c: any) => { try { await api.put(orgPath(o, `/champs/${c.id}`), { actif: !c.actif }); liste.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (liste.loading && !liste.data) return <Loading />;
  const typeNom = (id: number | null) => (id ? types.data?.find((t) => t.id === id)?.libelle ?? '?' : 'Tous');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-mute">Ajoutez des informations propres à votre collectivité sur la fiche d'un dossier (ex. « Convention associée ? », « Zone géographique »). Un champ obligatoire bloque l'envoi au circuit tant qu'il n'est pas rempli.</p>
        <button className="btn-primary" onClick={() => setEdit('nouveau')}><Plus className="h-4 w-4" /> Nouveau champ</button>
      </div>
      <div className="card overflow-x-auto">
        {!liste.data?.length ? <p className="p-8 text-center text-mute">Aucun champ personnalisé.</p> : (
          <table className="w-full"><thead><tr><th>Champ</th><th>Type</th><th>Actes</th><th>Règles</th><th>État</th><th /></tr></thead><tbody>
            {liste.data.map((c) => (
              <tr key={c.id} className={c.actif ? '' : 'opacity-50'}>
                <td><b>{c.libelle}</b><div className="font-mono text-[11px] text-mute">{c.code}</div></td>
                <td>{TYPES.find(([k]) => k === c.kind)?.[1]}</td><td>{typeNom(c.typeActeId)}</td>
                <td className="text-[12px]">{c.obligatoire && <Badge tone="warn">Obligatoire</Badge>} {c.visibleSi && <span className="text-mute">si {c.visibleSi.champ} = {String(c.visibleSi.egal)} </span>}{c.rolesSaisie.length > 0 && <span className="text-mute">rôles : {c.rolesSaisie.join(', ')} </span>}{c.etapesSaisie.length > 0 && <span className="text-mute">étapes : {c.etapesSaisie.join(', ')}</span>}</td>
                <td>{c.actif ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>}</td>
                <td className="whitespace-nowrap text-right"><button className="rounded p-2 hover:bg-slate-100" aria-label={`Modifier ${c.libelle}`} onClick={() => setEdit(c)}><Pencil className="h-4 w-4" /></button>
                  <button className="rounded px-2 py-1 text-[12px] font-semibold text-action hover:bg-slate-100" onClick={() => basculer(c)}>{c.actif ? 'Désactiver' : 'Réactiver'}</button></td>
              </tr>))}
          </tbody></table>)}
      </div>
      <p className="text-[12px] text-mute">Désactiver un champ ne supprime jamais les valeurs déjà saisies dans les dossiers.</p>
      {edit && <ChampForm champ={edit === 'nouveau' ? null : edit} champs={liste.data ?? []} types={types.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); liste.reload(); toast('Champ enregistré'); }} />}
      {node}
    </div>
  );
}

const SECTIONS: Record<string, string> = { organisme: 'Vocabulaire et couleurs', parametres: 'Paramètres', referentiels: 'Référentiels propres', surcharges: 'Surcharges de référentiels', champs: 'Champs personnalisés', circuits: 'Circuits (importés en brouillon)', instances: 'Instances' };

/** Export / import de la configuration (PAR-11, PAR-12) : aperçu avant application, jamais de secret ni de personne. */
export function AdminConfiguration() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const modeles = useLoad(async () => (await api.get(orgPath(o, '/configuration/modeles'))).data.items as any[], [o]);
  const [doc, setDoc] = useState<any>(null); const [nom, setNom] = useState(''); const [apercu, setApercu] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setApercu(null); }, [doc]);
  const exporter = async () => {
    try {
      const r = await api.get(orgPath(o, '/configuration/export'), { responseType: 'blob' }); const u = URL.createObjectURL(r.data);
      const a = document.createElement('a'); a.href = u; a.download = `configuration-${org!.code}.json`; a.click(); URL.revokeObjectURL(u);
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const lire = async (f: File | undefined) => {
    if (!f) return; setErr(null);
    try { setDoc(JSON.parse(await f.text())); setNom(f.name); } catch { setErr('Ce fichier n’est pas un JSON valide.'); setDoc(null); }
  };
  const modele = async (code: string, n: string) => { try { setDoc((await api.get(orgPath(o, `/configuration/modeles/${code}`))).data); setNom(n); setErr(null); } catch (e) { setErr(errMsg(e)); } };
  const importer = async (appliquer: boolean) => {
    setBusy(appliquer ? 'app' : 'apercu'); setErr(null);
    try { const r = (await api.post(orgPath(o, '/configuration/import'), { document: doc, appliquer })).data; setApercu(r); if (appliquer) toast('Configuration appliquée'); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2>Exporter la configuration</h2>
        <p className="mb-3 text-mute">Un fichier JSON contenant les paramètres, référentiels propres, champs personnalisés, circuits et instances de <b>{org!.nom}</b>. Il ne contient <b>ni mot de passe, ni personne, ni dossier</b> : on peut le transférer de la recette vers la production, ou vers une autre collectivité.</p>
        <button className="btn-secondary" onClick={exporter}><Download className="h-4 w-4" /> Télécharger la configuration</button>
      </section>
      <section className="card space-y-3 p-5">
        <h2>Importer une configuration</h2>
        <p className="text-mute">L'import se fait en deux temps : un <b>aperçu</b> de ce qui serait créé ou modifié, puis l'<b>application</b>. Rien n'est jamais supprimé ; un circuit existant n'est jamais écrasé ; les circuits importés arrivent en <b>brouillon</b>, à publier après vérification.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-secondary cursor-pointer"><Upload className="h-4 w-4" /> Choisir un fichier…<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => lire(e.target.files?.[0])} /></label>
          {(modeles.data || []).map((m) => <button key={m.code} className="btn-secondary" title={m.description} onClick={() => modele(m.code, m.nom)}>Modèle : {m.nom}</button>)}
          {doc && <span className="text-[13px] text-mute">Source : <b>{nom}</b></span>}
        </div>
        <ErrorBox msg={err} />
        {doc && <div className="flex gap-2"><button className="btn-primary" disabled={!!busy} onClick={() => importer(false)}>{busy === 'apercu' && <Spinner />} Aperçu de l'import</button></div>}
        {apercu && (
          <div className="rounded border border-line p-3">
            <h3 className="mb-2">{apercu.appliquee ? 'Résultat de l’import' : 'Aperçu (rien n’a été modifié)'}</h3>
            {!Object.keys(apercu.sections).length ? <p className="text-mute">Le fichier ne contient rien à importer.</p> : (
              <table className="w-full"><thead><tr><th>Section</th><th>À créer</th><th>À modifier</th><th>Identiques</th><th>Ignorés</th></tr></thead><tbody>
                {Object.entries(apercu.sections).map(([k, s]: any) => <tr key={k}><td>{SECTIONS[k] || k}</td><td>{s.creer}</td><td>{s.modifier}</td><td>{s.identique}</td><td>{s.ignorer}</td></tr>)}
              </tbody></table>)}
            {apercu.avertissements.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-warn">{apercu.avertissements.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>}
            {!apercu.appliquee && (apercu.aDesEffets
              ? <div className="mt-3 flex justify-end"><button className="btn-primary" disabled={!!busy} onClick={() => window.confirm('Appliquer cette configuration à ' + org!.nom + ' ?') && importer(true)}>{busy === 'app' && <Spinner />} Appliquer</button></div>
              : <p className="mt-3 text-[13px] text-mute">Rien à faire : la configuration est déjà à jour.</p>)}
          </div>)}
      </section>
      {node}
    </div>
  );
}
