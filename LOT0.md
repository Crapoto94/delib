# LOT 0 — Fondations du backend

> Référence : `MANIFEST.md` v1.0 (sections 3, 5, 24, 25, 28, 29). **Backend seul** (décision D35) : le frontend démarre quand les maquettes Stitch sont livrées. L'interface de ce lot est **Swagger UI**.
> **Lot 0 réalisé le 2026-09-19 (voir §14).** Feu vert donné le 2026-09-19. Ports : backend **3021**, frontend **5160**, DMZ **5161** (D36). Le spike de la section 4 précède tout module.

## 1. Objectif

Un backend **Express 5** qui démarre, se connecte au PostgreSQL de la Ville dans son schéma `ivrydelib`, **authentifie un agent par l'AD via l'APM**, connaît ses **organismes et ses rôles**, **isole strictement** les données par organisme, résout des **paramètres hiérarchiques**, lit l'**annuaire** (agents, directions, services) derrière un **port**, **journalise** ce qu'il fait, et expose `/api/status` et `/api-docs`.

Tout ce qui viendra ensuite (actes, circuit, séances…) s'appuiera sur ce socle sans le remettre en cause : c'est pourquoi `organisme_id` et l'isolation sont posés **dès maintenant** (MOR-02).

## 2. Périmètre

| Dans le lot 0 | Hors du lot 0 |
|---|---|
| repo, Docker, `.env.example`, README, CI | frontend (attend Stitch) |
| migrations et schéma `ivrydelib` | actes, circuit, textes suivis, annexes (lot 1 et suivants) |
| authentification AD via APM, JWT, sessions | notifications et mails (lot 3, hors mail de test) |
| organismes, rôles, rattachement direction → organisme | élus, séances, commissions (lot 4) |
| `DirectoryPort` + adaptateurs + cache d'agents | IA, recherche, S²LOW, DMZ |
| paramètres hiérarchiques | |
| journal d'audit | |
| `/api/status`, Swagger, logs structurés | |
| tests d'isolation, d'authentification, de résolution des paramètres | |

## 3. Prérequis

| # | Prérequis | Statut |
|---|---|---|
| P1 | **Clé APM** (`APM_API_KEY`) avec `ad_auth`, `ad_search`, `ad_read` | **fournie** dans `.env` ; permissions à vérifier (spike S1, S2) |
| P2 | **PostgreSQL** (`10.103.130.106`, base `ivry_admin`) et droit de créer le schéma `ivrydelib` | **fourni**, mais avec l'utilisateur `postgres` (**super-utilisateur**) : un rôle dédié `ivrydelib` limité à son schéma est recommandé (voir §6) |
| P3 | **Q55** : source des directions/services et de la fiche agent | **RH Studio** (`STUDIORH_API_URL`, clé fournie) est candidat direct ; à confirmer au spike S3-S4 |
| P4 | **Clé `dsk_`** du Hub | **fournie** (`HUBDSI_API_KEY`) ; scope à vérifier |
| P5 | **Compte AD de test** | à fournir pour le spike S1 (à défaut, essais avec le compte de secours) |
| P6 | **Ports** | **décidés** : 3021 / 5160 / 5161 ; à vérifier libres sur l'hôte Docker |
| P7 | **Administrateurs de plateforme** initiaux (`BOOTSTRAP_ADMINS`) | à fournir ; en attendant, le compte de secours suffit pour amorcer |
| P8 | Organismes à créer au démarrage : **Ville** (SIREN, nom) et **CCAS** | à confirmer ; création possible ensuite par l'API |

## 4. Spike d'intégration (avant tout module)

Un court script jetable qui prouve chaque point contre les vrais services, résultats consignés dans `docs/spike-lot0.md`.

| # | Vérification | Critère de réussite |
|---|---|---|
| S1 | `POST /api/v1/ad/authenticate` avec un compte réel | succès et échec distingués ; **insensibilité à la casse** de l'identifiant vérifiée |
| S2 | `GET /api/v1/ad/user?identifier=` | récupère e-mail, nom, prénom ; note des champs réellement renvoyés |
| S3 | **Fiche agent** (direction, service, poste) : **(b) RH Studio en direct** (`agents/presence`, `agents/search`) en premier, puis (a) endpoint RH du Hub, puis (c) `oracle_query` | au moins une voie renvoie direction et service pour un agent connu, avec une **clé applicative** |
| S4 | **Liste des directions et services** | liste stable avec codes et libellés, sans les codes `$…` ; confirmation que `/api/directions-services` **n'est pas** utilisable tel quel |
| S5 | Droits PostgreSQL : `CREATE SCHEMA delib`, création et suppression d'une table de test | succès |
| S6 | Latence et délais d'attente de l'APM et du Hub | valeurs mesurées pour fixer les délais d'attente et le cache |

Si S3 ou S4 échouent, on **arrête** et on tranche Q55 avec le user avant de continuer : le rattachement des agents au CCAS en dépend.

## 5. Arborescence

```
ivrydelib/
  backend/
    server.js                     démarrage, arrêt propre
    package.json
    src/
      config/            index.js (lecture .env, validation)
      db/                pool.js, tx.js, migrate.js
      http/              app.js, errors.js, middleware/{auth,orgContext,validate,rateLimit}.js
      shared/            logger.js, ids.js, time.js
      ports/             directory.port.js, auth.port.js
      adapters/          apm-ad.js, hub-org.js, rh-agent.js, fake-directory.js
      modules/
        auth/            auth.routes.js, auth.controller.js, auth.service.js, sessions.repository.js
        me/              me.routes.js
        organismes/      routes, controller, service, repository
        directory/       routes, controller, service (cache agent_ref)
        settings/        routes, service (résolution hiérarchique)
        audit/           audit.service.js, routes
        health/          status.routes.js
    migrations/          0001_init.sql … 0005_….sql
    test/                unit/, integration/, fixtures/
    docs/                spike-lot0.md
  docker-compose.yml
  .env.example
  README.md
```

Règles du guide respectées : fichiers courts (~300 lignes max), un module par domaine (`routes / controller / service / repository`), appels APM et Hub **uniquement** dans `adapters/`, aucune URL ni secret en dur.

## 6. Configuration

### 6.1 Le `.env` fourni (lu, valeurs masquées)

Il est **hérité du projet PGC** (« Plateforme de Gestion de Crise ») : il contient des variables qui n'ont rien à faire ici.

| Variable(s) | Usage |
|---|---|
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | **utilisées**. ⚠ Utilisateur `postgres` (super-utilisateur) : créer un rôle `ivrydelib` propriétaire du seul schéma `ivrydelib`. |
| `PGC_SCHEMA=ivrydelib` | **renommée `DB_SCHEMA`** (nom du schéma retenu : `ivrydelib`) |
| `APM_API_URL`, `APM_API_KEY` | **utilisées** (AD, mail, SMS, IA plus tard) |
| `HUBDSI_API_URL`, `HUBDSI_API_KEY` | **utilisées** (élus, organisation) ; URL provisoire en IP HTTP |
| `STUDIORH_API_URL`, `STUDIORH_API_KEY` | **utilisées** : agents et organisation (Q55) |
| `VILLE_ALLOW_SELF_SIGNED_CERTS=true` | **gérée client par client** (APM, Hub, RH Studio) ; jamais `NODE_TLS_REJECT_UNAUTHORIZED=0` ; préférer `VILLE_CA_FILE` (SEC-16) |
| `LOCAL_ADMIN_USERNAME/PASSWORD` | **compte de secours** (SEC-15) |
| `ANALYSEMAIL_*`, `GRAPH_*`, `GRAPH_CRISIS_*` | **inutilisées** : à **retirer** de ce fichier (moindre privilège ; le secret Entra n'a rien à faire ici) |
| `PORT`, `JWT_SECRET`, `BOOTSTRAP_ADMINS`, `CORS_ORIGINS`… | **à ajouter** (voir 6.2) |

Le fichier est enregistré en **Windows-1252** (accents illisibles dans les commentaires) : l'enregistrer en **UTF-8** (guide §6). Il n'est **jamais versionné** (`.gitignore`).

### 6.2 `.env.example` cible

```
POSTGRES_HOST=  POSTGRES_PORT=5432  POSTGRES_DB=ivry_admin  POSTGRES_USER=  POSTGRES_PASSWORD=
DB_SCHEMA=ivrydelib
APM_API_URL=https://api.ivry.local      APM_API_KEY=
HUBDSI_API_URL=                         HUBDSI_API_KEY=
STUDIORH_API_URL=                       STUDIORH_API_KEY=
VILLE_CA_FILE=                          # autorité de certification interne (préféré)
VILLE_ALLOW_SELF_SIGNED_CERTS=false     # repli, limité aux clients APM/Hub/RH Studio
PORT=3021
NODE_ENV=production
JWT_SECRET=  JWT_TTL=8h  SESSION_MAX_HOURS=24
BOOTSTRAP_ADMINS=                       # identifiants AD, séparés par des virgules
LOCAL_ADMIN_ENABLED=true  LOCAL_ADMIN_USERNAME=  LOCAL_ADMIN_PASSWORD=
CORS_ORIGINS=http://localhost:5160
RLS_ENABLED=false
DIRECTORY_CACHE_TTL_MIN=60
LOG_LEVEL=info
```

Le démarrage **échoue explicitement** si une variable obligatoire manque.

## 7. Modèle de données du lot 0 (migrations numérotées)

| Migration | Tables |
|---|---|
| `0001_init` | schéma `ivrydelib`, `schema_migrations(version pk, applied_at)` |
| `0002_organismes` | `organismes(id, code unique, nom, type, siren, adresse, logo_path, couleurs jsonb, vocabulaire jsonb, actif, created_at, updated_at)` ; `organisme_directions(organisme_id, direction_code unique, direction_label)` — **une direction appartient à un seul organisme** |
| `0003_agents_roles` | `agent_ref(username pk en minuscules, matricule, nom, prenom, email, direction_code, service_code, poste, actif, source, first_login_at, updated_at)` ; `user_org_roles(username, organisme_id nullable, role, created_by, created_at)` ; `sessions(jti pk, username, issued_at, expires_at, revoked_at)` ; `local_accounts(username pk, password_hash, disabled, created_at, last_login_at)` |
| `0004_settings` | `settings(scope, scope_id, key, value jsonb, updated_by, updated_at, pk(scope, scope_id, key))` avec `scope ∈ {platform, organisme, instance, type_acte}` |
| `0005_audit` | `audit_log(id, at timestamptz, organisme_id, actor, on_behalf_of, action, entity, entity_id, before jsonb, after jsonb, ip)` — **sans `UPDATE` ni `DELETE`** (droits et déclencheur) |
| `0006_onboarding` | `user_onboarding(username, tour_id, tour_version, status, steps_done jsonb, started_at, completed_at, skipped_at, pk(username, tour_id))` |

Rôles du lot 0 : `platform_admin` (sans organisme), `org_admin`, `scc`, `teletransmission`, `lecteur`. Les valideurs ne sont **pas** des rôles : ils sont résolus par le circuit (lot 3). Toutes les dates en `TIMESTAMPTZ`, fuseau `Europe/Paris` ; requêtes paramétrées `$1…` uniquement.

## 8. Comportements à livrer

**Authentification (`/api/v1/auth`)**
- `POST /login { username, password }` → APM `ad/authenticate` → lecture de la fiche (`ad/user`) → **upsert `agent_ref`** → rôles → **JWT** (`exp` = `JWT_TTL`) et ligne `sessions`. Identifiant **normalisé en minuscules** ; 401 sans détail sur la cause ; limitation de débit et verrouillage progressif.
- `POST /refresh` (dans la limite de `SESSION_MAX_HOURS`), `POST /logout` (révocation du `jti`).
- Les administrateurs de plateforme sont **amorcés** depuis `BOOTSTRAP_ADMINS` au démarrage, puis gérés en base.
- **Compte de secours** (SEC-15) : `POST /auth/login-local`, créé au démarrage s'il n'existe pas (mot de passe **haché**, plus jamais relu depuis `.env`), rôle `platform_admin`, limitation de débit renforcée, chaque usage audité, désactivable (`LOCAL_ADMIN_ENABLED`).

**Profil et contexte d'organisme**
- `GET /api/v1/me` : identité, organismes accessibles, rôles par organisme.
- Le contexte est fourni par l'en-tête **`X-Organisme-Id`** ; le middleware `orgContext` **refuse** un organisme non autorisé pour l'utilisateur.

**Tutoriel de première connexion (UX-20 à 26)**
- `GET /api/v1/me` indique les tutoriels à proposer ; `GET /api/v1/me/onboarding` et `PUT /api/v1/me/onboarding/:tourId` `{ status, stepsDone }` enregistrent l'avancement (**terminé**, **ignoré**, version). Une **nouvelle version** de tutoriel est reproposée. Le contenu et la mise en scène restent côté frontend (Stitch).

**Isolation (MOR-02)**
- Une **couche d'accès unique** (`repository` de base) exige un contexte d'organisme et ajoute `organisme_id` à chaque requête ; une requête sans contexte **échoue** au lieu de tout renvoyer.
- Option `RLS_ENABLED` : `SET LOCAL app.organisme_ids` dans la transaction et politiques *Row-Level Security* sur les tables métier — **défense supplémentaire**, désactivée par défaut au lot 0, testée.

**Organismes**
- `GET/POST/PUT /api/v1/organismes` (administrateur de plateforme) ; `PUT /organismes/:id/direction-map` (correspondance direction → organisme, une direction n'appartient qu'à un organisme) ; amorçage de l'organisme **Ville**.

**Annuaire (`DirectoryPort`)**
- Interface : `searchAgents(q)`, `getAgent(id)`, `listDirections()`, `listServices(directionCode)`.
- Adaptateurs : `apm-ad` (recherche et fiche AD), `hub-org` / `rh-agent` (selon Q55), `fake-directory` (fixtures pour le développement et les tests).
- **Cache** dans `agent_ref` avec `DIRECTORY_CACHE_TTL_MIN` ; une panne de l'APM ou du Hub ne bloque pas la lecture des données déjà connues (INT-01). Les identités conservées dans l'audit sont **dénormalisées** (INT-02).
- Endpoints : `GET /api/v1/directory/directions`, `…/agents/search?q=`, `…/agents/:username`.

**Paramètres (MOR-10, MOR-11)**
- `GET/PUT /api/v1/organismes/:id/settings`. Résolution **plateforme → organisme → instance → type d'acte**, la valeur la plus spécifique l'emporte, et la réponse indique l'**origine** de chaque valeur.

**Audit**
- Chaque écriture des modules du lot (organismes, rôles, correspondance, paramètres, connexion, révocation) produit une ligne d'audit avec **avant / après**. `GET /api/v1/audit` (administrateur).

**Supervision et documentation**
- `GET /api/status` : base, APM, Hub, version, migrations appliquées ; sans donnée sensible.
- Swagger UI sur `/api-docs`, spécification sur `/swagger.json`, générées par `swagger-jsdoc`.
- Erreurs normalisées `{ error, code }`, codes HTTP cohérents, pagination `limit/offset`, logs structurés (niveau, horodatage, identifiant de requête), secrets masqués.

## 9. Décisions techniques à confirmer

| Sujet | Proposition | Pourquoi |
|---|---|---|
| Runtime | **Node 22 LTS** | version maintenue ; à aligner sur l'hôte Docker |
| Migrations | **runner maison** : fichiers SQL numérotés, transactionnels, table `schema_migrations` | conforme au guide, sans dépendance |
| Validation des entrées | **zod** | schémas partagés avec Swagger, erreurs claires |
| Tests | **Vitest + supertest**, base PostgreSQL 16 jetable en conteneur | rapide, isolation réelle testée sur une vraie base |
| Logs | **pino** | structurés, masquage de champs |
| Sécurité HTTP | **helmet**, **express-rate-limit**, CORS restreint | exigences du guide |
| Dépendances | uniquement celles du guide, plus les quatre ci-dessus | le guide fixe la base, ces ajouts sont mineurs |

## 10. Tests et intégration continue

- **Isolation** : deux organismes, deux utilisateurs ; lecture, écriture, suppression et recherche croisées **refusées** ; requête sans contexte **échoue** ; mêmes tests avec `RLS_ENABLED=true`.
- **Authentification** : casse de l'identifiant, mauvais mot de passe, session expirée, session révoquée, verrouillage, rôles.
- **Paramètres** : résolution hiérarchique et origine, surcharges, valeur absente.
- **Annuaire** : contrats des adaptateurs sur **fixtures enregistrées** (aucun identifiant réel dans les tests) ; comportement avec l'APM ou le Hub en panne.
- **Audit** : une écriture = une ligne ; `UPDATE` et `DELETE` sur l'audit **refusés**.
- **Migrations** : rejouables sur base vide, refus si un numéro est manquant.
- **CI** : lint, tests, build de l'image, `docker-compose up` puis `GET /api/status`.

## 11. Critères d'acceptation du lot 0

1. `docker-compose up -d --build` démarre le backend ; `GET /api/status` renvoie l'état de la base, de l'APM et du Hub.
2. Un agent se connecte avec son identifiant AD **quelle que soit la casse** ; `GET /api/v1/me` renvoie son profil, ses organismes et ses rôles.
3. Un administrateur de plateforme crée l'organisme CCAS, y rattache une direction, et l'audit en garde la trace avec l'avant et l'après.
4. Un utilisateur du CCAS ne lit, n'écrit et ne trouve **aucune** donnée de la Ville, avec et sans RLS ; ces contrôles sont des tests automatisés qui passent.
5. Un paramètre défini au niveau plateforme est surchargé par le CCAS ; la réponse indique l'origine de la valeur.
6. Les agents et les directions sont lus via `DirectoryPort` ; avec l'APM coupé, les données déjà en cache restent disponibles.
7. `/api-docs` documente **tous** les endpoints du lot ; aucun secret ni URL n'est en dur ; la CI est verte.
8. Le compte de secours se connecte quand l'AD est indisponible ; chaque usage est audité ; son mot de passe n'est jamais stocké en clair.
9. À la première connexion d'un agent, `GET /api/v1/me` propose le tutoriel ; après « terminé » ou « ignoré » il n'est plus proposé ; une nouvelle version du tutoriel est reproposée.

## 12. Risques

| Risque | Parade |
|---|---|
| Source des directions / fiche agent inadaptée (Q55) | spike S3-S4 **avant** de coder l'annuaire ; sinon fixtures et adaptateur dédié demandé au Hub |
| Droits PostgreSQL insuffisants sur le schéma partagé | vérifié en S5 |
| Casse des identifiants AD | normalisation en minuscules et test dédié (S1) |
| APM lente ou indisponible | délais d'attente mesurés (S6), cache d'annuaire, dégradation gracieuse |
| Isolation contournée par une requête oubliée | couche d'accès unique, test d'étanchéité par module, RLS en défense |
| `JWT` sans expiration (appdsi) reproduit par habitude | expiration obligatoire et sessions révocables |
| Le `.env` fourni utilise le super-utilisateur `postgres` et des secrets sans rapport (Entra, analyse de mail) | rôle PostgreSQL dédié, variables inutiles retirées |
| Certificats auto-signés | acceptés **client par client** avec l'autorité fournie, jamais globalement |

## 13. Ensuite

**Lot 1** : fiche d'acte et référentiels (types, natures, rubriques, matières importées), droits de rédaction, annexes, commentaires — toujours en API seule tant que les maquettes Stitch ne sont pas livrées.

## 14. Résultats (2026-09-19)

Code dans `backend/` (voir `backend/README.md`). **105 tests** (11 unitaires + 94 d'intégration sur PostgreSQL), lint sans erreur.

| # | Critère d'acceptation | Statut |
|---|---|---|
| 1 | `docker-compose up` démarre le backend ; `/api/status` renvoie base, APM, Hub | **partiel** : le backend démarre et `/api/status` répond (base, APM, Hub) avec `node server.js` contre les vrais services ; le `docker-compose` est écrit mais **non testé** (Docker absent du poste) |
| 2 | Connexion AD insensible à la casse ; `/me` renvoie profil, organismes, rôles | **partiel** : casse normalisée et testée (faux AD) ; `/me` vérifié en réel avec le compte de secours ; **connexion AD réelle non essayée** (aucun compte de test fourni, S1) |
| 3 | Création du CCAS, rattachement d'une direction, audit avant/après | **fait** (tests) ; la direction `J = DIRECTION CCAS` existe dans l'organigramme réel |
| 4 | Étanchéité Ville / CCAS, avec et sans RLS | **fait** : 40 tests d'isolation et de RLS ; RLS vérifié avec un rôle non propriétaire |
| 5 | Paramètre plateforme surchargé par le CCAS, origine indiquée | **fait** |
| 6 | Annuaire via `DirectoryPort`, cache si l'APM ou le Hub est coupé | **fait** : Hub réel lu (19 directions, agents), cache et erreur 502 testés |
| 7 | `/api-docs` documente tous les endpoints ; rien en dur ; CI verte | **fait** pour la documentation (25 chemins, test de couverture automatique) et l'absence de secret ; **CI non créée** (aucun dépôt distant) ; `npm run check` = lint + tests |
| 8 | Compte de secours (AD indisponible), audité, mot de passe haché | **fait** |
| 9 | Tutoriel de première connexion : proposé, puis plus, nouvelle version reproposée | **fait** |

**Reste pour clore le lot** : essai d'une connexion AD réelle (S1), test du `docker-compose` sur un poste avec Docker, rôle PostgreSQL dédié (le `.env` utilise `postgres`), CI.
