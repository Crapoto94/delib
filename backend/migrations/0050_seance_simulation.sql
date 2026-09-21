-- 0050 — mode simulation de la tenue de séance : ouverture un jour autre que la date de la séance.
-- Toute la saisie reste possible, mais la session est marquée « simulation » (bandeau visible, aucune valeur
-- juridique) et peut être annulée d'un geste : les données de tenue sont effacées et la séance revient à son
-- état d'avant l'ouverture (statut conservé dans simulation_statut_avant).
ALTER TABLE seance_tenue ADD COLUMN IF NOT EXISTS simulation boolean NOT NULL DEFAULT false;
ALTER TABLE seance_tenue ADD COLUMN IF NOT EXISTS simulation_statut_avant text;
ALTER TABLE seance_tenue ADD COLUMN IF NOT EXISTS simulation_at timestamptz;
