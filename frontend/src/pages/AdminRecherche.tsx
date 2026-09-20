import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { Badge, Loading, Spinner, useLoad, useToast } from '../ui';

/** Recherche plein texte (REC-09, REC-12, REC-27) : état de l'index, ré-indexation, synonymes, requêtes sans résultat. */
export default function AdminRecherche() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const etat = useLoad(async () => (await api.get(orgPath(o, '/recherche/etat'))).data, [o]);
  const [syn, setSyn] = useState<string | null>(null);
  useEffect(() => { if (etat.data && syn === null) setSyn(etat.data.synonymes || ''); }, [etat.data]);
  const enCours = !!etat.data?.reindexation?.enCours;
  // pendant une ré-indexation, l'avancement est relu toutes les 2 s
  useEffect(() => { if (!enCours) return; const t = setInterval(() => etat.reload(), 2000); return () => clearInterval(t); }, [enCours]);

  const reindexer = async () => {
    if (!window.confirm('Reconstruire tout l’index de recherche ? Les recherches restent possibles pendant l’opération.')) return;
    try { const r = await api.post(orgPath(o, '/recherche/reindexation')); toast(r.data.demarre ? `Ré-indexation lancée (${r.data.total} actes)` : r.data.message); etat.reload(); } catch (e) { toast(errMsg(e), 'ko'); }
  };
  const enregistrerSyn = async () => {
    try { await api.put(orgPath(o, '/settings/recherche.synonymes'), { value: syn ?? '', scope: 'organisme' }); toast('Synonymes enregistrés'); } catch (e) { toast(errMsg(e), 'ko'); }
  };

  if (etat.loading && !etat.data) return <Loading />;
  const e = etat.data; if (!e) return <p className="text-ko">{etat.error}</p>;
  const r = e.reindexation;
  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2>Index de recherche</h2><p className="text-mute">PostgreSQL (français, sans accent) — mis à jour à chaque texte validé, annexe ajoutée ou décision de séance, et rattrapé périodiquement par le planificateur.</p></div>
          <button className="btn-secondary" onClick={reindexer} disabled={enCours}>{enCours ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Ré-indexer tout</button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[['Actes', e.actes], ['Indexés', e.indexes], ['En retard', e.enRetard], ['Annexes lues', e.annexesLues], ['Annexes sans texte', e.annexesSansTexte]].map(([l, v]) => (
            <div key={String(l)} className="rounded bg-soft p-3"><dt className="text-[11px] uppercase tracking-wide text-mute">{l}</dt><dd className="text-[20px] font-bold">{v}</dd></div>))}
        </dl>
        {r && <p className="mt-3 text-[13px]">{r.enCours ? <>Ré-indexation en cours : <b>{r.traites}</b> / {r.total} actes…</> : r.erreur ? <Badge tone="ko">Erreur : {r.erreur}</Badge> : <Badge tone="ok">Dernière ré-indexation terminée : {r.traites} actes</Badge>}</p>}
        {e.annexesSansTexte > 0 && <p className="mt-2 text-[12px] text-mute">Une annexe « sans texte » est un PDF scanné (image) : son contenu n’est pas cherchable. L’OCR est prévu en option.</p>}
      </section>

      <section className="card p-5">
        <h2>Synonymes</h2>
        <p className="mb-2 text-mute">Une ligne par groupe de termes équivalents, séparés par des virgules. Exemple : <code>école, établissement scolaire, groupe scolaire</code>. Chercher l’un trouve les autres (un mot seul, ou une expression saisie entre guillemets).</p>
        <textarea className="input h-28 font-mono text-[13px]" value={syn ?? ''} onChange={(ev) => setSyn(ev.target.value)} placeholder={'école, établissement scolaire\nvoirie, chaussée, trottoir'} />
        <div className="mt-2 flex justify-end"><button className="btn-primary" onClick={enregistrerSyn}>Enregistrer</button></div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {[['Requêtes les plus fréquentes (90 jours)', e.frequentes, true], ['Requêtes sans résultat — à traiter par un synonyme ou une saisie manquante', e.sansResultat, false]].map(([titre, rows, avecMoyenne]: any) => (
          <div key={titre} className="card p-5">
            <h3 className="mb-2">{titre}</h3>
            {!rows.length ? <p className="text-mute">Rien pour l’instant.</p> : (
              <table className="w-full"><tbody>{rows.map((x: any) => <tr key={x.requete}><td className="font-mono text-[12px]">{x.requete}</td><td className="text-right text-[12px] text-mute">{x.n} fois{avecMoyenne ? ` · ~${x.moyenne} rés.` : ''}</td></tr>)}</tbody></table>)}
          </div>))}
      </section>
      <p className="text-[12px] text-mute">Le journal ne conserve ni le nom ni l’identifiant de la personne : seulement la requête et le nombre de résultats.</p>
      {node}
    </div>
  );
}
