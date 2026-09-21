-- 0059 — Gabarits : modèle Word (.docx) à variables, par type de document.
--
-- Chaque gabarit (organisme + type de document) peut recevoir un modèle Word .docx contenant des variables {…}
-- (ex. {titre}, {numero}, {date_seance}, {expose}, {visas}, {dispositif}). À la génération, le document est fusionné
-- avec les valeurs des zones de la délibération, puis converti en PDF (LibreOffice) quand c'est demandé.
-- Le fond PDF et la configuration de mise en page restent inchangés : le .docx est une voie alternative.
ALTER TABLE render_templates ADD COLUMN IF NOT EXISTS docx_file_id integer REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE render_template_versions ADD COLUMN IF NOT EXISTS docx_file_id integer;
