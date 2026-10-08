import { Link } from 'react-router-dom';
import { api, errMsg, org as orgPath } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Loading, useLoad, useToast } from '../ui';
import { Select } from '../Select';

/** Mise à disposition et affichage : ce qui est publié sans connexion (page des délibérations, moteur de recherche). Les réglages propres aux élus restent dans « Espace élus ». */
export default function AdminMiseADisposition() {
  const { org, isAdmin } = useAuth(); const o = org!.id; const { toast, node } = useToast();
  const cfg = useLoad(async () => (await api.get(orgPath(o, '/settings'))).data.settings as Record<string, { value: any }>, [o]);
  const setSetting = async (key: string, value: unknown, ok: string) => { try { await api.put(orgPath(o, `/settings/${key}`), { value, scope: 'organisme' }); toast(ok); cfg.reload(); } catch (e) { toast(errMsg(e), 'ko'); } };
  if (!isAdmin) return <ErrorBox msg="Réservé à l’administrateur de l’organisme." />;
  if (cfg.loading && !cfg.data) return <Loading />;
  if (!cfg.data) return <ErrorBox msg={cfg.error} />;
  const v = (k: string, d: any) => cfg.data?.[k]?.value ?? d;
  return (
    <div className="space-y-6">
      <p className="max-w-4xl text-mute">Ce qui est <b>publié sans connexion</b> : la liste des délibérations des derniers mois et le moteur de recherche, à incruster dans le site de la collectivité (iframe) ou à intégrer avec un script. Seules les délibérations <b>exécutoires</b> sont publiées, avec l’extrait du registre et les annexes publiables ; jamais l’exposé des motifs.</p>
        <section className="card space-y-4 p-5"><h3>Publication sans connexion</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Page publique des délibérations" hint="Sans connexion, à incruster en iframe : <adresse de l’espace des élus>/deliberations. Délibérations exécutoires, texte et pièces jointes publiables, jamais l’exposé des motifs.">
              <Select className="input" value={v('publication.deliberations_actif', false) ? 'oui' : 'non'} onChange={(e) => setSetting('publication.deliberations_actif', e.target.value === 'oui', e.target.value === 'oui' ? 'Page publique activée' : 'Page publique désactivée')}><option value="non">Désactivée</option><option value="oui">Activée</option></Select></Field>
            <Field label="Moteur de recherche des délibérations (public)" hint="Sans connexion, à incruster en iframe : <adresse de l’espace des élus>/deliberations-recherche. Sans limite de durée : séance, rapporteur, thématique, dates, texte du titre et/ou du corps. Jamais l’exposé des motifs.">
              <Select className="input" value={v('publication.recherche_actif', false) ? 'oui' : 'non'} onChange={(e) => setSetting('publication.recherche_actif', e.target.value === 'oui', e.target.value === 'oui' ? 'Moteur de recherche activé' : 'Moteur de recherche désactivé')}><option value="non">Désactivé</option><option value="oui">Activé</option></Select></Field>
            <Field label="Période affichée sur la page publique" hint="Délibérations des N derniers mois (aucune limite à 24 mois).">
              <input className="input" type="number" min={1} max={1200} defaultValue={v('publication.deliberations_mois', 6)} onBlur={(e) => { const n = Math.min(1200, Math.max(1, Number(e.target.value) || 6)); n !== v('publication.deliberations_mois', 6) && setSetting('publication.deliberations_mois', n, 'Période enregistrée'); }} /></Field>
          </div>
        </section>
      <section className="card space-y-2 p-5"><h3>Code d’intégration</h3>
        <p className="text-[13px] text-mute">Pages à intégrer, sur l’adresse publique de l’espace des élus (en DMZ) :</p>
        <ul className="list-disc space-y-1 pl-5 text-[13px]">
          <li><b>Liste des délibérations</b> : <code>/deliberations</code> (iframe) · <code>/deliberations-code</code> (code à copier)</li>
          <li><b>Moteur de recherche</b> : <code>/deliberations-recherche</code> (iframe) · <code>/deliberations-recherche-code</code> (code à copier)</li>
        </ul>
        <p className="text-[12px] text-mute">Les clés d’API pour les applications externes se gèrent dans <Link className="text-action underline" to="/admin/cles">Clés API</Link>.</p>
      </section>
      {node}
    </div>
  );
}
