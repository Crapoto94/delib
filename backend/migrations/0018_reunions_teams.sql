-- 0018 — réunions de commission et visioconférence Teams (section 15, D51).
-- Une réunion de commission est une séance dont l'instance est celle de la commission (ODJ = projets présentés).
ALTER TABLE seances
  ADD COLUMN teams_join_url   text,
  ADD COLUMN teams_event_id   text,
  ADD COLUMN teams_organizer  text,
  ADD COLUMN teams_invited    boolean NOT NULL DEFAULT false,
  ADD COLUMN duree_minutes    integer;
CREATE UNIQUE INDEX instances_commission_uq ON instances (commission_id) WHERE commission_id IS NOT NULL;
