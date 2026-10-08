-- 0086 — actes « site » : arrêtés repris du site internet de la Ville (publication historique, hors circuit de l'application).
-- Ils doivent survivre à un effacement général des données : un DELETE sur `actes` (nettoyage, reprise, script de remise à zéro) ignore ces lignes
-- sans échouer. La suppression volontaire d'un acte « site » est possible en posant, dans la transaction : SET LOCAL vibedelib.supprimer_site = 'on'.
ALTER TABLE actes ADD COLUMN IF NOT EXISTS site boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS actes_site_idx ON actes (organisme_id) WHERE site;

CREATE OR REPLACE FUNCTION actes_site_proteges() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.site AND COALESCE(current_setting('vibedelib.supprimer_site', true), '') <> 'on' THEN
    RETURN NULL;   -- ligne conservée, l'instruction se poursuit pour les autres lignes
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS actes_site_proteges ON actes;
CREATE TRIGGER actes_site_proteges BEFORE DELETE ON actes FOR EACH ROW EXECUTE FUNCTION actes_site_proteges();
