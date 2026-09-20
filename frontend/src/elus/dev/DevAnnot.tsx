import { useEffect, useState } from 'react';
import type { InternalAxiosRequestConfig } from 'axios';
import { api } from '../api';
import LecteurAnnote from '../AnnotPdf';
import echantillon from './echantillon.pdf?url';

/**
 * Banc d'essai du lecteur annoté (développement uniquement : /dev/annot). L'API de l'espace élus est simulée en mémoire,
 * ce qui permet de tester les gestes (sélection, dessin, note, partage) sans compte d'élu ni serveur.
 */
type A = any;
function installerFaux(version: () => string) {
  let seq = 1; const items: A[] = [];
  const rep = (config: InternalAxiosRequestConfig, data: unknown, status = 200) => Promise.resolve({ data, status, statusText: 'OK', headers: {}, config });
  api.defaults.adapter = async (config) => {
    const url = String(config.url || ''); const m = String(config.method || 'get').toLowerCase(); const b = config.data ? JSON.parse(config.data) : {};
    if (m === 'get' && /\/annotations$/.test(url)) return rep(config, { items: JSON.parse(JSON.stringify(items)) });
    if (m === 'post' && /\/annotations$/.test(url)) { const a = { id: seq++, seanceId: 1, orpheline: false, miennes: true, auteur: null, destinataires: [], reponses: [], rects: [], trace: [], citation: '', contenu: '', ...b }; items.push(a); return rep(config, JSON.parse(JSON.stringify(a)), 201); }
    let r = /\/annotations\/(\d+)$/.exec(url);
    if (r && m === 'put') { const a = items.find((x) => x.id === Number(r![1])); Object.assign(a, b); return rep(config, a); }
    if (r && m === 'delete') { items.splice(items.findIndex((x) => x.id === Number(r![1])), 1); return rep(config, { ok: true }); }
    r = /\/annotations\/(\d+)\/ancrage$/.exec(url);
    if (r) { const a = items.find((x) => x.id === Number(r![1])); if (b.orpheline) a.orpheline = true; else Object.assign(a, b, { orpheline: false }); return rep(config, { id: a.id }); }
    r = /\/annotations\/(\d+)\/partage$/.exec(url);
    if (r) { const a = items.find((x) => x.id === Number(r![1])); a.destinataires = b.mode === 'revoquer' ? [] : [{ eluId: 2, nom: 'Jeanne LAMBERT', via: b.mode === 'groupe' ? 'groupe' : 'elu' }]; return rep(config, { destinataires: a.destinataires }); }
    if (/\/annotations\/partage$/.test(url)) return rep(config, { annotations: items.length });
    r = /\/annotations\/(\d+)\/reponses$/.exec(url);
    if (r) { const a = items.find((x) => x.id === Number(r![1])); a.reponses.push({ id: seq++, auteur: null, miennes: true, contenu: b.contenu, le: new Date().toISOString() }); return rep(config, a, 201); }
    if (/\/collegues$/.test(url)) return rep(config, { items: [{ id: 2, nom: 'Jeanne LAMBERT', groupe: 'Majorité' }, { id: 3, nom: 'Omar REY', groupe: 'Opposition' }] });
    void version; return rep(config, {});
  };
  return items;
}

export default function DevAnnot() {
  const [blob, setBlob] = useState<Blob | null>(null); const [version, setVersion] = useState('v1');
  useEffect(() => { installerFaux(() => version); fetch(echantillon).then((r) => r.blob()).then(setBlob); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto flex h-screen max-w-5xl flex-col p-3">
      <p className="mb-2 text-[12px] text-mute">Banc d’essai (développement) — API simulée en mémoire. Version du document : <b>{version}</b> <button className="ml-2 underline" onClick={() => setVersion(version === 'v1' ? 'v2' : 'v1')}>changer de version</button></p>
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line">{blob && <LecteurAnnote key={version} blob={blob} doc={{ key: 'p:1:projet', version, titre: 'Projet de délibération' }} seanceId={1} />}</div>
    </div>
  );
}
