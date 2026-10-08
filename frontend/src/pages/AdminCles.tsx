import { useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, ErrorBox, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';

const LIB: Record<string, { titre: string; tone: 'ok' | 'blue' | 'warn' }> = {
  'actes:executoires': { titre: 'Actes exécutoires', tone: 'ok' }, 'actes:adoptes': { titre: 'Actes adoptés', tone: 'blue' }, 'actes:encours': { titre: 'Actes en cours', tone: 'warn' },
};

/** Affiche la clé UNE SEULE FOIS, avec un exemple d'appel. */
function CleCreee({ cle, onClose }: { cle: string; onClose: () => void }) {
  const [copie, setCopie] = useState(false);
  const url = `${window.location.origin}/api/v1/externe/actes?categorie=executoires`;
  return (
    <Modal title="Clé d’API créée" onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded bg-warn-bg px-3 py-2 text-[13px] text-warn"><b>Copiez cette clé maintenant :</b> elle ne sera plus jamais affichée (seule son empreinte est conservée). Conservez-la comme un mot de passe et ne la placez jamais dans une page web ou une application mobile.</p>
        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-soft px-3 py-2 font-mono text-[13px]">{cle}</code>
          <button className="btn-secondary" onClick={async () => { await navigator.clipboard?.writeText(cle); setCopie(true); }}><Copy className="h-4 w-4" /> {copie ? 'Copiée' : 'Copier'}</button></div>
        <div><span className="label">Exemple d’appel (de serveur à serveur)</span>
          <pre className="overflow-x-auto rounded bg-soft p-3 text-[12px]">{`curl -H "Authorization: Bearer ${cle}" \\\n     "${url}"`}</pre></div>
        <div className="flex justify-end"><button className="btn-primary" onClick={onClose}>J’ai copié la clé</button></div>
      </div>
    </Modal>
  );
}

function FormCle({ portees, contenus, types, dureeMax, cle, onClose, onSaved }: { portees: { code: string; description: string }[]; contenus: { code: string; description: string }[]; types: { code: string; libelle: string }[]; dureeMax: number; cle: any | null; onClose: () => void; onSaved: (creee?: string) => void }) {
  const { org } = useAuth(); const o = org!.id;
  const [f, setF] = useState<any>({ nom: cle?.nom ?? '', portees: cle?.portees ?? ['actes:executoires'], ips: (cle?.ips ?? []).join('\n'), limiteMinute: cle?.limiteMinute ?? 120, expireLe: cle?.expireLe?.slice(0, 10) ?? '', types: cle?.types ?? [], dureeMois: cle?.dureeMois ?? dureeMax, contenus: cle?.contenus ?? { acte: true, expose: true, annexes: true } });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const enregistrer = async () => {
    setBusy(true); setErr(null);
    const corps = { nom: f.nom, portees: f.portees, ips: String(f.ips).split(/[\s,;]+/).filter(Boolean), limiteMinute: Number(f.limiteMinute) || 120, expireLe: f.expireLe ? new Date(`${f.expireLe}T23:59:59`).toISOString() : null, types: f.types, dureeMois: Math.min(dureeMax, Math.max(1, Number(f.dureeMois) || dureeMax)), contenus: f.contenus };
    try {
      if (cle) { await api.put(orgPath(o, `/cles-api/${cle.id}`), corps); onSaved(); } else onSaved((await api.post(orgPath(o, '/cles-api'), corps)).data.cle);
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={cle ? `Clé « ${cle.nom} »` : 'Nouvelle clé d’API'} onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox msg={err} />
        <Field label="Application cliente *" hint="Ex. « Site de la Ville », « Portail des délibérations »."><input className="input" autoFocus value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
        <fieldset className="space-y-2 rounded border border-line p-3"><legend className="px-1 text-[12px] font-semibold uppercase text-mute">Droits *</legend>
          {portees.map((p) => (
            <label key={p.code} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.portees.includes(p.code)} onChange={(e) => setF({ ...f, portees: e.target.checked ? [...f.portees, p.code] : f.portees.filter((x: string) => x !== p.code) })} />
              <span><b>{LIB[p.code]?.titre ?? p.code}</b><span className="block text-[12px] text-mute">{p.description}</span></span></label>))}
          <p className="text-[12px] text-mute">Les actes confidentiels ou à huis clos, abandonnés, retirés, rejetés ou ajournés ne sont jamais accessibles par l’API, quels que soient les droits.</p>
        </fieldset>
        <fieldset className="space-y-2 rounded border border-line p-3"><legend className="px-1 text-[12px] font-semibold uppercase text-mute">Périmètre des actes</legend>
          <Field label="Durée visible" hint={`Les actes dont le conseil (à défaut, la création) date de moins de cette durée. ${dureeMax} mois (2 ans) au plus.`}>
            <select className="input w-auto" value={f.dureeMois} onChange={(e) => setF({ ...f, dureeMois: Number(e.target.value) })}>{Array.from({ length: dureeMax }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m === 12 ? '1 an' : m === 24 ? '2 ans' : `${m} mois`}</option>)}</select></Field>
          <div><span className="label">Types d’actes</span><p className="mb-1 text-[12px] text-mute">Aucun coché : tous les types.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">{types.map((t) => (
              <label key={t.code} className="flex items-center gap-2"><input type="checkbox" checked={f.types.includes(t.code)} onChange={(e) => setF({ ...f, types: e.target.checked ? [...f.types, t.code] : f.types.filter((x: string) => x !== t.code) })} />{t.libelle}</label>))}</div></div>
          <div><span className="label">Contenus téléchargeables *</span>
            {contenus.map((c) => (
              <label key={c.code} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!!f.contenus[c.code]} onChange={(e) => setF({ ...f, contenus: { ...f.contenus, [c.code]: e.target.checked } })} /><span>{c.description}</span></label>))}</div>
        </fieldset>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Limite d’appels par minute"><input className="input" type="number" min={1} max={6000} value={f.limiteMinute} onChange={(e) => setF({ ...f, limiteMinute: e.target.value })} /></Field>
          <Field label="Expire le" hint="Vide : sans expiration."><input className="input" type="date" value={f.expireLe} onChange={(e) => setF({ ...f, expireLe: e.target.value })} /></Field>
        </div>
        <Field label="Adresses IP autorisées" hint="Une par ligne : adresse (10.1.2.3) ou réseau (10.1.2.0/24). Vide : toutes."><textarea className="input h-20 font-mono text-[12px]" value={f.ips} onChange={(e) => setF({ ...f, ips: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || f.nom.trim().length < 2 || !f.portees.length || !Object.values(f.contenus).some(Boolean)} onClick={enregistrer}>{busy && <Spinner />} {cle ? 'Enregistrer' : 'Créer la clé'}</button></div>
      </div>
    </Modal>
  );
}

/** Clés d'API des applications externes (EXT-01 à EXT-06) : lecture seule des actes, droits distinguant exécutoires / adoptés / en cours. */
export default function AdminCles() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const d = useLoad(async () => (await api.get(orgPath(o, '/cles-api'))).data, [o]);
  const [edit, setEdit] = useState<any | 'nouvelle' | null>(null); const [creee, setCreee] = useState<string | null>(null);
  const agir = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); toast(ok); d.reload(); return r; } catch (e) { toast(errMsg(e), 'ko'); } };
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <ErrorBox msg={d.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-mute">Permettez à une autre application (le <b>site de la Ville</b>, un portail, une GED…) de <b>récupérer les actes</b>, notamment ceux <b>revenus du contrôle de légalité</b>. Chaque clé a ses droits : <b>exécutoires</b> (texte, PDF, annexes publiables), <b>adoptés</b>, ou <b>en cours de rédaction</b> (métadonnées seulement). Pour chaque clé, réglez le <b>périmètre</b> : types d’actes, durée (2 ans au plus) et contenus (acte seul, exposé des motifs, annexes). Documentation : <a className="text-action underline" href="/api-docs" target="_blank" rel="noreferrer">Swagger</a>, section « API externe » ; publiée en DMZ sur <code>/api-docs/</code> de l’espace des élus.</p>
        <button className="btn-primary" onClick={() => setEdit('nouvelle')}><Plus className="h-4 w-4" /> Nouvelle clé</button>
      </div>
      <div className="card overflow-x-auto">
        {!d.data.items.length ? <p className="p-8 text-center text-mute">Aucune clé d’API.</p> : (
          <table className="w-full"><thead><tr><th>Application</th><th>Clé</th><th>Droits</th><th>Périmètre</th><th>Limites</th><th>Usage</th><th>État</th><th /></tr></thead><tbody>
            {d.data.items.map((k: any) => (
              <tr key={k.id} className={k.actif ? '' : 'opacity-60'}>
                <td className="font-semibold">{k.nom}<div className="text-[11px] font-normal text-mute">créée le {dt(k.creeLe, { dateStyle: 'short' })} par {k.creePar}</div></td>
                <td className="font-mono text-[12px]"><KeyRound className="mr-1 inline h-3.5 w-3.5 text-mute" />{k.prefixe}</td>
                <td className="space-x-1">{k.portees.map((p: string) => <Badge key={p} tone={LIB[p]?.tone}>{LIB[p]?.titre ?? p}</Badge>)}</td>
                <td className="text-[12px]">{k.dureeMois === 24 ? '2 ans' : k.dureeMois === 12 ? '1 an' : `${k.dureeMois} mois`} · {k.types.length ? k.types.join(', ') : 'tous types'}<div className="text-mute">{['acte', 'expose', 'annexes'].filter((c) => k.contenus?.[c]).map((c) => ({ acte: 'acte', expose: 'exposé', annexes: 'annexes' } as Record<string, string>)[c]).join(' + ')}</div></td>
                <td className="text-[12px]">{k.limiteMinute}/min{k.ips.length ? ` · ${k.ips.length} IP` : ' · toutes IP'}{k.expireLe ? ` · jusqu’au ${dt(k.expireLe, { dateStyle: 'short' })}` : ''}</td>
                <td className="text-[12px]">{k.nbAppels.toLocaleString('fr-FR')} appel(s){k.dernierUsage ? <div className="text-mute">dernier : {dt(k.dernierUsage, { dateStyle: 'short', timeStyle: 'short' })}</div> : ''}</td>
                <td>{k.revoquee ? <Badge tone="ko">Révoquée</Badge> : k.actif ? <Badge tone="ok">Active</Badge> : <Badge>Inactive / expirée</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  {!k.revoquee && <>
                    <button className="rounded px-2 py-1 text-[12px] font-semibold text-action hover:bg-slate-100" onClick={() => setEdit(k)}>Modifier</button>
                    <button className="rounded p-2 hover:bg-slate-100" title="Renouveler (nouvelle clé, l’ancienne est révoquée)" aria-label={`Renouveler ${k.nom}`} onClick={async () => { if (!window.confirm(`Renouveler la clé de « ${k.nom} » ? L’ancienne sera révoquée tout de suite : l’application cliente devra recevoir la nouvelle.`)) return; const r = await agir(() => api.post(orgPath(o, `/cles-api/${k.id}/renouvellement`), {}), 'Clé renouvelée'); if (r) setCreee(r.data.cle); }}><RefreshCw className="h-4 w-4" /></button>
                    <button className="rounded p-2 text-ko hover:bg-slate-100" title="Révoquer" aria-label={`Révoquer ${k.nom}`} onClick={() => window.confirm(`Révoquer la clé de « ${k.nom} » ? C’est immédiat et irréversible.`) && agir(() => api.delete(orgPath(o, `/cles-api/${k.id}`)), 'Clé révoquée')}><Trash2 className="h-4 w-4" /></button></>}
                </td>
              </tr>))}
          </tbody></table>)}
      </div>
      <p className="text-[12px] text-mute">Une clé n’est valable que pour <b>votre organisme</b>. Elle sert de serveur à serveur : ne la placez jamais dans une page web (elle deviendrait publique). Toute création, modification et révocation est journalisée.</p>
      {edit && <FormCle portees={d.data.portees} contenus={d.data.contenus} types={d.data.types} dureeMax={d.data.dureeMax} cle={edit === 'nouvelle' ? null : edit} onClose={() => setEdit(null)} onSaved={(c) => { setEdit(null); d.reload(); if (c) setCreee(c); else toast('Clé modifiée'); }} />}
      {creee && <CleCreee cle={creee} onClose={() => setCreee(null)} />}
      {node}
    </div>
  );
}
