import { useEffect, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { api, org as orgPath } from './api';

export type Piece = { id: number; nom: string; mime: string; taille: number };
export const MAX_PIECES = 5;
export const MAX_OCTETS = 10 * 1048576;
export const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.log,.docx,.xlsx,.pptx,.odt,.ods';
const EXT = new Set(ACCEPT.replace(/\./g, '').split(','));
export const extOk = (nom: string) => EXT.has((nom.split('.').pop() || '').toLowerCase());
export const taille = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/** Nom d'une image collée : capture-AAAAMMJJ-HHMM.png (les navigateurs la nomment tous « image.png »). */
export function nomCapture(f: File, rang: number) {
  const n = new Date(); const p = (x: number) => String(x).padStart(2, '0');
  const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return `capture-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${rang > 0 ? `-${rang + 1}` : ''}.${ext}`;
}

/** Vignette d'un fichier choisi, avant envoi, avec suppression. */
export function VignetteLocale({ f, onRetirer }: { f: File; onRetirer: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (!f.type.startsWith('image/')) return; const u = URL.createObjectURL(f); setUrl(u); return () => URL.revokeObjectURL(u); }, [f]);
  return (
    <li className="relative flex w-28 flex-col items-center gap-1 rounded border border-line bg-soft p-2 text-center">
      {url ? <img src={url} alt={f.name} className="h-16 w-full rounded object-cover" /> : <FileText className="h-16 w-8 text-mute" />}
      <span className="w-full truncate text-[11px]" title={f.name}>{f.name}</span><span className="text-[10px] text-mute">{taille(f.size)}</span>
      <button type="button" className="absolute -right-2 -top-2 rounded-full bg-surface p-0.5 shadow ring-1 ring-line hover:text-ko" aria-label={`Retirer ${f.name}`} onClick={onRetirer}><X className="h-3.5 w-3.5" /></button>
    </li>
  );
}

/** Pièces jointes d'une demande déjà enregistrée : aperçu des images, téléchargement des autres (le jeton passe par l'API, pas par un lien direct). */
export function PiecesDemande({ orgId, demandeId, pieces }: { orgId: number; demandeId: number; pieces: Piece[] }) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  useEffect(() => {
    let vivant = true; const faits: string[] = [];
    pieces.filter((p) => p.mime.startsWith('image/')).forEach((p) => {
      api.get(orgPath(orgId, `/backlog/${demandeId}/pieces/${p.id}/file`), { responseType: 'blob' }).then((r) => { const u = URL.createObjectURL(r.data); faits.push(u); if (vivant) setUrls((x) => ({ ...x, [p.id]: u })); }).catch(() => {});
    });
    return () => { vivant = false; faits.forEach((u) => URL.revokeObjectURL(u)); };
  }, [orgId, demandeId, pieces]);
  const ouvrir = async (p: Piece) => {
    const r = await api.get(orgPath(orgId, `/backlog/${demandeId}/pieces/${p.id}/file`), { responseType: 'blob' });
    const u = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = u; a.download = p.nom; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000);
  };
  if (!pieces.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {pieces.map((p) => (
        <li key={p.id}>
          {urls[p.id]
            ? <a href={urls[p.id]} target="_blank" rel="noreferrer" title={`${p.nom} (${taille(p.taille)})`}><img src={urls[p.id]} alt={p.nom} className="h-16 max-w-32 rounded border border-line object-cover" /></a>
            : <button type="button" className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[12px] hover:bg-soft" onClick={() => ouvrir(p)}><Paperclip className="h-3.5 w-3.5" /> {p.nom} <span className="text-mute">({taille(p.taille)})</span></button>}
        </li>))}
    </ul>
  );
}
