import { useState } from 'react';
import { BookMarked, ChevronDown, Plus } from 'lucide-react';
import { api, org as orgPath } from './api';
import { useAuth } from './auth';
import { Loading, useLoad } from './ui';
import { d } from './format';

type Item = {
  texte: string; occurrences: number; etat: string; cle: string | null;
  libelle: string | null; intitule: string | null; verifieLe: string | null;
};

/** Libellé et couleurs de la pastille de vérification, selon l'état renvoyé par le serveur. */
const PASTILLE: Record<string, { label: string; cls: string }> = {
  a_jour: { label: 'Vérifié', cls: 'bg-ok-bg text-ok-text border-ok/30' },
  a_revoir: { label: 'À revoir', cls: 'bg-warn-bg text-warn border-warn/30' },
  a_verifier: { label: 'À faire vérifier', cls: 'bg-slate-100 text-slate-700 border-slate-300/70' },
  obsolete: { label: 'Obsolète', cls: 'bg-ko-bg text-ko border-ko/30' },
  sans_reference: { label: 'Sans référence', cls: 'bg-slate-100 text-slate-600 border-slate-300/70' },
};
const INFO: Record<string, string> = {
  a_jour: 'Texte présent dans la bibliothèque de visas, en vigueur et vérifié récemment.',
  a_revoir: 'Texte modifié, pas encore en vigueur, ou vérification ancienne : à recontrôler.',
  a_verifier: "Ce texte ne figure pas dans la bibliothèque de visas : à faire vérifier par le juridique (existence, article, actualité).",
  obsolete: 'Texte abrogé ou hors de sa période de validité : à remplacer ou retirer.',
  sans_reference: 'Considérant sans référence juridique à vérifier (texte de motivation).',
};

/**
 * « Bibliothèque » des vus et considérants les plus utilisés de la collectivité (délibérations adoptées),
 * avec une pastille de vérification rapprochant chaque ligne de la bibliothèque de visas. Un clic insère la ligne.
 */
export default function BibliothequeVisas({ acteId, peutInserer, onInserer, toast }: {
  acteId: number; peutInserer: boolean; onInserer: (texte: string) => void; toast: (m: string, k?: 'ok' | 'ko') => void;
}) {
  const { org } = useAuth(); const o = org!.id;
  const l = useLoad(async () => (await api.get(orgPath(o, `/actes/${acteId}/visas/usuels`))).data, [o, acteId]);
  const [ouvert, setOuvert] = useState(true);
  const items: Item[] = l.data?.items ?? [];
  const entete = l.data?.bibliotheque;

  return (
    <section className="shrink-0 border-b border-line" aria-label="Bibliothèque de vus et considérants">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-soft" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert}>
        <BookMarked className="h-4 w-4 shrink-0 text-action" />
        <span className="min-w-0 flex-1 text-[13px] font-semibold">Bibliothèque de vus et considérants</span>
        {items.length > 0 && <span className="rounded-full bg-action/10 px-2 py-0.5 text-[11px] font-semibold text-action">{items.length}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 text-mute transition-transform motion-reduce:transition-none ${ouvert ? 'rotate-180' : ''}`} />
      </button>
      {ouvert && (
        <div className="max-h-64 overflow-auto border-t border-line">
          {l.loading ? <Loading /> : l.error ? <p className="p-4 text-[12px] text-ko">{l.error}</p> : !items.length ? (
            <p className="p-4 text-[12px] text-mute">Aucun vus et considérant dans les délibérations adoptées pour l'instant.</p>
          ) : (
            <>
              {entete && <p className="border-b border-line px-4 py-1.5 text-[11px] text-mute">Le plus fréquent d'abord — {entete.entrees} texte(s) au référentiel de visas{entete.entrees === 0 ? ' (à alimenter par le juridique)' : ''}.</p>}
              <ul>
                {items.map((it, i) => {
                  const p = PASTILLE[it.etat] ?? PASTILLE.sans_reference;
                  return (
                    <li key={i} className="border-b border-line px-4 py-2 last:border-0">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink" title={it.texte}>{it.texte}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${p.cls}`} title={`${INFO[it.etat] ?? ''}${it.verifieLe ? ` Dernière vérification : ${d(it.verifieLe)}.` : ''}`}>{p.label}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
                        <span>utilisé {it.occurrences}×</span>
                        {it.intitule && it.cle && <span className="min-w-0 truncate">· {it.intitule}</span>}
                        {peutInserer && <button type="button" className="ml-auto flex shrink-0 items-center gap-1 font-semibold text-action hover:underline" onClick={() => { onInserer(it.texte); toast('Visa inséré dans le texte'); }}><Plus className="h-3.5 w-3.5" /> Insérer</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
