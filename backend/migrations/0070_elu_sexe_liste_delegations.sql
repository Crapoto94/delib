-- 0070 — Élus : sexe, liste politique et délégations fournis par le Hub DSI.
--
-- L'API DSIHUB (/api/ville/elus) renseigne désormais :
--   sexe       : « M » ou « F » (complète la civilité « M. » / « Mme » de la migration 0069) ;
--   liste      : le nom de la liste / groupe politique (« IVRY AVANT TOUT »…), qui remplace le repli
--                historique sur la colonne « delegation » ;
--   delegations: le tableau des délégations fonctionnelles de l'élu (« Politiques culturelles »…).
-- Ces informations sont conservées localement ; les délégations serviront ultérieurement.

ALTER TABLE elus ADD COLUMN IF NOT EXISTS sexe text;
ALTER TABLE elus ADD COLUMN IF NOT EXISTS liste text;
ALTER TABLE elus ADD COLUMN IF NOT EXISTS delegations jsonb NOT NULL DEFAULT '[]'::jsonb;
