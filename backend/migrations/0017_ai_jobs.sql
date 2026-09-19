-- 0017 — file d'attente des interrogations de l'IA (D52) : tout appel se fait en arrière plan, avec limites paramétrables.
CREATE TABLE ai_jobs (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisme_id    integer NOT NULL REFERENCES organismes(id) ON DELETE CASCADE,
  acte_id         integer REFERENCES actes(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  requested_by    text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error', 'cancelled')),
  priority        integer NOT NULL DEFAULT 0,
  progress        integer NOT NULL DEFAULT 0,
  total           integer NOT NULL DEFAULT 0,
  step_label      text,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at    timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  result          jsonb,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX ai_jobs_queue_idx ON ai_jobs (status, next_attempt_at);
CREATE INDEX ai_jobs_user_idx ON ai_jobs (requested_by, status);
CREATE INDEX ai_jobs_acte_idx ON ai_jobs (acte_id, status);
