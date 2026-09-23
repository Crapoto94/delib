-- 0071 — Décisions et arrêtés : vus et considérants + « décide », exposé facultatif.
--
-- Les types d'acte sont semés au démarrage en « ON CONFLICT DO NOTHING » : les lignes « Décision » et « Arrêté »
-- créées par une version antérieure conservent leur ancienne fiche. Cette migration met à jour la fiche plateforme
-- (sans écraser une surcharge locale par organisme) : l'exposé des motifs devient facultatif, les vus et considérants
-- redeviennent requis (la décision n'est plus « sans visas »).
--
-- Elle complète aussi les textes manquants des décisions en cours : exposé (facultatif, désormais proposé) et
-- vus et considérants (requis). Les actes signés ou archivés ne sont pas touchés.

UPDATE ref_items
SET meta = (COALESCE(meta, '{}'::jsonb) - 'visas') || '{"expose":"optional"}'::jsonb
WHERE kind = 'type_acte' AND code IN ('decision', 'arrete') AND organisme_id IS NULL;

-- Exposé des motifs des décisions en cours (les arrêtés en avaient déjà un).
INSERT INTO tracked_texts (organisme_id, acte_id, deliberation_id, kind)
SELECT a.organisme_id, a.id, NULL, 'expose'
FROM actes a JOIN ref_items t ON t.id = a.type_id
WHERE t.kind = 'type_acte' AND t.code = 'decision'
  AND a.statut NOT IN ('signe', 'archive', 'adopte', 'rejete', 'publie', 'transmis', 'ar_recu', 'executoire')
ON CONFLICT DO NOTHING;

-- Vus et considérants des décisions et arrêtés en cours.
INSERT INTO tracked_texts (organisme_id, acte_id, deliberation_id, kind)
SELECT a.organisme_id, a.id, d.id, 'visas'
FROM actes a JOIN ref_items t ON t.id = a.type_id JOIN deliberations d ON d.acte_id = a.id
WHERE t.kind = 'type_acte' AND t.code IN ('decision', 'arrete')
  AND a.statut NOT IN ('signe', 'archive', 'adopte', 'rejete', 'publie', 'transmis', 'ar_recu', 'executoire')
ON CONFLICT DO NOTHING;
