export const dt = (v?: string | null, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
  v ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...opts }).format(new Date(v)) : '—';
export const d = (v?: string | null) => dt(v, { dateStyle: 'long' });
export const daysUntil = (v?: string | null) => (v ? Math.ceil((new Date(v).getTime() - Date.now()) / 86400000) : null);

export const STATUTS: Record<string, { label: string; tone: 'gray' | 'blue' | 'ok' | 'warn' | 'ko' }> = {
  brouillon: { label: 'Brouillon', tone: 'gray' }, en_circuit: { label: 'En circuit', tone: 'blue' }, modification_demandee: { label: 'Modification demandée', tone: 'warn' },
  valide_dgs: { label: 'Validé DGS', tone: 'ok' }, en_attente_scc: { label: 'En attente SCC', tone: 'blue' }, mis_a_disposition: { label: 'Mis à disposition', tone: 'blue' },
  avis_rendu: { label: 'Avis rendu', tone: 'ok' }, inscrit_odj: { label: 'Inscrit à l’ODJ', tone: 'blue' }, adopte: { label: 'Adopté', tone: 'ok' }, rejete: { label: 'Rejeté', tone: 'ko' },
  retire: { label: 'Retiré', tone: 'gray' }, ajourne: { label: 'Ajourné', tone: 'warn' }, abandonne: { label: 'Abandonné', tone: 'gray' }, archive: { label: 'Archivé', tone: 'gray' },
  texte_definitif_pret: { label: 'Texte définitif prêt', tone: 'ok' }, pret_a_transmettre: { label: 'Prêt à transmettre', tone: 'ok' }, transmis: { label: 'Transmis', tone: 'blue' },
  ar_recu: { label: 'AR reçu', tone: 'ok' }, publie: { label: 'Publié', tone: 'ok' }, executoire: { label: 'Exécutoire', tone: 'ok' },
};
