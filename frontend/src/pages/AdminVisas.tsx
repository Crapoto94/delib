import { useState } from 'react';
import { BadgeCheck, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { AgentName } from '../AgentName';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const STATUT: Record<string, { label: string; tone: 'ok' | 'warn' | 'ko' }> = { en_vigueur: { label: 'En vigueur', tone: 'ok' }, modifie: { label: 'Modifié', tone: 'warn' }, abroge: { label: 'Abrogé', tone: 'ko' } };
const TYPE: Record<string, string> = { code: 'Code (article)', loi: 'Loi', ordonnance: 'Ordonnance', decret: 'Décret', arrete: 'Arrêté', autre: 'Autre' };
const GRAVITE: Record<string, { label: string; tone: 'ko' | 'warn' | 'gray' }> = { bloquant: { label: 'Bloquant', tone: 'ko' }, a_revoir: { label: 'À revoir', tone: 'warn' }, info: { label: 'Information', tone: 'gray' } };
const jour = (d?: string | null) => (d ? dt(`${String(d).slice(0, 10)}T12:00:00`, { dateStyle: 'medium' }) : '—');

function FormEntree({ entree, onClose, onSaved }: { entree: any | null; onClose: () => void; onSaved: (r?: any) => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [f, setF] = useState<any>({ cle: entree?.cle ?? '', intitule: entree?.intitule ?? '', statut: entree?.statut ?? 'en_vigueur', dateDebut: entree?.dateDebut?.slice(0, 10) ?? '', dateFin: entree?.dateFin?.slice(0, 10) ?? '', verifieLe: entree?.verifieLe?.slice(0, 10) ?? '', source: entree?.source ?? '', note: entree?.note ?? '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const enregistrer = async () => {
    setBusy(true); setErr(null);
    const corps = { ...f, dateDebut: f.dateDebut || null, dateFin: f.dateFin || null, verifieLe: f.verifieLe || null, source: f.source || null, note: f.note || null };
    try { onSaved(entree ? (await api.put(orgPath(o, `/visas/${entree.id}`), corps)).data : (await api.post(orgPath(o, '/visas'), corps)).data); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={entree ? `Modifier « ${entree.cle} »` : 'Ajouter un texte à la bibliothèque'} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Field label="Clé *" hint="Article d'un code : cgct:L2121-29 · code seul : ccp · loi : loi:2015-991 · décret : decret:2016-360 · arrêté : arrete:2024-12. C'est elle qui rapproche un visa du dossier de cette entrée."><input className="input font-mono" autoFocus value={f.cle} onChange={(e) => setF({ ...f, cle: e.target.value })} /></Field>
        <Field label="Intitulé normalisé *" hint="Tel qu'il doit être visé, par exemple « l'article L. 2121-29 du code général des collectivités territoriales »."><input className="input" value={f.intitule} onChange={(e) => setF({ ...f, intitule: e.target.value })} /></Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Statut"><Select className="input" value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value })}>{Object.entries(STATUT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="Dernière vérification à la source" hint="La date à laquelle le juridique a contrôlé le texte."><input className="input" type="date" value={f.verifieLe} onChange={(e) => setF({ ...f, verifieLe: e.target.value })} /></Field>
          <Field label="En vigueur à partir du"><input className="input" type="date" value={f.dateDebut} onChange={(e) => setF({ ...f, dateDebut: e.target.value })} /></Field>
          <Field label="Jusqu'au (vide : sans fin)"><input className="input" type="date" value={f.dateFin} onChange={(e) => setF({ ...f, dateFin: e.target.value })} /></Field>
        </div>
        <Field label="Source"><input className="input" placeholder="Légifrance, Journal officiel…" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
        <Field label="Note pour les rédacteurs"><textarea className="input h-16" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {entree && entree.statut !== f.statut && (f.statut === 'abroge' || f.statut === 'modifie') && <p className="rounded bg-warn-bg px-3 py-2 text-[13px] text-warn">Les rédacteurs des actes en cours qui citent ce texte seront prévenus.</p>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !f.cle.trim() || f.intitule.trim().length < 2} onClick={enregistrer}>{busy && <Spinner />} Enregistrer</button></div>
      </div>
    </Modal>
  );
}

function Importer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [format, setFormat] = useState<'csv' | 'json'>('csv'); const [contenu, setContenu] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [res, setRes] = useState<any>(null);
  const lire = async (file?: File) => { if (!file) return; setContenu(await file.text()); setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'); };
  const go = async () => { setBusy(true); setErr(null); try { setRes((await api.post(orgPath(o, '/visas/import'), { format, contenu })).data); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <Modal title="Importer des textes" onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <p className="text-[13px] text-mute">Colonnes CSV (séparateur « ; ») : <code>cle;type;code;article;intitule;statut;date_debut;date_fin;verifie_le;source</code>. Une clé déjà connue est mise à jour.</p>
        <div className="flex flex-wrap items-center gap-3"><input type="file" accept=".csv,.json,.txt" onChange={(e) => lire(e.target.files?.[0])} />
          <label className="flex items-center gap-1 text-[13px]"><input type="radio" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV</label><label className="flex items-center gap-1 text-[13px]"><input type="radio" checked={format === 'json'} onChange={() => setFormat('json')} /> JSON</label></div>
        <textarea className="input h-40 font-mono text-[12px]" placeholder="Ou collez le contenu ici" value={contenu} onChange={(e) => setContenu(e.target.value)} />
        {res && <div className="rounded bg-ok-bg px-3 py-2 text-[13px] text-ok-text"><b>{res.crees}</b> créée(s), <b>{res.maj}</b> mise(s) à jour{res.erreurs.length > 0 && <>, <b className="text-ko">{res.erreurs.length} en erreur</b> :<ul className="ml-4 list-disc">{res.erreurs.slice(0, 10).map((x: any) => <li key={x.ligne}>ligne {x.ligne} ({x.cle ?? '—'}) : {x.erreur}</li>)}</ul></>}</div>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Fermer</button><button className="btn-primary" disabled={busy || contenu.trim().length < 2} onClick={go}>{busy && <Spinner />} Importer</button></div>
      </div>
    </Modal>
  );
}

function Concernes({ entree, onClose }: { entree: any; onClose: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const d = useLoad(async () => (await api.get(orgPath(o, `/visas/${entree.id}/actes-concernes`))).data.items as any[], [entree.id]);
  return (
    <Modal title={`Actes en cours qui citent « ${entree.cle} »`} onClose={onClose} wide>
      {d.loading ? <Loading /> : !d.data?.length ? <Empty>Aucun acte en cours ne cite ce texte.</Empty> : (
        <table className="w-full"><thead><tr><th>Dossier</th><th>Rédacteur</th><th>Extrait</th></tr></thead><tbody>{d.data.map((c) => (
          <tr key={c.acteId}><td className="font-semibold">n° {c.numeroSuivi} — {c.titre}</td><td><AgentName u={c.redacteur} /></td><td className="text-[12px] italic text-mute">« {c.extrait} »</td></tr>))}</tbody></table>)}
    </Modal>
  );
}

function Bibliotheque() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const [q, setQ] = useState(''); const [statut, setStatut] = useState('');
  const d = useLoad(async () => (await api.get(orgPath(o, '/visas'), { params: { q: q || undefined, statut: statut || undefined } })).data.items as any[], [o, q, statut]);
  const [edit, setEdit] = useState<any | 'nouvelle' | null>(null); const [imp, setImp] = useState(false); const [conc, setConc] = useState<any | null>(null);
  const agir = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Rechercher (clé, intitulé)…" aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="input w-auto" aria-label="Statut" value={statut} onChange={(e) => setStatut(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(STATUT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <span className="ml-auto flex gap-2"><button className="btn-secondary" onClick={() => setImp(true)}><Upload className="h-4 w-4" /> Importer</button><button className="btn-primary" onClick={() => setEdit('nouvelle')}><Plus className="h-4 w-4" /> Ajouter un texte</button></span>
      </div>
      <div className="card overflow-x-auto">
        {d.loading && !d.data ? <Loading /> : !d.data?.length ? <Empty>{q || statut ? 'Aucun texte ne correspond.' : 'La bibliothèque est vide : ajoutez les textes que vos délibérations visent habituellement (ou importez-les). Tant qu\'elle est vide, les références ne peuvent pas être vérifiées.'}</Empty> : (
          <table className="w-full"><thead><tr><th>Texte</th><th>Type</th><th>Statut</th><th>Validité</th><th>Dernière vérification</th><th /></tr></thead><tbody>{d.data.map((e) => (
            <tr key={e.id}>
              <td><div className="font-semibold">{e.intitule}</div><div className="font-mono text-[11px] text-mute">{e.cle}{e.source ? ` · ${e.source}` : ''}</div></td>
              <td>{TYPE[e.type] ?? e.type}</td>
              <td><Badge tone={STATUT[e.statut].tone}>{STATUT[e.statut].label}</Badge></td>
              <td className="text-[12px]">{e.dateDebut || e.dateFin ? `${jour(e.dateDebut)} → ${e.dateFin ? jour(e.dateFin) : 'sans fin'}` : '—'}</td>
              <td className="text-[12px]">{e.verifieLe ? <>{jour(e.verifieLe)}{e.verifiePar && <div className="text-mute">par <AgentName u={e.verifiePar} /></div>}</> : <span className="text-warn">jamais vérifié</span>}</td>
              <td className="whitespace-nowrap text-right">
                <button className="rounded p-2 hover:bg-slate-100" title="Vérifié aujourd'hui" aria-label={`Marquer ${e.cle} vérifié aujourd'hui`} onClick={() => agir(() => api.post(orgPath(o, `/visas/${e.id}/verification`), {}), 'Marqué comme vérifié aujourd’hui')}><BadgeCheck className="h-4 w-4 text-ok" /></button>
                <button className="rounded p-2 hover:bg-slate-100" title="Actes en cours qui citent ce texte" aria-label={`Actes concernés par ${e.cle}`} onClick={() => setConc(e)}><Users className="h-4 w-4" /></button>
                <button className="rounded p-2 hover:bg-slate-100" title="Modifier" aria-label={`Modifier ${e.cle}`} onClick={() => setEdit(e)}><Pencil className="h-4 w-4" /></button>
                <button className="rounded p-2 text-ko hover:bg-slate-100" title="Supprimer" aria-label={`Supprimer ${e.cle}`} onClick={() => window.confirm(`Supprimer « ${e.cle} » de la bibliothèque ?`) && agir(() => api.delete(orgPath(o, `/visas/${e.id}`)), 'Entrée supprimée')}><Trash2 className="h-4 w-4" /></button>
              </td>
            </tr>))}</tbody></table>)}
      </div>
      {edit && <FormEntree entree={edit === 'nouvelle' ? null : edit} onClose={() => setEdit(null)} onSaved={(r) => { setEdit(null); d.reload(); toast(r?.veille?.actesConcernes ? `Enregistré — ${r.veille.actesConcernes} rédacteur(s) prévenu(s)` : 'Enregistré'); }} />}
      {imp && <Importer onClose={() => setImp(false)} onDone={d.reload} />}
      {conc && <Concernes entree={conc} onClose={() => setConc(null)} />}
      {node}
    </div>
  );
}

function FormControle({ regle, types, matieres, onClose, onSaved }: { regle: any | null; types: any[]; matieres: any[]; onClose: () => void; onSaved: () => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [f, setF] = useState<any>({ nom: regle?.nom ?? '', regle: regle?.regle ?? 'visa', cle: regle?.cle ?? '', motif: regle?.motif ?? '', estRegex: regle?.estRegex ?? false, typeActeId: regle?.typeActeId ?? '', matiereId: regle?.matiereId ?? '', montantMin: regle?.montantMin ?? '', gravite: regle?.gravite ?? 'a_revoir', message: regle?.message ?? '', actif: regle?.actif ?? true });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const enregistrer = async () => {
    setBusy(true); setErr(null);
    const corps = { nom: f.nom, regle: f.regle, cle: f.regle === 'visa' ? f.cle : null, motif: f.regle === 'mention' ? f.motif : null, estRegex: f.regle === 'mention' && f.estRegex, typeActeId: f.typeActeId ? Number(f.typeActeId) : null, matiereId: f.matiereId ? Number(f.matiereId) : null, montantMin: f.montantMin === '' ? null : Number(f.montantMin), gravite: f.gravite, message: f.message || null, actif: f.actif };
    try { if (regle) await api.put(orgPath(o, `/visas/controles/${regle.id}`), corps); else await api.post(orgPath(o, '/visas/controles'), corps); onSaved(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={regle ? `Règle « ${regle.nom} »` : 'Nouvelle règle de contrôle'} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Field label="Nom de la règle *"><input className="input" autoFocus value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Type de règle"><Select className="input" value={f.regle} onChange={(e) => setF({ ...f, regle: e.target.value })}><option value="visa">Visa attendu</option><option value="mention">Mention attendue</option></Select></Field>
          <Field label="Gravité du constat"><Select className="input" value={f.gravite} onChange={(e) => setF({ ...f, gravite: e.target.value })}>{Object.entries(GRAVITE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        </div>
        {f.regle === 'visa'
          ? <Field label="Clé du visa attendu *" hint="Une clé de la bibliothèque, par exemple cgct:L1611-4."><input className="input font-mono" value={f.cle} onChange={(e) => setF({ ...f, cle: e.target.value })} /></Field>
          : <>
            <Field label="Expression attendue dans les textes *" hint={f.estRegex ? 'Expression régulière (sans tenir compte de la casse).' : 'Recherchée sans tenir compte des accents ni de la casse.'}><input className="input" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.estRegex} onChange={(e) => setF({ ...f, estRegex: e.target.checked })} /> C'est une expression régulière</label></>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Type d'acte" hint="Vide : tous."><Select className="input" value={f.typeActeId} onChange={(e) => setF({ ...f, typeActeId: e.target.value })}><option value="">Tous</option>{types.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</Select></Field>
          <Field label="Matière" hint="Vide : toutes ; les sous-matières sont comprises."><Select className="input" value={f.matiereId} onChange={(e) => setF({ ...f, matiereId: e.target.value })}><option value="">Toutes</option>{matieres.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.libelle}</option>)}</Select></Field>
        </div>
        <Field label="À partir d'un montant de (€)" hint="Vide : quel que soit le montant. Sans montant renseigné sur la fiche, la règle ne s'applique pas."><input className="input" type="number" min={0} value={f.montantMin} onChange={(e) => setF({ ...f, montantMin: e.target.value })} /></Field>
        <Field label="Message affiché au rédacteur" hint="Facultatif : un message par défaut est composé."><textarea className="input h-16" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} /> Règle active</label>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || f.nom.trim().length < 2 || (f.regle === 'visa' ? !f.cle.trim() : !f.motif.trim())} onClick={enregistrer}>{busy && <Spinner />} Enregistrer</button></div>
      </div>
    </Modal>
  );
}

function Controles() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/visas/controles'))).data.items as any[], [o]);
  const refs = useLoad(async () => {
    const [t, m] = await Promise.all([api.get(orgPath(o, '/referentiels/type_acte')), api.get(orgPath(o, '/referentiels/matiere'))]);
    return { types: t.data.items as any[], matieres: m.data.items as any[] };
  }, [o]);
  const [edit, setEdit] = useState<any | 'nouvelle' | null>(null);
  const lib = (id: number | null, list: any[] | undefined, none: string) => (id ? list?.find((x) => x.id === id)?.libelle ?? `#${id}` : none);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-mute">Les <b>règles</b> du juridique : quels <b>visas</b> et quelles <b>mentions</b> sont attendus selon le type d'acte, la matière et le montant. Elles sont appliquées par <b>« Vérifier les références »</b> et par le contrôle complet, sans IA.</p>
        <button className="btn-primary" onClick={() => setEdit('nouvelle')}><Plus className="h-4 w-4" /> Nouvelle règle</button>
      </div>
      <div className="card overflow-x-auto">
        {d.loading && !d.data ? <Loading /> : !d.data?.length ? <Empty>Aucune règle : aucun visa ni aucune mention n'est exigé automatiquement.</Empty> : (
          <table className="w-full"><thead><tr><th>Règle</th><th>Attendu</th><th>S'applique à</th><th>Gravité</th><th /></tr></thead><tbody>{d.data.map((c) => (
            <tr key={c.id} className={c.actif ? '' : 'opacity-60'}>
              <td className="font-semibold">{c.nom}{!c.actif && <Badge> inactive</Badge>}</td>
              <td>{c.regle === 'visa' ? <>Visa <code className="text-[12px]">{c.cle}</code></> : <>Mention « {c.motif} »{c.estRegex && <span className="text-[11px] text-mute"> (regex)</span>}</>}</td>
              <td className="text-[12px]">{lib(c.typeActeId, refs.data?.types, 'Tous les types')} · {c.matiereId ? lib(c.matiereId, refs.data?.matieres, '') : 'toutes matières'}{c.montantMin !== null ? ` · ≥ ${Number(c.montantMin).toLocaleString('fr-FR')} €` : ''}</td>
              <td><Badge tone={GRAVITE[c.gravite].tone}>{GRAVITE[c.gravite].label}</Badge></td>
              <td className="whitespace-nowrap text-right">
                <button className="rounded p-2 hover:bg-slate-100" title="Modifier" aria-label={`Modifier ${c.nom}`} onClick={() => setEdit(c)}><Pencil className="h-4 w-4" /></button>
                <button className="rounded p-2 text-ko hover:bg-slate-100" title="Supprimer" aria-label={`Supprimer ${c.nom}`} onClick={async () => { if (!window.confirm(`Supprimer la règle « ${c.nom} » ?`)) return; try { await api.delete(orgPath(o, `/visas/controles/${c.id}`)); toast('Règle supprimée'); d.reload(); } catch (e) { toast(errMsg(e), 'ko'); } }}><Trash2 className="h-4 w-4" /></button>
              </td>
            </tr>))}</tbody></table>)}
      </div>
      {edit && refs.data && <FormControle regle={edit === 'nouvelle' ? null : edit} types={refs.data.types} matieres={refs.data.matieres} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); d.reload(); toast('Règle enregistrée'); }} />}
      {node}
    </div>
  );
}

/** Visas et références (IA-32, IA-38, D101) : la bibliothèque et les listes de contrôle du juridique. Le contrôle des dossiers ne repose que sur elles. */
export default function AdminVisas() {
  const [onglet, setOnglet] = useState<'bibliotheque' | 'controles'>('bibliotheque');
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-mute">La <b>bibliothèque de visas</b> est la référence du juridique : l'assistant vérifie les textes cités dans un dossier <b>contre elle</b>, à la date de la séance — jamais de mémoire. Un texte absent de la bibliothèque est signalé « à faire vérifier », pas « faux ».</p>
      <div role="tablist" className="flex gap-1 border-b border-line">{([['bibliotheque', 'Bibliothèque de textes'], ['controles', 'Listes de contrôle']] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={onglet === k} onClick={() => setOnglet(k)} className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-semibold ${onglet === k ? 'border-primary text-head' : 'border-transparent text-mute hover:text-ink'}`}>{l}</button>))}</div>
      {onglet === 'bibliotheque' ? <Bibliotheque /> : <Controles />}
    </div>
  );
}
