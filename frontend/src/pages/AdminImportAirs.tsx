import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronLeft, ChevronRight, Cog, Database, Eye, FileJson, ListChecks, Play, Plus, RefreshCw, Trash2, Upload, Wand2, XCircle } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const AXES: Record<string, string> = { organisme: 'Organisme', instance: 'Instance', type_seance: 'Type de conseil', direction: 'Direction', service: 'Service', agent: 'Agent', elu: 'Élu', commission: 'Commission', type_acte: "Type d'acte", nature: 'Nature', rubrique: 'Rubrique', matiere: 'Matière' };
const ORDRE_AXES = Object.keys(AXES);
const CIBLE_TYPE: Record<string, string> = { direction: 'directions', service: 'services', agent: 'agents', elu: 'elus', commission: 'commissions', instance: 'instances', type_seance: 'seance_types', organisme: 'organismes', type_acte: 'ref_items', nature: 'ref_items', rubrique: 'ref_items', matiere: 'ref_items' };
const ETAT: Record<string, { label: string; tone: 'ok' | 'warn' | 'ko' | 'gray' | 'blue' }> = {
  a_faire: { label: 'À faire', tone: 'gray' }, proposee: { label: 'Proposée', tone: 'warn' }, automatique: { label: 'Automatique', tone: 'blue' },
  manuelle: { label: 'Validée', tone: 'ok' }, ignoree: { label: 'Ignorée', tone: 'gray' },
};
const LOT: Record<string, { label: string; tone: 'ok' | 'warn' | 'ko' | 'gray' | 'blue' }> = {
  brouillon: { label: 'Brouillon', tone: 'gray' }, charge: { label: 'Chargé', tone: 'blue' }, analyse: { label: 'Analysé', tone: 'blue' },
  concordances: { label: 'Concordances', tone: 'warn' },   pret: { label: 'Prêt', tone: 'warn' }, publie: { label: 'Importé', tone: 'ok' }, annule: { label: 'Annulé', tone: 'ko' },
};
const clamp = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

function NouveauLot({ o, onClose, onDone }: { o: number; onClose: () => void; onDone: (lot: any) => void }) {
  const [f, setF] = useState({ label: `Reprise AIRS ${new Date().getFullYear()}`, sourceKind: 'json', mode: 'passes' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { onDone((await api.post(orgPath(o, '/import-airs/lots'), f)).data); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  return (
    <Modal title="Nouveau lot de reprise AIRS DELIB" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Field label="Libellé du lot *"><input className="input" autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Source"><Select className="input" value={f.sourceKind} onChange={(e) => setF({ ...f, sourceKind: e.target.value })}><option value="json">Fichier / export JSON du HUB</option><option value="tables">Tables airs_* (schéma partagé)</option></Select></Field>
          <Field label="Périmètre"><Select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="passes">Séances passées (défaut)</option><option value="preparation">Séances passées + actes en préparation</option></Select></Field>
        </div>
        <p className="text-[12px] text-mute">Les données sont déposées dans un <b>sas</b> : rien n'entre dans l'outil avant la validation des concordances puis la publication.</p>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || f.label.trim().length < 2} onClick={go}>{busy && <Spinner />} Créer le lot</button></div>
      </div>
    </Modal>
  );
}

/** Bandeau de progression d'un chargement/analyse long : phase, entités traitées, séances/actes. */
function Progression({ p }: { p: any }) {
  if (!p?.enCours) return null;
  const pct = p.total ? Math.min(100, Math.round((p.fait / p.total) * 100)) : 0;
  const phases: Record<string, string> = { chargement: 'Chargement du sas', analyse: 'Analyse des conseils et des actes', concordances: 'Concordances', proposition: 'Propositions automatiques' };
  return (
    <div className="rounded border border-action/30 bg-action/5 p-3" role="status" aria-live="polite">
      <div className="mb-1 flex items-center justify-between gap-2 text-[13px]"><span className="flex items-center gap-2"><Spinner /> {phases[p.phase] ?? p.phase}…</span><b className="tabular-nums">{p.fait ?? 0} / {p.total ?? 0}</b></div>
      <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-action-solid transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="mt-1 text-[12px] text-mute"><span className="tabular-nums">{p.seances ?? 0}</span> séance(s) · <span className="tabular-nums">{p.actes ?? 0}</span> acte(s) en cours · {pct} %</div>
    </div>
  );
}

function Charger({ o, lot, onDone, onClose }: { o: number; lot: any; onDone: () => void; onClose: () => void }) {
  const [contenu, setContenu] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [annee, setAnnee] = useState(''); const [prog, setProg] = useState<any>(null);
  const source = useLoad(async () => (await api.get(orgPath(o, '/import-airs/source'))).data as any, [o]);
  useEffect(() => {
    if (!busy) { setProg(null); return; }
    const t = setInterval(async () => { try { setProg((await api.get(orgPath(o, `/import-airs/lots/${lot.id}/progression`))).data); } catch { /* lot en cours */ } }, 800);
    return () => clearInterval(t);
  }, [busy, o, lot.id]);
  const lire = async (file?: File) => { if (file) setContenu(await file.text()); };
  const envoyer = async (data: any, demo = false) => {
    setBusy(true); setErr(null);
    try { demo ? await api.post(orgPath(o, `/import-airs/lots/${lot.id}/charger-demo`), {}) : await api.post(orgPath(o, `/import-airs/lots/${lot.id}/charger`), { data }); onDone(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const chargerOracle = async () => {
    setBusy(true); setErr(null);
    try { await api.post(orgPath(o, `/import-airs/lots/${lot.id}/charger-oracle`), annee ? { annee: Number(annee) } : {}); onDone(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const chargerFichier = () => { try { envoyer(JSON.parse(contenu)); } catch { setErr('JSON illisible'); } };
  return (
    <Modal title="Charger les données AIRS dans le sas" onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Progression p={prog} />
        <section className="rounded border border-line p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Database className="h-4 w-4" /> <b className="text-[13px]">Base Oracle AIRS DELIB (lecture seule)</b>
            {source.data?.configuree ? (source.data.joignable ? <Badge tone="ok">joignable</Badge> : <Badge tone="ko">injoignable</Badge>) : <Badge tone="gray">non configurée</Badge>}
          </div>
          {source.data?.message && <p className="mb-2 text-[12px] text-mute">{source.data.message}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <input className="input !w-32" type="number" min={1990} max={2100} placeholder="Année (option)" value={annee} onChange={(e) => setAnnee(e.target.value)} />
            <button className="btn-primary" disabled={busy || !source.data?.joignable} onClick={chargerOracle}><Database className="h-4 w-4" /> Charger depuis Oracle AIRS</button>
            <button className="btn-secondary" disabled={busy} onClick={() => envoyer(null, true)}><Wand2 className="h-4 w-4" /> Jeu d'essai</button>
          </div>
          <p className="mt-2 text-[12px] text-mute">Séances et actes (délibérations) sont extraits de la base d'origine et déposés bruts dans le sas. Rien n'est écrit dans l'outil avant validation.</p>
        </section>
        <p className="text-[13px] text-mute">Ou chargez un export JSON du HUB : objet <code>{'{ "seances": [ … ], "rapports": [ … ] }'}</code>.</p>
        <div className="flex flex-wrap items-center gap-3"><input type="file" accept=".json" onChange={(e) => lire(e.target.files?.[0])} /></div>
        <textarea className="input h-44 font-mono text-[12px]" placeholder="Ou collez l'export JSON du HUB ici" value={contenu} onChange={(e) => setContenu(e.target.value)} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Fermer</button><button className="btn-primary" disabled={busy || contenu.trim().length < 2} onClick={chargerFichier}>{busy && <Spinner />} Charger</button></div>
      </div>
    </Modal>
  );
}

function Mapping({ o, onClose, onDone }: { o: number; onClose: () => void; onDone: () => void }) {
  const d = useLoad(async () => (await api.get(orgPath(o, '/import-airs/mapping'))).data.items as any[], [o]);
  const [txt, setTxt] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const initial = useMemo(() => (d.data ? JSON.stringify(d.data.map((m) => ({ tableName: m.table_name, libelle: m.libelle, entiteCible: m.entite_cible, cleColonne: m.cle_colonne, colonnes: m.colonnes, ordre: m.ordre, actif: m.actif })), null, 2) : ''), [d.data]);
  const save = async () => { setBusy(true); setErr(null); try { await api.put(orgPath(o, '/import-airs/mapping'), { items: JSON.parse(txt) }); onDone(); } catch (e) { setErr(e instanceof SyntaxError ? 'JSON illisible' : errMsg(e)); setBusy(false); } };
  return (
    <Modal title="Mapping déclaratif des tables AIRS" onClose={onClose} wide>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <p className="text-[13px] text-mute">Le MCD d'AIRS est documenté (voir <code>airs_mcd.md</code>) : chaque table source et la correspondance de ses colonnes vers les champs canoniques (<code>titre</code>, <code>direction</code>, <code>service</code>, <code>date</code>…) restent ajustables ici. Toute modification du mapping annule la validation de la table : il faut la recontrôler.</p>
        {d.loading ? <Loading /> : <textarea className="input h-72 font-mono text-[12px]" value={txt || initial} onChange={(e) => setTxt(e.target.value)} onFocus={() => { if (!txt) setTxt(initial); }} />}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Fermer</button><button className="btn-primary" disabled={busy || !(txt || initial)} onClick={save}>{busy && <Spinner />} Enregistrer le mapping</button></div>
      </div>
    </Modal>
  );
}

function ApercuTable({ o, table, onClose }: { o: number; table: any; onClose: () => void }) {
  const d = useLoad(async () => (await api.get(orgPath(o, `/import-airs/tables/${table.tableName}/apercu`), { params: { limite: 10 } })).data as any, [o, table.tableName]);
  return (
    <Modal title={`Aperçu — ${table.libelle || table.tableName}`} onClose={onClose} wide>
      <div className="space-y-3">
        {d.loading ? <Loading /> : d.error ? <ErrorBox msg={d.error} /> : (
          <>
            <p className="text-[13px] text-mute">Table <code>{table.tableName}</code> → entité <b>{table.entiteCible}</b>{d.data?.nbLignes != null && <> · <b>{d.data.nbLignes.toLocaleString('fr-FR')}</b> ligne(s) à importer</>}. Contrôlez les données et la transposition des colonnes avant de valider l'import.</p>
            {d.data?.message && <p className="rounded bg-warn-bg px-3 py-2 text-[13px] text-warn">{d.data.message}</p>}
            <div>
              <b className="text-[13px]">Correspondance des colonnes</b>
              <div className="mt-1 flex flex-wrap gap-2">{(d.data?.colonnes ?? []).map((c: any) => <span key={c.source} className="rounded border border-line px-2 py-0.5 font-mono text-[11px]">{c.source} → {c.cible}</span>)}</div>
            </div>
            <div className="overflow-x-auto">
              <b className="text-[13px]">Données source (transposées)</b>
              <table className="mt-1 w-full text-[12px]"><thead><tr><th>Titre</th><th>Date</th><th>Instance</th><th>Direction</th><th>Service</th><th>Rubrique</th><th>Résultat</th></tr></thead>
                <tbody>{(d.data?.apercu ?? []).map((x: any, i: number) => (
                  <tr key={i}><td>{clamp(String(x.transpose?.titre ?? x.transpose?.objet ?? '—'), 80)}</td><td className="whitespace-nowrap">{x.transpose?.date ? dt(x.transpose.date, { dateStyle: 'short' }) : '—'}</td><td>{x.transpose?.instance ?? '—'}</td><td>{x.transpose?.direction ?? '—'}</td><td>{x.transpose?.service ?? '—'}</td><td>{x.transpose?.rubrique ?? '—'}</td><td>{x.transpose?.resultat ?? '—'}</td></tr>
                ))}</tbody></table>
            </div>
            <details><summary className="cursor-pointer text-[12px] text-mute">Données brutes (JSON)</summary>
              <pre className="mt-1 max-h-56 overflow-auto rounded bg-soft p-2 font-mono text-[11px]">{JSON.stringify((d.data?.apercu ?? []).map((x: any) => x.brut), null, 1)}</pre>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}

function TablesSource({ o, onChanged }: { o: number; onChanged: () => void }) {
  const d = useLoad(async () => (await api.get(orgPath(o, '/import-airs/tables'))).data.items as any[], [o]);
  const { toast } = useToast();
  const [apercu, setApercu] = useState<any>(null);
  const basculer = async (t: any, valide: boolean) => {
    try { await api.post(orgPath(o, `/import-airs/tables/${t.tableName}/valider`), { valide }); toast(valide ? `Table « ${t.libelle} » validée` : 'Validation retirée'); d.reload(); onChanged(); }
    catch (e) { toast(errMsg(e), 'ko'); }
  };
  if (d.loading && !d.data) return <Loading />;
  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2"><ListChecks className="h-4 w-4" /><b>Tables source — validation obligatoire</b>
        <span className="text-[12px] text-mute">Aucune table n'est importée tant qu'elle n'a pas été contrôlée (données + transposition). L'import ne modifie jamais le paramétrage de l'application.</span>
      </div>
      <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>Table AIRS</th><th>Entité</th><th>Colonnes</th><th>État</th><th /></tr></thead>
        <tbody>{(d.data ?? []).map((t: any) => (
          <tr key={t.tableName}>
            <td><div className="font-semibold">{t.libelle || t.tableName}</div><div className="font-mono text-[11px] text-mute">{t.tableName}</div></td>
            <td className="text-[12px]">{t.entiteCible}</td>
            <td className="text-[12px]">{t.colonnes?.length ?? 0}</td>
            <td>{t.valide ? <Badge tone="ok">validée</Badge> : <Badge tone="warn">à valider</Badge>}{t.valide && t.validePar && <div className="text-[11px] text-mute">{t.validePar}</div>}</td>
            <td className="whitespace-nowrap text-right">
              <button className="btn-secondary mr-1 !px-2 !py-1 text-[12px]" onClick={() => setApercu(t)}><Eye className="h-3.5 w-3.5" /> Aperçu</button>
              {t.valide
                ? <button className="btn-secondary !px-2 !py-1 text-[12px]" onClick={() => basculer(t, false)}>Retirer</button>
                : <button className="btn-primary !px-2 !py-1 text-[12px]" onClick={() => basculer(t, true)}><Check className="h-3.5 w-3.5" /> Valider</button>}
            </td>
          </tr>))}</tbody></table></div>
      {apercu && <ApercuTable o={o} table={apercu} onClose={() => setApercu(null)} />}
    </section>
  );
}

function ExemplesConcordance({ o, lotId, c, onClose }: { o: number; lotId: number; c: any; onClose: () => void }) {
  const d = useLoad(async () => (await api.get(orgPath(o, `/import-airs/lots/${lotId}/concordances/${c.id}/exemples`), { params: { limite: 15 } })).data as any, [o, lotId, c.id]);
  return (
    <Modal title={`Données source — ${AXES[c.axe] ?? c.axe} : ${c.sourceCode}`} onClose={onClose} wide>
      {d.loading ? <Loading /> : d.error ? <ErrorBox msg={d.error} /> : (!d.data?.exemples?.length ? <Empty>Aucun exemple dans ce lot.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full text-[12px]"><thead><tr><th>Acte / séance</th><th>Date</th><th>Instance</th><th>Direction</th><th>Service</th><th>Résultat</th></tr></thead>
          <tbody>{d.data.exemples.map((x: any, i: number) => (
            <tr key={i}><td><div className="font-semibold">{clamp(String(x.titre ?? '(sans objet)'), 120)}</div><div className="font-mono text-[11px] text-mute">{x.sourceKey} · {x.kind}</div></td>
              <td className="whitespace-nowrap">{x.date ? dt(x.date, { dateStyle: 'short' }) : '—'}</td><td>{x.instance ?? '—'}</td><td>{x.direction ?? '—'}</td><td>{x.service ?? '—'}</td><td>{x.resultat ?? '—'}</td></tr>
          ))}</tbody></table></div>
      ))}
    </Modal>
  );
}

function SupprimerLot({ o, lotId, onClose, onDone }: { o: number; lotId: number; onClose: () => void; onDone: () => void }) {
  const [param, setParam] = useState(true); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const go = async () => { setBusy(true); setErr(null); try { await api.delete(orgPath(o, `/import-airs/lots/${lotId}`), { params: { parametrage: param ? 'true' : 'false' } }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  return (
    <Modal title="Supprimer ce lot de reprise" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <p className="text-[13px]">Le <b>sas</b>, les <b>concordances</b>, les liens et le journal de ce lot seront <b>définitivement supprimés</b>. Les actes éventuellement importés sont retirés (marqués « abandonnés »), jamais supprimés physiquement.</p>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={param} onChange={(e) => setParam(e.target.checked)} /> Réinitialiser aussi le paramétrage des tables (mapping) — recommandé en essai/erreur</label>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary !bg-ko-solid" disabled={busy} onClick={go}>{busy && <Spinner />} Supprimer définitivement</button></div>
      </div>
    </Modal>
  );
}

function LigneConcordance({ o, lotId, c, cibles, onDone, onVoir }: { o: number; lotId: number; c: any; cibles: any[]; onDone: () => void; onVoir: (c: any) => void }) {
  const { toast } = useToast();
  const [verif, setVerif] = useState<any>(null);
  const cle = (x: any) => (x.id != null ? `i${x.id}` : `c${x.code ?? x.libelle}`);
  const courante = cibles.find((x) => (c.cibleId != null && String(x.id) === String(c.cibleId)) || (c.cibleCode && x.code === c.cibleCode));
  const decide = async (x: any | null) => {
    try {
      await api.post(orgPath(o, `/import-airs/lots/${lotId}/concordances/${c.id}`), x ? { cibleType: CIBLE_TYPE[c.axe], cibleId: x.id ?? null, cibleCode: x.code ?? null, cibleLibelle: x.libelle, etat: 'manuelle' } : { etat: 'ignoree' });
      toast(x ? 'Concordance validée' : 'Valeur ignorée'); onDone();
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const verifierAd = async () => { try { setVerif((await api.post(orgPath(o, '/import-airs/agents/verifier'), { valeurs: [{ nom: c.sourceCode }] })).data.items[0]); } catch (e) { toast(errMsg(e), 'ko'); } };
  const creer = async () => {
    const defaut = (String(c.sourceCode).split(/\s[-–—]\s/).pop() || '').trim();
    const libelle = window.prompt('Libellé de la direction/service historique (ancienne organisation) :', String(c.sourceCode));
    if (libelle === null || !libelle.trim()) return;
    const code = window.prompt('Code (facultatif — laisser vide si aucun) :', defaut);
    if (code === null) return;
    try {
      await api.post(orgPath(o, `/import-airs/lots/${lotId}/concordances/${c.id}/historique`), { libelle: libelle.trim(), code: code.trim() || undefined });
      toast(c.axe === 'direction' ? 'Direction historique créée et concordée' : 'Service historique créé et concordé'); onDone();
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const e = ETAT[c.etat] ?? ETAT.a_faire;
  return (
    <tr className={c.bloquant && !['manuelle', 'ignoree'].includes(c.etat) ? 'bg-warn-bg/40' : ''}>
      <td><div className="font-semibold">{c.sourceCode}</div><div className="text-[11px] text-mute">{c.bloquant && <span className="text-ko">bloquant · </span>}{c.occurrence} acte(s)</div></td>
      <td><Badge tone={e.tone}>{e.label}</Badge>{c.confiance != null && c.etat === 'proposee' && <span className="ml-1 text-[11px] text-mute">{Math.round(c.confiance * 100)} %</span>}</td>
      <td>
        <Select className="input" value={courante ? cle(courante) : ''} onChange={(event) => { const x = cibles.find((y) => cle(y) === event.target.value); if (x) decide(x); }}>
          <option value="">— choisir une cible —</option>
          {cibles.map((x) => <option key={cle(x)} value={cle(x)}>{x.libelle}{x.historique ? ' (ancienne)' : ''}{x.code && x.code !== x.libelle ? ` (${x.code})` : ''}</option>)}
        </Select>
      </td>
      <td className="whitespace-nowrap text-right">
        {courante && ['proposee', 'automatique'].includes(c.etat) && <button className="btn-ok mr-1 !px-2 !py-1 text-[12px]" onClick={() => decide(courante)}><Check className="h-3.5 w-3.5" /> Valider</button>}
        {(c.axe === 'direction' || c.axe === 'service') && !['manuelle', 'ignoree'].includes(c.etat) && <button className="btn-secondary mr-1 !px-2 !py-1 text-[12px]" title="Créer une direction/service historique (ancienne organisation) et la concordée" onClick={creer}><Plus className="h-3.5 w-3.5" /> Créer</button>}
        <button className="btn-secondary mr-1 !px-2 !py-1 text-[12px]" title="Voir les données source" onClick={() => onVoir(c)}><Eye className="h-3.5 w-3.5" /> Données</button>
        {c.axe === 'agent' && <button className="btn-secondary mr-1 !px-2 !py-1 text-[12px]" onClick={verifierAd}>Contrôle AD</button>}
        <button className="rounded p-2 text-ko hover:bg-slate-100" title="Ignorer cette valeur" aria-label={`Ignorer ${c.sourceCode}`} onClick={() => decide(null)}><Ban className="h-4 w-4" /></button>
        {verif && <div className="mt-1 text-left text-[11px] text-mute">{verif.statut === 'connu' ? `AD : connu (${verif.trouves?.[0]?.libelle ?? ''})` : verif.statut === 'jamais_connecte' ? `AD : ${verif.trouves?.[0]?.libelle ?? 'trouvé'}` : `AD : ${verif.statut}`}</div>}
      </td>
    </tr>
  );
}

function Concordances({ o, lotId, conc, onDone }: { o: number; lotId: number; conc: any; onDone: () => void }) {
  const { toast } = useToast();
  const axes = [...new Set((conc.items as any[]).map((c) => c.axe))].sort((a, b) => (ORDRE_AXES.indexOf(a) + 1 || 99) - (ORDRE_AXES.indexOf(b) + 1 || 99)) as string[];
  const cibles = useLoad(async () => {
    const out: Record<string, any[]> = {};
    await Promise.all(axes.map(async (axe) => { out[axe] = (await api.get(orgPath(o, '/import-airs/cibles'), { params: { axe } })).data.items as any[]; }));
    return out;
  }, [o, lotId, axes.join(',')]);
  const [voir, setVoir] = useState<any>(null);
  const [replies, setReplies] = useState<Record<string, boolean>>({});
  const validerTout = async (axe: string) => {
    try { const r = (await api.post(orgPath(o, `/import-airs/lots/${lotId}/concordances/valider`), {}, { params: { axe } })).data; toast(`${r.validees} assignation(s) validée(s)`); onDone(); }
    catch (e) { toast(errMsg(e), 'ko'); }
  };
  if (!conc.items.length) return <Empty>Aucune valeur à concorder : analysez le lot.</Empty>;
  if (cibles.loading) return <Loading />;
  return (
    <div className="space-y-4">
      {conc.items.some((c: any) => c.bloquant && !['automatique', 'manuelle', 'ignoree'].includes(c.etat)) && <p className="flex items-center gap-2 rounded bg-warn-bg px-3 py-2 text-[13px] text-warn"><AlertTriangle className="h-4 w-4" /> La publication reste bloquée tant que les concordances bloquantes ne sont pas validées ou ignorées.</p>}
      {axes.map((axe) => {
        const rows = conc.items.filter((c: any) => c.axe === axe);
        const resolue = rows.every((c: any) => ['automatique', 'manuelle', 'ignoree'].includes(c.etat));
        const ouvert = replies[axe] ?? !resolue; // les blocs déjà entièrement validés sont « enroulés » d'office
        return (
          <section key={axe} className="card overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
              <button type="button" className="flex items-center gap-2 text-left" aria-expanded={ouvert} onClick={() => setReplies((r) => ({ ...r, [axe]: !ouvert }))}>
                {ouvert ? <ChevronDown className="h-4 w-4 shrink-0 text-mute" /> : <ChevronRight className="h-4 w-4 shrink-0 text-mute" />}
                <b>{AXES[axe] ?? axe}</b>
              </button>
              <span className="flex items-center gap-2 text-[12px] text-mute">
                {rowCount(rows)}
                {rows.some((c: any) => ['proposee', 'automatique'].includes(c.etat) && (c.cibleCode || c.cibleId != null)) && <button className="btn-secondary !px-2 !py-1 text-[12px]" onClick={() => validerTout(axe)}><Check className="h-3.5 w-3.5" /> Valider toutes les assignations automatiques</button>}
              </span>
            </div>
            {ouvert && <table className="w-full"><thead><tr><th>Valeur AIRS</th><th>État</th><th>Cible dans VibeDélib</th><th /></tr></thead>
              <tbody>{rows.map((c: any) => <LigneConcordance key={c.id} o={o} lotId={lotId} c={c} cibles={cibles.data?.[axe] ?? []} onDone={onDone} onVoir={setVoir} />)}</tbody></table>}
          </section>
        );
      })}
      {voir && <ExemplesConcordance o={o} lotId={lotId} c={voir} onClose={() => setVoir(null)} />}
    </div>
  );
}

const rowCount = (rows: any[]) => `${rows.filter((c) => ['automatique', 'manuelle', 'ignoree'].includes(c.etat)).length}/${rows.length} résolue(s)`;

const CHAMPS_ACTE: [string, string][] = [
  ['numero', 'Numéro'], ['titre', 'Titre'], ['objet', 'Objet'], ['date', 'Date'], ['resultat', 'Résultat'], ['direction', 'Direction'],
  ['service', 'Service'], ['redacteur', 'Rédacteur'], ['rapporteur', 'Rapporteur'], ['nature', 'Nature'], ['matiere', 'Matière'],
  ['rubrique', 'Rubrique'], ['instance', 'Instance'], ['commission', 'Commission'], ['incidence_financiere', 'Incidence financière'],
  ['montant', 'Montant'], ['expose', 'Exposé des motifs'], ['considere', 'Considérants'], ['visas', 'Visas'], ['dispositif', 'Dispositif'],
];
const etatItem = (x: any) => (x.statut === 'publie' ? 'importé' : x.statut === 'ignore' ? 'ignoré' : x.problemes?.length ? `${x.problemes.length} point(s) à résoudre` : 'prêt');

/** Aperçu d'un acte du sas : champs métier lisibles (jamais le JSON brut). */
function VoirActe({ acte, onClose }: { acte: any; onClose: () => void }) {
  const p = acte.payload; const champs = CHAMPS_ACTE.filter(([k]) => p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== '');
  return (
    <Modal title={`Acte — ${clamp(String(p.titre ?? p.objet ?? acte.sourceKey), 60)}`} onClose={onClose} wide>
      <p className="mb-3 text-[12px] text-mute">Clé <code>{acte.sourceKey}</code> · {etatItem(acte)}{acte.acteId ? ` · acte #${acte.acteId}` : ''}</p>
      {champs.length ? <dl>{champs.map(([k, label]) => (
        <div key={k} className="flex flex-col gap-0.5 border-b border-line py-1 sm:flex-row sm:gap-3">
          <dt className="w-44 shrink-0 text-[12px] font-semibold text-mute">{label}</dt>
          <dd className="min-w-0 flex-1 whitespace-pre-wrap text-[13px]">{String(p[k])}</dd>
        </div>))}</dl> : <Empty>Aucune donnée exploitable pour cet acte.</Empty>}
      {acte.problemes?.length > 0 && <div className="mt-3 rounded bg-ko-bg px-3 py-2 text-[12px] text-ko">{acte.problemes.map((x: any) => x.label).join(' · ')}</div>}
    </Modal>
  );
}

/** Aperçu des actes d'un conseil : la liste des actes rattachés à la séance, sans JSON. */
function ApercuConseil({ seance, actes, onClose }: { seance: any; actes: any[]; onClose: () => void }) {
  const [voir, setVoir] = useState<any>(null);
  return (
    <Modal title={`Actes du conseil — ${clamp(String(seance.payload.titre ?? seance.sourceKey), 60)}`} onClose={onClose} wide>
      <p className="mb-3 text-[13px] text-mute">{seance.payload.instance ?? '—'} · {seance.payload.date ? dt(seance.payload.date, { dateStyle: 'long' }) : '—'} · {seance.payload.type_seance ?? seance.payload.type ?? '—'} · <b>{actes.length}</b> acte(s)</p>
      {!actes.length ? <Empty>Aucun acte rattaché à ce conseil dans le lot.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full text-[12px]">
          <thead><tr><th>Acte</th><th>N°</th><th>Date</th><th>Résultat</th><th>Direction</th><th>État</th><th /></tr></thead>
          <tbody>{actes.map((a) => (
            <tr key={a.id}>
              <td><div className="font-semibold">{clamp(String(a.payload.titre ?? a.payload.objet ?? '(sans objet)'), 80)}</div><div className="text-[11px] text-mute">{a.sourceKey}</div></td>
              <td className="font-mono text-[11px]">{a.payload.numero ?? '—'}</td>
              <td className="whitespace-nowrap">{a.payload.date ? dt(a.payload.date, { dateStyle: 'short' }) : '—'}</td>
              <td>{a.payload.resultat ?? '—'}</td>
              <td>{a.payload.direction ?? '—'}</td>
              <td>{a.statut === 'publie' ? <Badge tone="ok">Importé</Badge> : a.statut === 'ignore' ? <Badge tone="gray">Ignoré</Badge> : a.problemes?.length ? <span className="text-ko">{a.problemes.length} à résoudre</span> : <Badge tone="blue">Prêt</Badge>}</td>
              <td className="text-right"><button className="btn-secondary !px-2 !py-1 text-[12px]" onClick={() => setVoir(a)}><Eye className="h-3.5 w-3.5" /> Voir</button></td>
            </tr>))}</tbody></table></div>
      )}
      {voir && <VoirActe acte={voir} onClose={() => setVoir(null)} />}
    </Modal>
  );
}

/** Les conseils du sas : pour chaque séance, ses actes, leur état et l'import du conseil entier. */
function Conseils({ o, lotId, detail, onDone }: { o: number; lotId: number; detail: any; onDone: () => void }) {
  const { toast } = useToast();
  const [apercu, setApercu] = useState<any>(null);
  const items = detail.items as any[];
  const seances = items.filter((x) => x.kind === 'seance');
  const actes = items.filter((x) => x.kind === 'acte');
  const actesTable = (detail.mapping ?? []).find((m: any) => m.table_name === 'actes');
  const actesDe = (s: any) => actes.filter((a) => a.payload.seance && String(a.payload.seance) === s.sourceKey);
  const importer = async (s: any) => {
    try {
      const r = (await api.post(orgPath(o, `/import-airs/lots/${lotId}/actes/${s.id}/publier`), {})).data;
      toast(r.erreurs?.length ? `Conseil importé — ${r.actes} acte(s), ${r.erreurs.length} en erreur` : `Conseil importé (${r.actes} acte(s))`, r.erreurs?.length ? 'ko' : 'ok'); onDone();
    } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const ignorer = async (s: any) => { try { await api.post(orgPath(o, `/import-airs/lots/${lotId}/actes/${s.id}/ignorer`), {}); toast('Conseil ignoré'); onDone(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (!seances.length) return <Empty>Aucun conseil dans le sas. Vérifiez que la table source « seances » est validée, puis rechargez le lot.</Empty>;
  return (
    <div className="card overflow-x-auto">
      {!actes.length && actesTable && !actesTable.valide && (
        <div className="border-b border-line bg-warn-bg px-4 py-2 text-[13px] text-warn">La table source « actes » n'est pas validée : les actes ne sont pas chargés. Validez-la dans « Tables source », rechargez le lot puis relancez l'analyse.</div>
      )}
      <table className="w-full"><thead><tr><th>Conseil</th><th>Instance</th><th>Type de conseil</th><th>Actes</th><th>État</th><th /></tr></thead><tbody>{seances.map((s) => {
        const mes = actesDe(s); const prets = mes.filter((a) => a.statut === 'publie' || !a.problemes?.length).length;
        return (
          <tr key={s.id}>
            <td><div className="font-semibold">{s.payload.titre ?? s.payload.numero ?? '(sans intitulé)'}</div><div className="text-[11px] text-mute">{s.sourceKey} · {s.payload.date ? dt(s.payload.date, { dateStyle: 'medium' }) : 'date ?'}</div></td>
            <td className="text-[12px]">{s.payload.instance ?? '—'}</td>
            <td className="text-[12px]">{s.payload.type_seance ?? s.payload.type ?? '—'}</td>
            <td className="text-[12px]">{mes.length} acte(s){mes.length > 0 && <span className="text-mute"> · {prets}/{mes.length} prêt(s)</span>}</td>
            <td>{s.statut === 'publie' ? <Badge tone="ok">Importé</Badge> : s.statut === 'ignore' ? <Badge tone="gray">Ignoré</Badge> : s.problemes?.length ? <span className="text-[12px] text-ko">{s.problemes.map((p: any) => p.label).join(' · ')}</span> : <Badge tone="blue">Prêt</Badge>}</td>
            <td className="whitespace-nowrap text-right">
              <button className="btn-secondary mr-1 !px-2 !py-1 text-[12px]" onClick={() => setApercu(s)}><Eye className="h-3.5 w-3.5" /> Aperçu</button>
              {s.statut !== 'publie' && <button className="btn-primary mr-1 !px-2 !py-1 text-[12px]" disabled={!!s.problemes?.length} onClick={() => importer(s)}><Check className="h-3.5 w-3.5" /> Importer</button>}
              {s.statut !== 'publie' && <button className="rounded p-2 text-ko hover:bg-slate-100" title="Ignorer" aria-label="Ignorer" onClick={() => ignorer(s)}><XCircle className="h-4 w-4" /></button>}
            </td>
          </tr>);
      })}</tbody></table>
      {apercu && <ApercuConseil seance={apercu} actes={actesDe(apercu)} onClose={() => setApercu(null)} />}
    </div>
  );
}

/** Actes du sas non rattachés à un conseil (délibérations isolées ou archive) : importables un par un. */
function ActesIsoles({ o, lotId, detail, onDone }: { o: number; lotId: number; detail: any; onDone: () => void }) {
  const { toast } = useToast();
  const [voir, setVoir] = useState<any>(null);
  const items = detail.items as any[];
  const seanceKeys = new Set(items.filter((x) => x.kind === 'seance').map((s) => s.sourceKey));
  const actes = items.filter((x) => x.kind === 'acte' && (!x.payload.seance || !seanceKeys.has(String(x.payload.seance))));
  const agir = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); onDone(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (!actes.length) return null;
  return (
    <section className="space-y-3">
      <h3>Actes isolés (sans conseil rattaché)</h3>
      <div className="card overflow-x-auto">
        <table className="w-full"><thead><tr><th>Acte</th><th>Date</th><th>État</th><th /></tr></thead><tbody>{actes.map((x) => (
          <tr key={x.id}>
            <td><div className="font-semibold">{clamp(String(x.payload.titre ?? x.payload.objet ?? '(sans objet)'))}</div><div className="text-[11px] text-mute">{x.sourceKey} · {x.payload.numero ?? ''}</div></td>
            <td className="text-[12px]">{x.payload.date ? dt(x.payload.date, { dateStyle: 'medium' }) : '—'}</td>
            <td>{x.statut === 'publie' ? <Badge tone="ok">Importé</Badge> : x.statut === 'ignore' ? <Badge tone="gray">Ignoré</Badge> : x.problemes?.length ? <span className="text-[12px] text-ko">{x.problemes.map((p: any) => p.label).join(' · ')}</span> : <Badge tone="blue">Prêt</Badge>}</td>
            <td className="whitespace-nowrap text-right">
              <button className="btn-secondary mr-1 !px-2 !py-1 text-[12px]" onClick={() => setVoir(x)}><Eye className="h-3.5 w-3.5" /> Voir</button>
              {x.statut !== 'publie' && <button className="btn-primary mr-1 !px-2 !py-1 text-[12px]" disabled={!!x.problemes?.length} onClick={() => agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/actes/${x.id}/publier`), {}), 'Acte importé')}><Check className="h-3.5 w-3.5" /> Importer</button>}
              {x.statut !== 'publie' && <button className="rounded p-2 text-ko hover:bg-slate-100" title="Ignorer" aria-label="Ignorer" onClick={() => agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/actes/${x.id}/ignorer`), {}), 'Acte ignoré')}><XCircle className="h-4 w-4" /></button>}
            </td>
          </tr>))}</tbody></table>
        {voir && <VoirActe acte={voir} onClose={() => setVoir(null)} />}
      </div>
    </section>
  );
}

function Detail({ o, lotId, onRetour, onRechargeListe }: { o: number; lotId: number; onRetour: () => void; onRechargeListe: () => void }) {
  const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, `/import-airs/lots/${lotId}`))).data as any, [o, lotId]);
  const [charger, setCharger] = useState(false); const [mapping, setMapping] = useState(false); const [supprimer, setSupprimer] = useState(false);
  const recharger = () => { d.reload(); onRechargeListe(); };
  const agir = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); recharger(); } catch (e) { toast(errMsg(e), 'ko'); } };
  const [prog, setProg] = useState<any>(null); const [enCours, setEnCours] = useState(false);
  const lireProgression = async () => { try { setProg((await api.get(orgPath(o, `/import-airs/lots/${lotId}/progression`))).data); } catch { /* lot pas encore prêt */ } };
  useEffect(() => { lireProgression(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [o, lotId]);
  useEffect(() => {
    if (!enCours && !prog?.enCours) return;
    const t = setInterval(lireProgression, 800);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enCours, prog?.enCours, o, lotId]);
  const lancerAnalyse = async () => {
    setEnCours(true);
    try { await api.post(orgPath(o, `/import-airs/lots/${lotId}/analyser`), {}); toast('Lot analysé'); }
    catch (e) { toast(errMsg(e), 'ko'); }
    finally { setEnCours(false); setProg(null); recharger(); }
  };
  if (d.loading && !d.data) return <Loading progress={prog?.enCours ? prog : null} />;
  const lot = d.data.lot;
  const etapes = [
    { k: 'charger', label: '1. Charger le sas', fait: ['charge', 'concordances', 'analyse', 'pret', 'publie'].includes(lot.statut) },
    { k: 'analyser', label: '2. Analyser', fait: ['concordances', 'pret', 'publie'].includes(lot.statut) },
    { k: 'concordances', label: '3. Concordances', fait: d.data.blocage.bloquantesNonResolues === 0 && ['concordances', 'pret', 'publie'].includes(lot.statut) },
    { k: 'publier', label: '4. Importer', fait: lot.statut === 'publie' },
  ];
  return (
    <div className="space-y-4">
      <button className="btn-secondary" onClick={onRetour}><ChevronLeft className="h-4 w-4" /> Tous les lots</button>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1"><div className="text-[15px] font-bold text-head">{lot.label}</div><div className="text-[12px] text-mute">{lot.mode === 'passes' ? 'Séances passées' : 'Séances passées + actes en préparation'} · source {lot.sourceKind} · créé le {dt(lot.createdAt, { dateStyle: 'medium' })}</div></div>
        <Badge tone={(LOT[lot.statut] ?? LOT.brouillon).tone}>{(LOT[lot.statut] ?? LOT.brouillon).label}</Badge>
        <span className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={lot.statut === 'annule'} onClick={() => setCharger(true)}><Upload className="h-4 w-4" /> Charger</button>
          <button className="btn-secondary" disabled={enCours || prog?.enCours || !['charge', 'concordances', 'pret'].includes(lot.statut)} onClick={lancerAnalyse}><Play className="h-4 w-4" /> Analyser</button>
          <button className="btn-secondary" onClick={() => setMapping(true)}><Cog className="h-4 w-4" /> Mapping</button>
          <button className="btn-primary" disabled={!['concordances', 'pret'].includes(lot.statut) || d.data.blocage.bloquantesNonResolues > 0} onClick={() => agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/publier`), {}), 'Import traité')}><Check className="h-4 w-4" /> Importer tous les conseils</button>
          {(d.data.compteurs.publies > 0 || lot.statut !== 'annule') && <button className="btn-secondary text-ko" onClick={() => window.confirm('Annuler ce lot et retirer ses imports ?') && agir(() => api.post(orgPath(o, `/import-airs/lots/${lotId}/annuler`), {}), 'Lot annulé')}><Ban className="h-4 w-4" /> Annuler</button>}
          <button className="btn-secondary text-ko" onClick={() => setSupprimer(true)}><Trash2 className="h-4 w-4" /> Supprimer</button>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">{etapes.map((e) => <span key={e.k} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${e.fait ? 'bg-ok-bg text-ok-text' : 'bg-soft text-mute'}`}>{e.fait ? '✓ ' : ''}{e.label}</span>)}</div>

      <Progression p={prog ?? (enCours ? { enCours: true, phase: 'analyse', fait: 0, total: 0 } : null)} />

      <TablesSource o={o} onChanged={recharger} />

      <div className="grid gap-3 md:grid-cols-4">
        {[['Séances', d.data.compteurs.seances], ['Actes', d.data.compteurs.actes], ['Prêts à importer', d.data.compteurs.prets], ['Importés', d.data.compteurs.publies]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><div className="text-[12px] text-mute">{l}</div><div className="text-[24px] font-bold text-head">{v as number}</div></div>))}
      </div>

      <section className="space-y-3"><h3>Concordances</h3><Concordances o={o} lotId={lotId} conc={d.data.concordances} onDone={recharger} /></section>
      <section className="space-y-3"><h3>Conseils à importer</h3><Conseils o={o} lotId={lotId} detail={d.data} onDone={recharger} /></section>
      <ActesIsoles o={o} lotId={lotId} detail={d.data} onDone={recharger} />

      <section className="card p-4"><h3 className="mb-2">Journal du lot</h3>
        <table className="w-full"><tbody>{d.data.events.map((e: any, i: number) => <tr key={i}><td className="w-40 text-[12px] text-mute">{dt(e.at)}</td><td className="font-mono text-[12px]">{e.action}</td><td className="text-[12px]">{e.actor}</td></tr>)}</tbody></table>
      </section>

      {charger && <Charger o={o} lot={lot} onClose={() => setCharger(false)} onDone={() => { setCharger(false); recharger(); }} />}
      {mapping && <Mapping o={o} onClose={() => setMapping(false)} onDone={() => { setMapping(false); recharger(); }} />}
      {supprimer && <SupprimerLot o={o} lotId={lotId} onClose={() => setSupprimer(false)} onDone={() => { setSupprimer(false); onRechargeListe(); onRetour(); }} />}
      {node}
    </div>
  );
}

export default function AdminImportAirs() {
  const { org } = useAuth(); const o = org!.id;
  const liste = useLoad(async () => (await api.get(orgPath(o, '/import-airs'))).data as any, [o]);
  const [lotId, setLotId] = useState<number | null>(null);
  const [nouveau, setNouveau] = useState(false);
  if (lotId) return <Detail o={o} lotId={lotId} onRetour={() => setLotId(null)} onRechargeListe={liste.reload} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-mute">Reprise de l'historique <b>AIRS DELIB</b> en quatre temps : <b>validation des tables</b> (données + transposition, aucune table non contrôlée n'est importée), <b>sas</b> (données brutes, invisibles), <b>concordances</b> (rapprochement avec vos référentiels déjà paramétrés, validé par vous), puis <b>import</b> des conseils et de leurs actes. Les données sont lues dans la base Oracle d'origine (lecture seule) ; l'import <b>ne modifie jamais</b> le paramétrage de l'application.</p>
        <button className="btn-primary" onClick={() => setNouveau(true)}><Plus className="h-4 w-4" /> Nouveau lot</button>
      </div>
      <div className="card overflow-x-auto">
        {liste.loading && !liste.data ? <Loading /> : !liste.data?.items?.length ? <Empty>Aucun lot de reprise. Créez un lot, chargez l'export du HUB (ou le jeu d'essai) puis analysez-le.</Empty> : (
          <table className="w-full"><thead><tr><th>Lot</th><th>Périmètre</th><th>État</th><th>Actes</th><th>Importés</th><th /></tr></thead><tbody>{liste.data.items.map((l: any) => (
            <tr key={l.id} className="cursor-pointer hover:bg-soft" onClick={() => setLotId(l.id)}>
              <td><div className="font-semibold">{l.label}</div><div className="text-[11px] text-mute">{dt(l.createdAt, { dateStyle: 'medium' })}</div></td>
              <td className="text-[12px]">{l.mode === 'passes' ? 'Séances passées' : '+ préparation'}</td>
              <td><Badge tone={(LOT[l.statut] ?? LOT.brouillon).tone}>{(LOT[l.statut] ?? LOT.brouillon).label}</Badge></td>
              <td>{l.items.actes}</td>
              <td>{l.items.publies}</td>
              <td className="text-right">{l.statut === 'annule' ? <Ban className="ml-auto h-4 w-4 text-mute" /> : <FileJson className="ml-auto h-4 w-4 text-mute" />}</td>
            </tr>))}</tbody></table>)}
      </div>
      <p className="flex items-center gap-2 text-[12px] text-mute"><RefreshCw className="h-3.5 w-3.5" /> MCD AIRS documenté (voir <code>airs_mcd.md</code>) : le mapping <code>seances</code> / <code>actes</code> est pré-renseigné et reste ajustable dans <b>Mapping</b>.</p>
      {nouveau && <NouveauLot o={o} onClose={() => setNouveau(false)} onDone={(lot) => { setNouveau(false); liste.reload(); setLotId(lot.id); }} />}
    </div>
  );
}
