-- 0046 — « Se souvenir de moi » (D109) : session persistante de 6 mois au plus, jusqu'à la déconnexion.
ALTER TABLE sessions ADD COLUMN persistante boolean NOT NULL DEFAULT false;
