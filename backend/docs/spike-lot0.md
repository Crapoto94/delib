# Spike lot 0 — résultats

Exécuté le 2026-09-19 avec `node scripts/spike-lot0.js` contre les services réels (aucune donnée personnelle consignée : uniquement statuts, noms de champs et comptages).

| # | Vérification | Résultat | Détail |
|---|---|---|---|
| S5 | PostgreSQL : connexion, création d'un schéma jetable | **OK** | PostgreSQL 16.13, connexion en 78 ms. L'utilisateur du `.env` est **super-utilisateur** (à remplacer par un rôle dédié). Extensions disponibles : `pg_trgm`, `pgcrypto`, `unaccent` ; **`pgvector` non disponible** (recherche sémantique impossible en l'état, Q47). |
| S6 | APM `GET /api/status` | **OK** | 200 en 64 ms |
| S2 | APM `ad/search`, `ad/user` | **OK** | 142 ms et 194 ms. Champs de recherche : `dn, cn, sn, givenName, displayName, sAMAccountName, mail`. La fiche complète contient aussi `memberOf`, `whenCreated`, `userAccountControl`, etc. |
| S1 | APM `ad/authenticate` (insensibilité à la casse) | **non exécuté** | aucun compte AD de test fourni. À exécuter : `SPIKE_AD_USER=… SPIKE_AD_PASS=… node scripts/spike-lot0.js` (la casse est de toute façon normalisée en minuscules par le backend). |
| IA | APM `GET /api/v1/ai/models` | **OK** | 200 en 46 ms : la clé APM a bien accès à l'IA interne. |
| S4 | Hub `GET /api/ville/config`, `/api/ville/elus` | **OK** | 50 élus (`id, nom, prenom, email, telephone, role, delegation`). |
| S4 | Hub `GET /api/directions-services` | **OK mais inutilisable** | renvoie `directions, services, dirServicesMap` **dérivés des réunions**, pas l'organigramme RH. |
| S4 | Hub `GET /api/admin/rh/services-tree` | **OK** | **19 directions** avec services (`code`, `label`), clé `dsk_` suffisante. Contient `J = DIRECTION CCAS`. |
| S4 | Hub `GET /api/admin/rh/organisation-chart` | **OK** | 17 directions avec `responsable`, `responsable_poste`, `responsable_role`, `vacant`, `ambiguite`, `services`, `secteurs`. Sert de **suggestion** pour la table des titulaires. |
| S3 | Hub `GET /api/infra/rh-studio/agents/search` | **OK** | fiche agent : `username, displayName, email, service, direction, poste, matricule, hasAd`. **La direction est un libellé** (« DIRECTION DES SYSTEMES D'INFORMATION »), pas un code. |
| S3 | Hub `GET /api/infra/agents/presence?email=` | **OK** | `found`, `agent` : `id, nom, prenom, email, matricule, service, direction, fonction, present, status`. |
| S3 | RH Studio en direct (`STUDIORH_API_URL`) | **KO** | redirection 307 vers `/api/auth/signin` : l'authentification n'est pas une simple clé d'API avec l'en-tête testé. **Non nécessaire** : le Hub expose les mêmes données. |
| — | Hub `GET /api/admin/rh/encadrants`, `/api/calendrier-dsi/agents` | OK | 72 encadrants, 32 agents DSI (non utilisés au lot 0). |

## Conclusions

1. **Q55 est résolue** : tout passe par le Hub avec la clé `dsk_` fournie — organigramme (`services-tree`, `organisation-chart`) et fiche agent (`rh-studio/agents/search`, `agents/presence`). Aucune demande supplémentaire à l'admin Hub.
2. La direction d'un agent est un **libellé** : le backend la résout en **code** grâce à l'organigramme (comparaison sans accents ni casse). Vérifié en test.
3. La direction **CCAS** existe dans l'organigramme (code `J`) : le rattachement direction → organisme (D22) est directement exploitable.
4. `pgvector` n'est pas installable sur ce PostgreSQL : la recherche sémantique (IA-71) restera optionnelle ; le plein texte (`unaccent`, `pg_trgm`) est disponible.
5. À faire côté DSI : remplacer l'utilisateur `postgres` par un rôle dédié au schéma `ivrydelib`, et fournir un compte AD de test pour S1.
