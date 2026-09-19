-- 0006 — tutoriel de première connexion : état par utilisateur (UX-20 à UX-26).
CREATE TABLE user_onboarding (
  username      text NOT NULL,
  tour_id       text NOT NULL,
  tour_version  integer NOT NULL CHECK (tour_version >= 1),
  status        text NOT NULL CHECK (status IN ('started', 'completed', 'skipped')),
  steps_done    jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  skipped_at    timestamptz,
  PRIMARY KEY (username, tour_id)
);
