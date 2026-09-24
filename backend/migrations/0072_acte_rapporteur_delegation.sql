-- 0072 — Délégation fonctionnelle de l'élu rapporteur.
--
-- Un élu peut porter plusieurs délégations (colonne `delegations` de la table `elus`, alimentée par le Hub DSI).
-- À la rédaction, le rapporteur choisi peut être précisé par la délégation concernée ; c'est ce libellé qui permet
-- de distinguer et de trier les dossiers d'un même élu à l'ordre du jour.

ALTER TABLE actes ADD COLUMN IF NOT EXISTS rapporteur_delegation text;
