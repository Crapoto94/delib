-- 0016 — identité de l'organisme : coordonnées et logo (le logo est aussi celui de l'application et des PDF).
ALTER TABLE organismes
  ADD COLUMN contact           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { adresse2, codePostal, ville, telephone, email, siteWeb, signataire, signataireQualite }
  ADD COLUMN logo_mime         text,
  ADD COLUMN logo_sha256       text,
  ADD COLUMN logo_updated_at   timestamptz;
