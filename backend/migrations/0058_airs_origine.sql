-- 0058 — Origine AIRS des actes importés (archive / courant).
--
-- L'import AIRS marquait tous les actes au statut « archive » (pour les tenir hors circuit), y compris ceux
-- qui venaient d'AIRS « courant » (non archivés). On conserve l'origine réelle dans custom.airs.origine pour
-- ne plus présenter comme « archivés » des actes qui ne le sont pas.
UPDATE actes a
SET custom = jsonb_set(COALESCE(a.custom, '{}'::jsonb), '{airs}',
      COALESCE(a.custom->'airs', '{}'::jsonb) || jsonb_build_object('origine', i.payload->>'origine'), true)
FROM airs_links l
JOIN airs_import_items i ON i.import_id = l.import_id AND i.source_key = l.source_key
WHERE l.kind = 'acte' AND l.entity_id = a.id
  AND i.payload ? 'origine' AND a.custom->'airs' IS NOT NULL;
