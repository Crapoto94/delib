-- 0047 — passerelle SMS : mode « apm » (API de la Ville) en plus de « simulation » et « http » (D109).
ALTER TABLE sms_journal DROP CONSTRAINT IF EXISTS sms_journal_mode_check;
ALTER TABLE sms_journal ADD CONSTRAINT sms_journal_mode_check CHECK (mode IN ('simulation', 'http', 'apm'));
