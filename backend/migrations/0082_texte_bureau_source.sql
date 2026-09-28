-- 0082 — texte rédigé dans le bureau en ligne : le document bureautique devient la source.
--
-- Quand un texte (exposé, « Vu et considérant », délibéré) est paramétré pour être rédigé dans Word
-- (ONLYOFFICE/Collabora), le document édité est conservé tel quel — polices, tailles et styles compris — et c'est LUI
-- qui alimente le rendu (injection dans le modèle Word du gabarit, ou conversion PDF). Le markdown n'est plus qu'un
-- texte brut de secours (recherche, contrôle de complétude) : il n'est jamais réutilisé pour la mise en page.
--
-- `bureau_file_id` suit la version courante ; `text_versions.bureau_file_id` conserve le document de chaque version.

ALTER TABLE tracked_texts
  ADD COLUMN IF NOT EXISTS bureau_file_id bigint REFERENCES files(id);

ALTER TABLE text_versions
  ADD COLUMN IF NOT EXISTS bureau_file_id bigint REFERENCES files(id);
