-- 0065 — Acte rédigé hors application : document source (PDF ou Word) joint au dossier.
--
-- Un rédacteur peut, au lieu de composer le texte dans VibeDélib, joindre le document déjà rédigé (PDF ou Word).
-- Dans ce cas l'acte n'est plus composé à partir des textes suivis : c'est ce document qui fait foi, et il n'est pas
-- corrigeable dans l'application en cours de circuit. `document_source_pdf_file_id` porte la version PDF consultable
-- (le Word est converti ; si la trame doit être ajoutée, l'en-tête / le pied de page du gabarit y sont posés).
-- `document_source_trame` dit si la trame était déjà présente dans le document ou si elle a été ajoutée.

ALTER TABLE actes ADD COLUMN IF NOT EXISTS document_source_file_id integer REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE actes ADD COLUMN IF NOT EXISTS document_source_pdf_file_id integer REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE actes ADD COLUMN IF NOT EXISTS document_source_trame text;
ALTER TABLE actes DROP CONSTRAINT IF EXISTS actes_document_source_trame_check;
ALTER TABLE actes ADD CONSTRAINT actes_document_source_trame_check CHECK (document_source_trame IN ('presente', 'a_ajouter'));
