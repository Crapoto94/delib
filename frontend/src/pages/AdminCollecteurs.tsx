import { useEffect, useState } from 'react';
import {
  Pencil, Play, Plug, Plus, RefreshCw, ScrollText, Trash2, XCircle,
} from 'lucide-react';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { dt } from '../format';
import { Badge, Empty, Field, Loading, Modal, Spinner, useLoad, useToast } from '../ui';
import { Select } from '../Select';

const INTERVALLES = [['1h', 'Toutes les heures'], ['4h', 'Toutes les 4 heures'], ['24h', 'Une fois par jour']];
const STATUTS: Record<string, { t: string; tone: 'ok' | 'warn' | 'ko' | 'gray' }> = {
  traite: { t: 'Traité', tone: 'ok' }, attente: { t: 'En attente', tone: 'warn' },
  erreur: { t: 'Erreur', tone: 'ko' }, doublon: { t: 'Doublon', tone: 'gray' }, recu: { t: 'Reçu', tone: 'gray' },
};

  const vide = () => ({
    id: null as number | null, nom: '', type: 'dossier' as 'mail' | 'dossier', actif: true, intervalle: '24h',
    typeArreteId: '' as number | '', eluId: '' as number | '', emailRetour: '',
    graphMailbox: '', retraitMail: true,
    cible: '', utilisateur: '', motDePasse: '', sousDossiers: 'gauche', mouvement: 'deplacer', dossierSignes: '',
    natureId: '' as number | '', matiereId: '' as number | '', rubriqueId: '' as number | '',
    directionCode: '', directionLabel: '', confidentialite: 'normale', circuitId: '' as number | '',
    signatureTexte: '', sigPage: '', sigX: '', sigY: '', sigW: '', sigH: '', signatureMode: '',
});

/** Collecteurs d'arrêtés : moisson d'une boîte mail (Microsoft Graph) ou d'un dossier de partage, analyse IA et envoi en signature. */
export default function AdminCollecteurs() {
  const { org } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const liste = useLoad(async () => (await api.get(orgPath(o, '/collecteurs'))).data.items as any[], [o]);
  const types = useLoad(async () => (await api.get(orgPath(o, '/collecteurs/types'))).data.items as any[], [o]);
  const elus = useLoad(async () => (await api.get(orgPath(o, '/elus'), { params: { actif: true } })).data.items as any[], [o]);
  // Classement et suite donnée à l'arrêté : mêmes référentiels que la fiche d'un acte, plus les circuits publiés.
  const natures = useLoad(async () => (await api.get(orgPath(o, '/referentiels/nature'))).data.items as any[], [o]);
  const matieres = useLoad(async () => (await api.get(orgPath(o, '/referentiels/matiere'))).data.items as any[], [o]);
  const rubriques = useLoad(async () => (await api.get(orgPath(o, '/referentiels/rubrique'))).data.items as any[], [o]);
  const organigramme = useLoad(async () => (await api.get(orgPath(o, '/organigramme'))).data.items as any[], [o]);
  const circuits = useLoad(async () => (await api.get(orgPath(o, '/circuits'))).data.items as any[], [o]);
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null);
  const [journal, setJournal] = useState<any[] | null>(null); const [journalDe, setJournalDe] = useState<any>(null);
  const [nouveauType, setNouveauType] = useState('');

  const ouvrir = (c: any) => setF(c ? {
    id: c.id, nom: c.nom, type: c.type, actif: c.actif, intervalle: c.intervalle,
    typeArreteId: c.typeArreteId ?? '', eluId: c.eluId ?? '', emailRetour: c.emailRetour || '',
    graphMailbox: c.mailbox || '', retraitMail: c.retraitMail !== false,
    cible: c.cible || '', utilisateur: c.utilisateur || '', motDePasse: '', sousDossiers: c.sousDossiers || 'gauche', mouvement: c.mouvement || 'deplacer', dossierSignes: c.dossierSignes || '',
    natureId: c.natureId ?? '', matiereId: c.matiereId ?? '', rubriqueId: c.rubriqueId ?? '',
    directionCode: c.directionCode || '', directionLabel: c.directionLabel || '', confidentialite: c.confidentialite || 'normale', circuitId: c.circuitId ?? '',
    signatureTexte: c.signatureTexte || '', sigPage: c.signaturePosition?.page ?? '', sigX: c.signaturePosition?.x ?? '', sigY: c.signaturePosition?.y ?? '', sigW: c.signaturePosition?.w ?? '', sigH: c.signaturePosition?.h ?? '', signatureMode: c.signatureMode || '',
  } : vide());

  const corps = () => {
    const config: any = {};
    if (f.dossierSignes) config.dossierSignes = f.dossierSignes;
    // Classement de l'arrêté fabriqué : identifiants des référentiels, direction, communicabilité et circuit.
    // Vide = l'IA propose (ou l'arrêté reste à compléter) ; null explicite = on efface le réglage.
    config.natureId = f.natureId || null; config.matiereId = f.matiereId || null; config.rubriqueId = f.rubriqueId || null;
    config.directionCode = f.directionCode || null;
    // Le libellé accompagne le code : l'arrêté porte ainsi le nom complet de la direction (et non son code) même si
    // l'organigramme change ensuite.
    config.directionLabel = f.directionLabel || null;
    config.confidentialite = f.confidentialite === 'confidentiel' ? 'confidentiel' : 'normale';
    config.circuitId = f.circuitId || null;
    // Signature : un repère dans le document prime, sinon le cadre explicite (même convention que l'emplacement d'un acte).
    config.signatureTexte = f.signatureTexte.trim() || null;
    config.signaturePosition = f.sigPage
      ? { page: Number(f.sigPage), x: Number(f.sigX) || 75, y: Number(f.sigY) || 85, w: Number(f.sigW) || 150, h: Number(f.sigH) || 60 }
      : null;
    config.signatureMode = f.signatureMode || null;
    if (f.type === 'mail') {
      if (f.graphMailbox.trim()) config.graphMailbox = f.graphMailbox.trim();
      config.retraitMail = !!f.retraitMail;
    } else {
      config.cible = f.cible.trim(); config.sousDossiers = f.sousDossiers; config.mouvement = f.mouvement;
      if (f.utilisateur.trim()) config.utilisateur = f.utilisateur.trim();
      if (f.motDePasse) config.motDePasse = f.motDePasse;
    }
    return {
      nom: f.nom.trim(), type: f.type, actif: !!f.actif, intervalle: f.intervalle,
      typeArreteId: f.typeArreteId || null, eluId: f.eluId || null, emailRetour: f.emailRetour.trim() || null, config,
    };
  };

  const enregistrer = async () => {
    if (f.nom.trim().length < 2) return toast('Nom du collecteur trop court', 'ko');
    if (f.type === 'dossier' && !f.cible.trim()) return toast('Indiquez le dossier source', 'ko');
    setBusy('save');
    try {
      if (f.id) await api.put(orgPath(o, `/collecteurs/${f.id}`), corps());
      else await api.post(orgPath(o, '/collecteurs'), corps());
      toast('Collecteur enregistré'); setF(null); liste.reload();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };

  const tester = async (c: any) => {
    setBusy(`test-${c.id}`);
    try { const r = (await api.post(orgPath(o, `/collecteurs/${c.id}/tester`), {})).data; toast(r.message || 'Source joignable'); }
    catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const collecter = async (c: any) => {
    if (!window.confirm(`Lancer une collecte maintenant pour « ${c.nom} » ?\n\nLes pièces trouvées seront analysées et transformées en arrêtés.`)) return;
    setBusy(`col-${c.id}`);
    try {
      const r = (await api.post(orgPath(o, `/collecteurs/${c.id}/collecter`), {})).data;
      toast(`${r.traites} traité(s), ${r.attentes} en attente, ${r.doublons} doublon(s), ${r.erreurs} erreur(s)`); liste.reload();
    } catch (e) { toast(errMsg(e), 'ko'); } finally { setBusy(null); }
  };
  const supprimer = async (c: any) => {
    if (!window.confirm(`Supprimer le collecteur « ${c.nom} » ?`)) return;
    try { await api.delete(orgPath(o, `/collecteurs/${c.id}`)); liste.reload(); toast('Collecteur supprimé'); }
    catch (e) { toast(errMsg(e), 'ko'); }
  };
  const voirJournal = async (c: any) => {
    setJournalDe(c); setJournal(null);
    try { setJournal((await api.get(orgPath(o, `/collecteurs/${c.id}/collectes`), { params: { limite: 50 } })).data.items); }
    catch (e) { toast(errMsg(e), 'ko'); setJournal([]); }
  };
  const ajouterType = async () => {
    if (nouveauType.trim().length < 3) return toast('Nom de type trop court', 'ko');
    try { await api.post(orgPath(o, '/collecteurs/types'), { nom: nouveauType.trim() }); setNouveauType(''); types.reload(); toast('Type ajouté'); }
    catch (e) { toast(errMsg(e), 'ko'); }
  };
  const retirerType = async (t: any) => {
    try { await api.delete(orgPath(o, `/collecteurs/types/${t.id}`)); types.reload(); }
    catch (e) { toast(errMsg(e), 'ko'); }
  };

  const nomType = (id: any) => types.data?.find((t) => t.id === id)?.nom || null;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2>Collecteurs d'arrêtés</h2>
        <p className="mb-3 text-mute">Un collecteur <b>moissonne</b> une source — une boîte mail <b>Microsoft Graph</b> ou un <b>dossier de partage</b> — analyse chaque pièce (destinataire, type d'arrêté, objet, trame), puis crée l'arrêté et l'envoie en signature à l'élu. Un dossier certain part directement au parapheur ; sinon il reste <b>en attente</b> et l'administration est alertée (cloche + courriel). Les pièces traitées sont retirées de la source (message supprimé, fichier déplacé dans <code>_traites/</code>) ; les arrêtés signés sont déposés dans le dossier <code>signé/</code>.</p>
      </section>

      <section className="card p-5">
        <h3 className="mb-1">Catalogue des types d'arrêté</h3>
        <p className="mb-3 text-[13px] text-mute">Le type d'un collecteur fixe l'arrêté produit ; l'IA ne fait que <b>proposer</b> l'un de ces types. Tenez ce catalogue à jour.</p>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input className="input max-w-xs" placeholder="ex. Arrêté de voirie" value={nouveauType} onChange={(e) => setNouveauType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ajouterType()} />
          <button className="btn-secondary" onClick={ajouterType}><Plus className="h-4 w-4" /> Ajouter</button>
        </div>
        {types.loading && !types.data ? <Loading /> : !types.data?.length ? <p className="text-mute">Aucun type défini pour l'instant.</p> : (
          <div className="flex flex-wrap gap-2">{types.data.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-soft px-3 py-1 text-[13px]">
              {t.nom}<button aria-label={`Retirer ${t.nom}`} className="text-ko" onClick={() => retirerType(t)}><XCircle className="h-3.5 w-3.5" /></button>
            </span>))}</div>)}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3>Collecteurs</h3>
          <div className="flex gap-2"><button className="btn-secondary" onClick={liste.reload} disabled={liste.loading}><RefreshCw className={`h-4 w-4 ${liste.loading ? 'animate-spin' : ''}`} /> Rafraîchir</button>
            <button className="btn-primary" onClick={() => ouvrir(null)}><Plus className="h-4 w-4" /> Nouveau collecteur</button></div>
        </div>
        {liste.loading && !liste.data ? <Loading /> : !liste.data?.length ? <Empty>Aucun collecteur. Créez-en un pour moissonner une boîte ou un dossier.</Empty> : (
          <table className="w-full">
            <thead><tr><th>Collecteur</th><th>Source</th><th>Fréquence</th><th>Type d'arrêté</th><th>Dernière passe</th><th>État</th><th /></tr></thead>
            <tbody>{liste.data.map((c) => {
              const r = c.dernierResultat || {};
              return (
                <tr key={c.id}>
                  <td><div className="font-semibold">{c.nom}</div><div className="text-[11px] text-mute">{c.type === 'mail' ? 'Microsoft Graph' : 'Dossier / partage'}{c.actif ? '' : ' · désactivé'}</div></td>
                  <td className="text-[12px] text-mute">{c.type === 'mail' ? (c.mailbox || 'boîte de l’API ville') : <span title={c.cible} className="font-mono">{c.cible}</span>}</td>
                  <td className="whitespace-nowrap text-[12px]">{INTERVALLES.find(([k]) => k === c.intervalle)?.[1] || c.intervalle}<div className="text-[11px] text-mute">{c.prochainPassage ? `prochain : ${dt(c.prochainPassage)}` : 'jamais passé'}</div></td>
                  <td>{c.typeArreteNom || nomType(c.typeArreteId) || <span className="text-mute">selon IA</span>}{c.eluNom && <div className="text-[11px] text-mute">signé par {c.eluNom}</div>}</td>
                  <td className="whitespace-nowrap text-[12px] text-mute">{c.dernierPassage ? dt(c.dernierPassage) : '—'}</td>
                  <td className="text-[12px]">{c.dernierPassage ? <span>{r.traites || 0} traité(s){r.attentes ? <span className="text-warn-text"> · {r.attentes} attente(s)</span> : ''}{r.erreurs ? <span className="text-ko"> · {r.erreurs} erreur(s)</span> : ''}{r.erreur && <div className="text-[11px] text-ko">{r.erreur}</div>}</span> : <span className="text-mute">—</span>}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-secondary !px-2 mr-1" title="Tester la source" onClick={() => tester(c)} disabled={!!busy}>{busy === `test-${c.id}` ? <Spinner /> : <Plug className="h-4 w-4" />}</button>
                    <button className="btn-secondary !px-2 mr-1" title="Collecter maintenant" onClick={() => collecter(c)} disabled={!!busy}>{busy === `col-${c.id}` ? <Spinner /> : <Play className="h-4 w-4" />}</button>
                    <button className="btn-secondary !px-2 mr-1" title="Journal des collectes" onClick={() => voirJournal(c)}><ScrollText className="h-4 w-4" /></button>
                    <button className="btn-secondary !px-2 mr-1" title="Modifier" onClick={() => ouvrir(c)}><Pencil className="h-4 w-4" /></button>
                    <button className="text-ko !px-1" title="Supprimer" onClick={() => supprimer(c)}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>);
            })}</tbody>
          </table>)}
      </section>

      {f && (
        <Modal title={f.id ? 'Modifier le collecteur' : 'Nouveau collecteur'} onClose={() => setF(null)} wide>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nom du collecteur *"><input className="input" value={f.nom} placeholder="ex. Arrêtés du maire" onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
              <Field label="Source">
                <Select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} disabled={!!f.id}>
                  <option value="dossier">Dossier / partage réseau</option><option value="mail">Boîte mail (Microsoft Graph)</option>
                </Select>
              </Field>
              <Field label="Fréquence de passage">
                <Select className="input" value={f.intervalle} onChange={(e) => setF({ ...f, intervalle: e.target.value })}>{INTERVALLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              </Field>
              <Field label="Type d'arrêté (catalogue)" hint="Laissé vide, l'IA propose un type du catalogue ; sinon l'arrêté reste en attente.">
                <Select className="input" value={f.typeArreteId} onChange={(e) => setF({ ...f, typeArreteId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">— selon l'IA —</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
                </Select>
              </Field>
              <Field label="Élu signataire (par défaut)" hint="Utilisé si l'IA et le sous-dossier ne désignent personne.">
                <Select className="input" value={f.eluId} onChange={(e) => setF({ ...f, eluId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">— aucun —</option>{elus.data?.map((e) => <option key={e.id} value={e.id}>{e.nomComplet}</option>)}
                </Select>
              </Field>
              <Field label="E-mail de retour (facultatif)" hint="Reçoit une alerte en cas d'incertitude et le courriel de retour de signature.">
                <input className="input" type="email" value={f.emailRetour} placeholder="secretariat@ville.fr" onChange={(e) => setF({ ...f, emailRetour: e.target.value })} />
              </Field>
            </div>

            {/* Classement de l'arrêté produit : ce qui n'est pas fixé ici est proposé par l'IA au moment de la collecte
                (si la consigne « collecteurs » est active), et reste modifiable dans le dossier. */}
            <div className="grid gap-3 rounded border border-line p-3 md:grid-cols-2">
              <p className="text-[12px] text-mute md:col-span-2">
                Classement et suite donnée à l'arrêté fabriqué. <b>Chaque champ laissé vide est proposé par l'IA</b> (consigne
                « Analyse des arrêtés collectés »), puis reste modifiable dans le dossier.
              </p>
              <Field label="Nature"><Select className="input" value={f.natureId} onChange={(e) => setF({ ...f, natureId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">— selon l'IA —</option>{natures.data?.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}
              </Select></Field>
              <Field label="Matière (thématique)"><Select className="input" value={f.matiereId} onChange={(e) => setF({ ...f, matiereId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">— selon l'IA —</option>{matieres.data?.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}
              </Select></Field>
              <Field label="Rubrique"><Select className="input" value={f.rubriqueId} onChange={(e) => setF({ ...f, rubriqueId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">— selon l'IA —</option>{rubriques.data?.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}
              </Select></Field>
              <Field label="Direction porteuse" hint="La direction à laquelle l'arrêté est rattaché. Laissée vide, l'IA propose, sinon la direction générale.">
                <Select className="input" value={f.directionCode} onChange={(e) => setF({ ...f, directionCode: e.target.value, directionLabel: organigramme.data?.find((d) => d.code === e.target.value)?.label || '' })}>
                  <option value="">— selon l'IA / direction générale —</option>
                  {organigramme.data?.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                </Select>
              </Field>
              <Field label="Communicabilité" hint="Un arrêté non communicable (données personnelles, sécurité…) n'est pas publié.">
                <Select className="input" value={f.confidentialite} onChange={(e) => setF({ ...f, confidentialite: e.target.value })}>
                  <option value="normale">Communicable (public)</option><option value="confidentiel">Non communicable (confidentiel)</option>
                </Select>
              </Field>
              <Field label="Suite donnée" hint="Avec un circuit, l'arrêté passe par ses valideurs puis part en signature à la fin du circuit. Sans circuit, il part directement en signature.">
                <Select className="input" value={f.circuitId} onChange={(e) => setF({ ...f, circuitId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Envoi direct en signature</option>
                  {circuits.data?.filter((c) => c.activeVersionId).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </Select>
              </Field>

              <div className="grid gap-3 rounded border border-line p-3 md:col-span-2 md:grid-cols-3">
                <p className="text-[12px] text-mute md:col-span-3">
                  Emplacement de la signature (maire ou adjoint·e par délégation). Si le document déposé porte un <b>repère</b> (par exemple
                  <code> [SIGNATURE] </code>), c'est lui qui est utilisé, où qu'il soit ; sinon le cadre ci-dessous
                  s'applique. Sans repère ni cadre : page 1, 75 % / 85 %, 150 × 60 points.
                </p>
                <Field label="Repère dans le document" hint="Texte présent à l'endroit où signer (ex. [SIGNATURE]). La recherche ignore accents et majuscules.">
                  <input className="input font-mono" value={f.signatureTexte} placeholder="[SIGNATURE]" onChange={(e) => setF({ ...f, signatureTexte: e.target.value })} />
                </Field>
                <Field label="Type de signature" hint="La signature P12 (certificat) est la plus forte ; la manuscrite est une signature simple mémorisée par le parapheur.">
                  <Select className="input" value={f.signatureMode} onChange={(e) => setF({ ...f, signatureMode: e.target.value })}>
                    <option value="">— selon le paramétrage du parapheur —</option>
                    <option value="securise">Signature P12 (certificat)</option>
                    <option value="simple">Signature manuscrite (simple)</option>
                  </Select>
                </Field>
                <Field label="Page"><input className="input" type="number" min={1} value={f.sigPage} placeholder="1" onChange={(e) => setF({ ...f, sigPage: e.target.value })} /></Field>
                <Field label="Largeur (points)"><input className="input" type="number" min={10} max={600} value={f.sigW} placeholder="150" onChange={(e) => setF({ ...f, sigW: e.target.value })} /></Field>
                <Field label="Centre horizontal (%)" hint="Depuis la gauche de la page."><input className="input" type="number" min={0} max={100} value={f.sigX} placeholder="75" onChange={(e) => setF({ ...f, sigX: e.target.value })} /></Field>
                <Field label="Centre vertical (%)" hint="Depuis le haut de la page."><input className="input" type="number" min={0} max={100} value={f.sigY} placeholder="85" onChange={(e) => setF({ ...f, sigY: e.target.value })} /></Field>
                <Field label="Hauteur (points)"><input className="input" type="number" min={10} max={300} value={f.sigH} placeholder="60" onChange={(e) => setF({ ...f, sigH: e.target.value })} /></Field>
              </div>
            </div>

            {f.type === 'dossier' ? (
              <div className="grid gap-3 rounded border border-line p-3 md:grid-cols-2">
                <div className="md:col-span-2"><Field label="Dossier source *" hint="Chemin local (/mnt/arretes ou D:\arrêtés\à_traiter) ou partage réseau UNC (\\serveur\partage\arrêtés). Un partage réseau est lu directement par l'application — aucun montage préalable n'est nécessaire."><input className="input font-mono" value={f.cible} placeholder="\\serveur\partage\arretes" onChange={(e) => setF({ ...f, cible: e.target.value })} /></Field></div>
                <Field label="Compte d'accès (facultatif)"><input className="input" autoComplete="off" value={f.utilisateur} placeholder="domaine\compte" onChange={(e) => setF({ ...f, utilisateur: e.target.value })} /></Field>
                <Field label="Mot de passe" hint={f.id ? 'Enregistré (chiffré) : laissez vide pour le conserver.' : 'Chiffré au repos, jamais affiché.'}><input className="input" type="password" autoComplete="new-password" value={f.motDePasse} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} /></Field>
                <Field label="Organisation des pièces">
                  <Select className="input" value={f.sousDossiers} onChange={(e) => setF({ ...f, sousDossiers: e.target.value })}>
                    <option value="gauche">Fichiers à la racine</option><option value="elus">Un sous-dossier par élu</option>
                  </Select>
                </Field>
                <Field label="Après traitement">
                  <Select className="input" value={f.mouvement} onChange={(e) => setF({ ...f, mouvement: e.target.value })}>
                    <option value="deplacer">Déplacer dans _traites/&lt;date&gt;</option><option value="supprimer">Supprimer la pièce</option>
                  </Select>
                </Field>
                <div className="md:col-span-2"><Field label="Dossier « signé »" hint="Sous-dossier (relatif au dossier source) où déposer les arrêtés signés. Par défaut : signe."><input className="input" value={f.dossierSignes} placeholder="signe" onChange={(e) => setF({ ...f, dossierSignes: e.target.value })} /></Field></div>
              </div>
            ) : (
              <div className="grid gap-3 rounded border border-line p-3 md:grid-cols-2">
                <div className="md:col-span-2"><Field label="Boîte mail à lire (facultatif)" hint="Adresse de la boîte (ex. arretes@ville.fr). Laissée vide, la boîte configurée dans l'API de la Ville est utilisée. L'accès Microsoft Graph est géré par l'API ville."><input className="input" type="email" value={f.graphMailbox} placeholder="arretes@ville.fr" onChange={(e) => setF({ ...f, graphMailbox: e.target.value })} /></Field></div>
                <div className="flex items-end"><label className="flex items-center gap-3"><input type="checkbox" checked={!!f.retraitMail} onChange={(e) => setF({ ...f, retraitMail: e.target.checked })} /> <span className="text-[13px]">Supprimer les messages traités</span></label></div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {f.type === 'mail' && <Field label="Dossier « signé » (facultatif)" hint="Nom d'un dossier de partage où copier les arrêtés signés (le courriel de retour suffit souvent)."><input className="input" value={f.dossierSignes} placeholder="(aucun)" onChange={(e) => setF({ ...f, dossierSignes: e.target.value })} /></Field>}
              <div className="flex items-end"><label className="flex items-center gap-3"><input type="checkbox" checked={!!f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} /> <span>Collecteur <b>actif</b> — il passe automatiquement à sa fréquence</span></label></div>
            </div>

            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setF(null)}>Annuler</button>
              <button className="btn-primary" onClick={enregistrer} disabled={!!busy}>{busy === 'save' && <Spinner />} Enregistrer</button></div>
          </div>
        </Modal>
      )}

      {journalDe && (
        <Modal title={`Journal — ${journalDe.nom}`} onClose={() => { setJournalDe(null); setJournal(null); }} wide>
          {journal === null ? <Loading /> : !journal.length ? <p className="text-mute">Aucune collecte enregistrée.</p> : (
            <table className="w-full"><thead><tr><th>Date</th><th>Origine</th><th>Fichier</th><th>Statut</th><th>Dossier</th></tr></thead>
              <tbody>{journal.map((x) => {
                const st = STATUTS[x.statut] || { t: x.statut, tone: 'gray' as const };
                const inc = x.detail?.incertains || [];
                return (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-mute">{dt(x.at)}</td>
                    <td className="text-[12px]">{x.origine || '—'}{x.eluNom && <div className="text-[11px] text-mute">{x.eluNom}</div>}</td>
                    <td className="text-[12px]">{x.nom_fichier}{x.erreur && <div className="text-[11px] text-ko">{x.erreur}</div>}{x.detail?.envoyeErreur && <div className="text-[11px] text-ko">{x.detail.envoyeErreur}</div>}{inc.length > 0 && <div className="text-[11px] text-warn-text">{inc.join(' ; ')}</div>}</td>
                    <td><Badge tone={st.tone}>{st.t}</Badge></td>
                    <td>{x.acte_id ? <a className="underline" href={`/dossiers/${x.acte_id}`}>{x.acte_numero ? `n° ${x.acte_numero}` : 'ouvrir'}</a> : '—'}</td>
                  </tr>);
              })}</tbody>
            </table>)}
        </Modal>
      )}

      {node}
    </div>
  );
}