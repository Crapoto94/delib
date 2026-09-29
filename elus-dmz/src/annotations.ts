import { api, enLigne } from './api';

/**
 * Annotations hors ligne (ELU-71 à ELU-75, complément terrain).
 * Sur tablette, l'élu annote pendant la séance, souvent sans réseau. Les annotations sont donc écrites D'ABORD
 * sur l'appareil, puis transmises au serveur dès que le réseau revient :
 *  - chaque document garde sa liste locale (les annotations créées hors ligne ont un identifiant négatif) ;
 *  - les créations / modifications / suppressions / réponses attendent dans une file, rejouée à la reconnexion ;
 *  - à l'ouverture, on fusionne ce que dit le serveur avec ce qui est encore en attente localement.
 * Rien n'est perdu : une opération qui échoue reste dans la file pour la prochaine tentative.
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type Ann = {
  id: number; docKey: string; docVersion: string; page: number; kind: 'surlignage' | 'note' | 'dessin' | 'signet';
  rects: Rect[]; trace: [number, number][][]; couleur: string; citation: string; contenu: string; orpheline: boolean;
  miennes: boolean; auteur: string | null; destinataires?: { eluId: number; nom: string | null; via: string }[];
  reponses: { id: number; auteur: string | null; miennes: boolean; contenu: string; le: string }[];
};

type Op =
  | { op: 'create'; tempId: number; payload: Record<string, unknown> }
  | { op: 'update'; id: number; payload: Record<string, unknown> }
  | { op: 'delete'; id: number }
  | { op: 'reponse'; id: number; payload: Record<string, unknown> }
  | { op: 'ancrage'; id: number; payload: Record<string, unknown> };

type Etat = { items: Ann[]; file: Op[]; supprimes: number[] };
const vide = (): Etat => ({ items: [], file: [], supprimes: [] });

const cle = (seanceId: number, docKey: string) => `elus.annots.${seanceId}.${docKey}`;
const lire = (seanceId: number, docKey: string): Etat => { try { const v = localStorage.getItem(cle(seanceId, docKey)); return v ? (JSON.parse(v) as Etat) : vide(); } catch { return vide(); } };
const ecrire = (seanceId: number, docKey: string, e: Etat) => { try { localStorage.setItem(cle(seanceId, docKey), JSON.stringify(e)); } catch { /* quota : la file repartira de zéro */ } };

let seq = Date.now();
const idTemporaire = () => -(++seq);

const abonnes = new Set<(e: { seanceId: number; docKey: string; items: Ann[] }) => void>();
export function surSynchro(f: (e: { seanceId: number; docKey: string; items: Ann[] }) => void) { abonnes.add(f); return () => { abonnes.delete(f); }; }
const prevenir = (e: { seanceId: number; docKey: string; items: Ann[] }) => { for (const f of abonnes) f(e); };

/** Des annotations écrites hors ligne attendent-elles encore d'être transmises ? */
export const enAttente = (items: Ann[]) => items.some((a) => a.id < 0);

/** Une création réussie remplace l'identifiant temporaire partout où il apparaissait dans la file. */
const remplacerId = (e: Etat, tempId: number, id: number) => {
  e.items = e.items.map((a) => (a.id === tempId ? { ...a, id } : a));
  e.file = e.file.map((o) => ('id' in o && o.id === tempId ? { ...o, id } : o));
};

async function transmettre(seanceId: number, e: Etat): Promise<void> {
  if (!enLigne() || !e.file.length) return;
  const reste: Op[] = [];
  for (const op of [...e.file]) {
    try {
      if (op.op === 'create') { const a = (await api.post(`/elus/seances/${seanceId}/annotations`, op.payload)).data as Ann; remplacerId(e, op.tempId, a.id); e.items = e.items.map((x) => (x.id === op.tempId ? a : x)); }
      else if (op.op === 'update') await api.put(`/elus/annotations/${op.id}`, op.payload);
      else if (op.op === 'delete') { await api.delete(`/elus/annotations/${op.id}`); e.supprimes = e.supprimes.filter((x) => x !== op.id); }
      else if (op.op === 'reponse') await api.post(`/elus/annotations/${op.id}/reponses`, op.payload);
      else if (op.op === 'ancrage') await api.put(`/elus/annotations/${op.id}/ancrage`, op.payload);
    } catch { reste.push(op); }   // encore hors ligne, ou erreur passagère : on rejouera
  }
  e.file = reste;
}

/** Envoie ce qui peut l'être, puis renvoie la liste à jour (serveur + opérations encore en attente). */
export async function synchroniser(seanceId: number, docKey: string): Promise<Ann[]> {
  const e = lire(seanceId, docKey);
  await transmettre(seanceId, e);
  if (enLigne()) {
    try {
      const serveur = (await api.get(`/elus/seances/${seanceId}/annotations`, { params: { docKey } })).data.items as Ann[];
      const maj = new Map(e.file.filter((o) => o.op === 'update').map((o) => [o.id, o.payload] as const));
      e.items = [...serveur.filter((a) => !e.supprimes.includes(a.id)).map((a) => { const p = maj.get(a.id); return p ? { ...a, ...p } : a; }), ...e.items.filter((a) => a.id < 0)];
    } catch { /* hors ligne : on garde la copie locale */ }
  }
  ecrire(seanceId, docKey, e);
  prevenir({ seanceId, docKey, items: e.items });
  return e.items;
}

/** Annote d'abord localement ; la transmission suit dès qu'un réseau est là. */
export function creer(seanceId: number, docKey: string, b: { page: number; kind: Ann['kind']; couleur: string; docVersion: string; rects?: Rect[]; trace?: [number, number][][]; citation?: string; contenu?: string }): Ann {
  const e = lire(seanceId, docKey);
  const id = idTemporaire();
  const ann: Ann = { id, docKey, docVersion: b.docVersion, page: b.page, kind: b.kind, rects: b.rects || [], trace: b.trace || [], couleur: b.couleur, citation: b.citation || '', contenu: b.contenu || '', orpheline: false, miennes: true, auteur: null, destinataires: [], reponses: [] };
  e.items = [...e.items, ann];
  e.file.push({ op: 'create', tempId: id, payload: { docKey, docVersion: b.docVersion, couleur: b.couleur, page: b.page, kind: b.kind, rects: b.rects, trace: b.trace, citation: b.citation, contenu: b.contenu } });
  ecrire(seanceId, docKey, e);
  void synchroniser(seanceId, docKey);
  return ann;
}

export function modifier(seanceId: number, docKey: string, id: number, patch: Record<string, unknown>): void {
  const e = lire(seanceId, docKey);
  e.items = e.items.map((a) => (a.id === id ? { ...a, ...patch } : a));
  if (id < 0) e.file = e.file.map((o) => (o.op === 'create' && o.tempId === id ? { ...o, payload: { ...o.payload, ...patch } } : o));
  else e.file.push({ op: 'update', id, payload: patch });
  ecrire(seanceId, docKey, e);
  void synchroniser(seanceId, docKey);
}

export function supprimer(seanceId: number, docKey: string, id: number): void {
  const e = lire(seanceId, docKey);
  e.items = e.items.filter((a) => a.id !== id);
  if (id < 0) e.file = e.file.filter((o) => !(o.op === 'create' && o.tempId === id));
  else { e.file.push({ op: 'delete', id }); e.supprimes = [...e.supprimes, id]; }
  ecrire(seanceId, docKey, e);
  void synchroniser(seanceId, docKey);
}

export function repondre(seanceId: number, docKey: string, id: number, contenu: string): void {
  const e = lire(seanceId, docKey);
  const rep = { id: idTemporaire(), auteur: null, miennes: true, contenu, le: new Date().toISOString() };
  e.items = e.items.map((a) => (a.id === id ? { ...a, reponses: [...a.reponses, rep] } : a));
  e.file.push({ op: 'reponse', id, payload: { contenu } });
  ecrire(seanceId, docKey, e);
  void synchroniser(seanceId, docKey);
}

/** Ré-ancrage après changement de version du document ; peut attendre le réseau. */
export function ancrer(seanceId: number, docKey: string, id: number, patch: Record<string, unknown>): void {
  const e = lire(seanceId, docKey);
  e.items = e.items.map((a) => (a.id === id ? { ...a, ...patch } : a));
  if (id < 0) e.file = e.file.map((o) => (o.op === 'create' && o.tempId === id ? { ...o, payload: { ...o.payload, ...patch } } : o));
  else e.file.push({ op: 'ancrage', id, payload: patch });
  ecrire(seanceId, docKey, e);
  void synchroniser(seanceId, docKey);
}

// À la reconnexion, on vide les files de tous les documents annotés sur cet appareil.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    for (const k of Object.keys(localStorage)) {
      const m = /^elus\.annots\.(\d+)\.(.+)$/.exec(k);
      if (m) void synchroniser(Number(m[1]), m[2]);
    }
  });
}
