import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { Spinner } from './ui';

/**
 * Bureau en ligne — édition d'une annexe Word / Excel dans le navigateur (D39).
 *
 * Rien à installer sur le poste : le moteur de documents est un service du serveur, et l'agent travaille dans cette
 * fenêtre. Chaque enregistrement (Ctrl+S ou bouton de l'éditeur) remonte au backend, qui en fait une version de
 * l'annexe, régénère le PDF du dossier et réindexe la recherche. Fermer la fenêtre ne perd donc rien : c'est
 * voluntarily l'inverse du traitement de texte classique où il faut « enregistrer puis fermer ».
 *
 * L'interface ne parle JAMAIS directement au moteur : elle charge le SDK (servi par le frontal, sous /office/) et lui
 * passe la configuration signée préparée par le backend. Aucune URL, aucun secret dans le code du front.
 */

type Capa = { enabled: boolean; formats: string[]; raison?: string };

/** Le SDK du moteur est un script unique : on ne l'injecte qu'une fois par session du navigateur. */
let sdkCharge: Promise<void> | null = null;
const chargeSdk = (url: string) => {
  if (sdkCharge) return sdkCharge;
  sdkCharge = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { sdkCharge = null; reject(new Error("Le module d'édition est injoignable (le service est-il démarré ?)")); };
    document.head.appendChild(s);
  });
  return sdkCharge;
};

/** Ce que le moteur sait faire, pour n'afficher le bouton que là où il sert (et l'expliquer sinon). */
export function useBureau(organismeId: number) {
  const [capa, setCapa] = useState<Capa | null>(null);
  useEffect(() => {
    let vivant = true;
    api.get(orgPath(organismeId, '/bureau')).then((r) => { if (vivant) setCapa(r.data); }).catch(() => { if (vivant) setCapa({ enabled: false, formats: [], raison: 'Édition en ligne indisponible' }); });
    return () => { vivant = false; };
  }, [organismeId]);
  return capa;
}

export function peutEditer(capa: Capa | null, annexe: any) {
  if (!capa?.enabled) return false;
  const ext = String(annexe?.fichier?.nom || '').split('.').pop()?.toLowerCase() || '';
  return !!ext && capa.formats.includes(ext) && ext !== 'pdf';
}

export default function Bureau({ acteId, annexe, onClose, onEnregistre, avertir }: {
  acteId: number; annexe: any; onClose: () => void; onEnregistre: () => void; avertir: (m: string) => void;
}) {
  const zone = useRef<HTMLDivElement>(null);
  const editeur = useRef<any>(null);
  const cle = useRef<string | null>(null);   // clé de session remise par le backend à l'ouverture
  const modifie = useRef(false);             // au moins une modification depuis l'ouverture
  const fermeApres = useRef(false);          // l'agent a demandé « Sauvegarder et fermer »
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'enregistrement' | 'pret' | 'enregistre'>('chargement');
  const { org } = useAuth();
  const o = org!.id;

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        // 1. le backend prépare la session d'édition et renvoie la configuration signée
        const r = await api.post(orgPath(o, `/actes/${acteId}/annexes/${annexe.id}/ouvrir`), {});
        if (!vivant) return;
        cle.current = r.data.cle;
        // 2. le SDK du moteur (servi sur sa propre origine)
        await chargeSdk(r.data.sdk);
        if (!vivant || !zone.current) return;
        // 3. l'éditeur prend la main. Le SDK REMPLACE l'élément qu'on lui donne : on lui confie donc un enfant créé
        //    ici, que React ne connaît pas. S'il remplaçait l'élément rendu par React, le rendu suivant (le simple
        //    changement d'état « Prêt ») chercherait un nœud qui n'est plus là et ferait tomber toute la page.
        const hote = document.createElement('div');
        hote.id = `bureau-${Math.random().toString(36).slice(2)}`;
        hote.style.width = '100%'; hote.style.height = '100%';
        zone.current.appendChild(hote);
        const DocsAPI = (window as any).DocsAPI;
        editeur.current = new DocsAPI.DocEditor(hote.id, {
          ...r.data.config,
          events: {
            // `data = true` : modifications non enregistrées ; `data = false` : tout est enregistré côté moteur.
            onDocumentStateChange: (e: any) => {
              if (e?.data) { modifie.current = true; setEtat('pret'); }
              else if (modifie.current) setEtat('enregistre');
            },
            onError: (e: any) => { setErreur(e?.data?.message || "Le module d'édition a rencontré une erreur."); },
            onRequestClose: () => { fermer(); },
          },
        });
        setEtat('pret');
      } catch (e) { if (vivant) setErreur(errMsg(e)); }
    })();
    // Le moteur tient sa propre session : on détruit l'éditeur en sortant, sinon la page consomme un emplacement.
    return () => {
      vivant = false;
      try { editeur.current?.destroyEditor(); } catch { /* déjà détruit */ }
      editeur.current = null;
      if (zone.current) zone.current.replaceChildren();   // on repart d'une zone vide (le SDK y a mis son iframe)
    };
  }, [acteId, annexe.id]);

  /**
   * « Sauvegarder et fermer ». En mode strict (ONLYOFFICE sans enregistrement automatique), les modifications de
   * l'agent ne sont intégrées au document QUE lorsqu'un enregistrement est déclenché dans l'éditeur : c'est donc lui
   * qui enregistre, et le backend attend ensuite la version réellement créée (voir `POST …/enregistrer`). Sans cela,
   * fermer l'onglet perdrait les dernières frappes — c'était le défaut d'un simple « Fermer ».
   */
  const fermer = () => {
    if (fermeApres.current) return;                        // clic déjà pris en compte
    if (!cle.current) { onEnregistre(); onClose(); return; }
    fermeApres.current = true;
    setEtat('enregistrement');
    api.post(orgPath(o, `/actes/${acteId}/annexes/${annexe.id}/enregistrer`), { cle: cle.current })
      .then((r) => { if (r.data && r.data.enregistre === false && r.data.raison) avertir(r.data.raison); })
      .catch((e) => avertir(errMsg(e)))
      .finally(() => {
        onEnregistre();
        onClose();
        // Le moteur peut encore assembler une dernière version après la fermeture (session close) : on redemande la
        // liste une fois plus tard, sinon la page de l'acte resterait sur la version précédente.
        setTimeout(onEnregistre, 5000);
      });
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={`Édition de ${annexe.titre}`}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <strong className="min-w-0 truncate">{annexe.titre || annexe.fichier?.nom}</strong>
        <span className="text-[12px] text-mute">v{annexe.version} · chaque enregistrement est conservé</span>
        <span className="ml-auto flex items-center gap-1 text-[12px]" role="status" aria-live="polite">
          {etat === 'chargement' ? <><Spinner /> Ouverture…</>
          : etat === 'enregistrement' ? <><Spinner /> Enregistrement…</>
          : etat === 'enregistre' ? <span className="flex items-center gap-1 text-ok"><CheckCircle2 className="h-4 w-4" /> Enregistré (version suivante créée)</span>
            : <span className="text-mute">Prêt</span>}
        </span>
        <button className="btn-primary" onClick={fermer} aria-label="Sauvegarder l'annexe et fermer l'éditeur">Sauvegarder et fermer</button>
        <button className="text-mute hover:text-ink" onClick={fermer} aria-label="Sauvegarder et fermer"><X className="h-5 w-5" /></button>
      </div>
      {erreur && <div className="border-b border-ko/30 bg-ko-bg px-4 py-2 text-[13px] text-ko" role="alert">{erreur}</div>}
      <div ref={zone} className="min-h-0 flex-1" />
    </div>
  );
}
