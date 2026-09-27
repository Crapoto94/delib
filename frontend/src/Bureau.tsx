import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api, errMsg, org as orgPath } from './api';
import { useAuth } from './auth';
import { Spinner } from './ui';

/**
 * Bureau en ligne — édition d'une annexe Word / Excel / présentation dans le navigateur (D39).
 *
 * Rien à installer sur le poste : le moteur de documents est un service du serveur, et l'agent travaille dans cette
 * fenêtre. Chaque enregistrement remonte au backend, qui en fait une version de l'annexe, régénère le PDF du dossier et
 * réindexe la recherche. Fermer la fenêtre ne perd donc rien : c'est volontairement l'inverse du traitement de texte
 * classique où il faut « enregistrer puis fermer ».
 *
 * L'interface ne parle JAMAIS directement au moteur : le backend lui renvoie soit le SDK d'ONLYOFFICE (un script + une
 * configuration signée), soit l'adresse d'une iframe Collabora. Aucune URL, aucun secret dans le code du front.
 *
 * Les deux moteurs n'ont pas la même notion de « sauvegarder maintenant » : ONLYOFFICE accepte une commande du serveur,
 * Collabora enregistre à intervalle régulier et **à la fermeture de la session**. « Sauvegarder et fermer » ferme donc la
 * fenêtre d'édition avant de demander la version au backend (voir `fermer`).
 */

type Capa = { enabled: boolean; formats: string[]; moteur?: string; moteurs?: string[]; raison?: string };

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
  const moteur = useRef<string>('');          // 'onlyoffice' ou 'collabora' : la fermeture ne se fait pas de la même façon
  const modifie = useRef(false);             // au moins une modification depuis l'ouverture
  const fermeApres = useRef(false);          // l'agent a demandé « Sauvegarder et fermer »
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'enregistrement' | 'pret' | 'enregistre'>('chargement');
  const { org } = useAuth();
  const o = org!.id;
  // `fermer` est défini plus bas : les messages reçus de Collabora y accèdent par cette référence.
  const fermerRef = useRef<(() => void) | null>(null);

  /** Retire la fenêtre d'édition : c'est ce qui, chez Collabora, fait écrire le document par le moteur. */
  const terminer = () => {
    try { editeur.current?.destroyEditor(); } catch { /* déjà détruit */ }
    editeur.current = null;
    if (zone.current) zone.current.replaceChildren();
  };

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        // 1. le backend prépare la session d'édition et renvoie soit la configuration signée (ONLYOFFICE), soit
        //    l'adresse de l'iframe (Collabora)
        const r = await api.post(orgPath(o, `/actes/${acteId}/annexes/${annexe.id}/ouvrir`), {});
        if (!vivant) return;
        cle.current = r.data.cle;
        moteur.current = String(r.data.moteur || 'onlyoffice');
        if (!zone.current) return;
        if (r.data.src) {
          // ---- Collabora : une iframe. Elle REMPLACE elle aussi le contenu de la zone, et sa fin de session est ce
          // qui déclenche l'enregistrement : on la supprime au moment de fermer (voir `fermer`), pas après.
          const cadre = document.createElement('iframe');
          cadre.id = `bureau-${Math.random().toString(36).slice(2)}`;
          cadre.src = r.data.src;
          cadre.title = `Édition de ${annexe.titre || annexe.fichier?.nom}`;
          cadre.style.width = '100%'; cadre.style.height = '100%'; cadre.style.border = '0';
          cadre.allow = 'clipboard-read; clipboard-write';
          zone.current.appendChild(cadre);
          // L'éditeur peut nous demander de fermer (Cmd/Ctrl+W) : c'est une fermeture « sauvegarder et fermer ».
          // On n'écoute que l'origine du cadre que nous venons de créer : en production elle est la nôtre (le frontal
          // relaie le moteur sous le même nom d'hôte), mais en développement le moteur est joint par son port publié
          // et n'est donc pas de la même origine qu'un http://localhost:5160.
          const origine = (() => { try { return new URL(r.data.src, window.location.origin).origin; } catch { return ''; } })();
          const ecouteur = (e: MessageEvent) => {
            if (e.origin !== origine) return;         // seul le moteur que nous avons chargé nous parle
            if (e.data?.MessageId === 'App_Close') fermerRef.current?.();
            if (e.data?.MessageId === 'App_Error') setErreur("Le module d'édition a rencontré une erreur.");
          };
          window.addEventListener('message', ecouteur);
          setEtat('pret');
          return () => window.removeEventListener('message', ecouteur);
        }
        // 2. ONLYOFFICE : le SDK du moteur (servi sur sa propre origine)
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

  /** Parle à l'iframe Collabora : elle est de même origine (le relais sert le moteur sous notre origine). */
  const posterCollabora = (message: Record<string, unknown>) => {
    const cadre = zone.current?.querySelector('iframe');
    try { cadre?.contentWindow?.postMessage(message, '*'); } catch { /* cadre déjà retiré */ }
  };

  /**
   * « Sauvegarder et fermer ».
   *  - ONLYOFFICE : la commande part du serveur, qui attend la version réellement créée (voir `POST …/enregistrer`).
   *    Fermer l'onglet ensuite n'annule rien.
   *  - Collabora : il n'y a pas de commande d'enregistrement côté serveur — c'est l'ÉDITEUR qui enregistre, sur le
   *    message `Action_Save`, et l'écriture remonte par WOPI. On arme donc l'attente du backend AVANT de demander
   *    l'enregistrement : dans l'autre ordre, la version arriverait avant que quiconque l'attende, et il faudrait
   *    patienter le délai complet pour rien — d'où la lenteur ressentie.
   */
  const fermer = () => {
    if (fermeApres.current) return;                        // clic déjà pris en compte
    if (!cle.current) { onEnregistre(); onClose(); return; }
    fermeApres.current = true;
    setEtat('enregistrement');
    const enregistrement = api.post(orgPath(o, `/actes/${acteId}/annexes/${annexe.id}/enregistrer`), { cle: cle.current });
    if (moteur.current === 'collabora') posterCollabora({ MessageId: 'Action_Save', Values: { DontTerminateEdit: true, Notify: true } });
    enregistrement
      .then((r) => { if (r.data && r.data.enregistre === false && r.data.raison) avertir(r.data.raison); })
      .catch((e) => avertir(errMsg(e)))
      .finally(() => {
        if (moteur.current === 'collabora') {
          // Fin de session explicite (le moteur reçoit « closedocument ») : plus sûr que de retirer le cadre sans un
          // mot. On lui laisse un court instant pour partir avant de démonter l'iframe.
          posterCollabora({ MessageId: 'Close_Session' });
          setTimeout(terminer, 400);
        }
        onEnregistre();
        onClose();
        // Le moteur peut encore assembler une dernière version après la fermeture (session close) : on redemande la
        // liste une fois plus tard, sinon la page de l'acte resterait sur la version précédente.
        setTimeout(onEnregistre, 5000);
      });
  };
  fermerRef.current = fermer;   // Collabora peut demander la fermeture (Cmd/Ctrl+W) : il passe par ici.

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
      </div>
      {erreur && <div className="border-b border-ko/30 bg-ko-bg px-4 py-2 text-[13px] text-ko" role="alert">{erreur}</div>}
      <div ref={zone} className="min-h-0 flex-1" />
    </div>
  );
}
