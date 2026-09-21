-- 0055 — Actes : suppression (hors circuit) et nouvel état « rappelé ».
--
-- Un acte HORS circuit peut être supprimé (après confirmation). Un acte DANS le circuit ne se supprime pas :
-- on le « rappelle » avec un motif, ce qui casse le circuit (étape courante marquée « returned ») et prévient
-- les intervenants. Nouvel état : rappele.
ALTER TABLE actes DROP CONSTRAINT IF EXISTS actes_statut_check;
ALTER TABLE actes ADD CONSTRAINT actes_statut_check CHECK (statut IN (
  'brouillon', 'en_circuit', 'modification_demandee', 'valide_dgs', 'en_attente_scc', 'mis_a_disposition', 'avis_rendu',
  'inscrit_odj', 'adopte', 'rejete', 'retire', 'ajourne', 'texte_definitif_pret', 'pret_a_transmettre', 'transmis',
  'ar_recu', 'publie', 'executoire', 'abandonne', 'rappele', 'archive'));
ALTER TABLE actes ADD COLUMN IF NOT EXISTS rappel_motif text;
ALTER TABLE actes ADD COLUMN IF NOT EXISTS rappel_at timestamptz;
