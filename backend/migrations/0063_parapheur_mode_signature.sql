-- 0063 — Parapheur : mode de signature (P12 par défaut) et téléphone du signataire (signature par SMS).
--
-- Les modes proposés par le parapheur DSIHUB sont « securise » (P12, certificat personnel du signataire),
-- « simple » (signature manuscrite mémorisée) et « sms » (code de validation envoyé par SMS). Par défaut, les
-- actes sont envoyés en signature « securise » : c'est le mode le plus fort, aligné avec la signature du maire.

ALTER TABLE parapheur_config ADD COLUMN IF NOT EXISTS signature_mode text NOT NULL DEFAULT 'securise';
ALTER TABLE parapheur_config DROP CONSTRAINT IF EXISTS parapheur_config_signature_mode_check;
ALTER TABLE parapheur_config ADD CONSTRAINT parapheur_config_signature_mode_check CHECK (signature_mode IN ('securise', 'simple', 'sms'));

-- Téléphone du signataire : requis seulement pour la signature par SMS (champs 06 12 34 56 78).
ALTER TABLE parapheur_config ADD COLUMN IF NOT EXISTS signataire_telephone text;
