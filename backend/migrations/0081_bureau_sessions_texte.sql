-- 0081 — bureau en ligne : édition externe d'un texte suivi (exposé, « Vu et considérant », délibéré).
--
-- Une session d'édition peut désormais viser, au lieu d'une annexe, un texte suivi : le service de documents reçoit un
-- document Word fabriqué à partir du markdown du texte, l'agent l'édite, et le document rapporté est reconverti puis
-- enregistré par le chemin ordinaire de `tracked_texts` (version, suivi des modifications, audit). `annexe_id` reste
-- l'identifiant des sessions d'annexe ; `texte_id` celui des sessions de texte — au plus un des deux est renseigné.

ALTER TABLE bureau_sessions
  ADD COLUMN IF NOT EXISTS texte_id bigint REFERENCES tracked_texts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS bureau_sessions_texte_idx ON bureau_sessions (texte_id);
