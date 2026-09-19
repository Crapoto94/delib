# IvryDélib — backend

Gestion des délibérations pour la Ville et ses organismes (CCAS…). Ce dossier contient le **lot 0** (fondations) ;
la spécification complète est dans `../MANIFEST.md` et le plan du lot dans `../LOT0.md`.

**Stack** : Node.js ≥ 22 · Express 5 · PostgreSQL (schéma dédié `ivrydelib`) · zod · JWT · pino · Swagger UI.

## Démarrer

```bash
cd backend
npm install
cp .env.example ../.env      # puis renseigner les valeurs (jamais versionné)
npm run migrate              # crée le schéma et applique les migrations (facultatif : AUTO_MIGRATE=true le fait au démarrage)
npm start                    # http://localhost:3021  ·  API : /api-docs  ·  état : /api/status
```

Variables obligatoires : `POSTGRES_*`, `APM_API_URL/KEY`, `HUBDSI_API_URL/KEY`, `JWT_SECRET` (≥ 24 caractères).
Le démarrage échoue en listant ce qui manque. Voir `.env.example`.

## Ce que fait le lot 0

| Domaine | Détail |
|---|---|
| Authentification | AD via l'APM (identifiant insensible à la casse), JWT à expiration, sessions révocables, verrouillage progressif, compte de secours local haché |
| Organismes | Ville (par défaut), CCAS… ; rôles par organisme ; rattachement d'un agent à un organisme **par sa direction** |
| Isolation | filtrage par `organisme_id` dans une couche d'accès unique, tests d'étanchéité, Row-Level Security en défense supplémentaire |
| Annuaire | `DirectoryPort` (Hub DSI : organigramme RH et fiche agent), cache, dégradation gracieuse |
| Paramètres | hiérarchie plateforme → organisme → instance → type d'acte, avec l'origine de chaque valeur |
| Audit | journal immuable (ni UPDATE, ni DELETE, ni TRUNCATE), état avant/après |
| Tutoriel | état de la visite de première connexion par utilisateur (le contenu est côté frontend) |
| Supervision | `GET /api/status`, logs structurés sans secret, Swagger généré depuis le registre de routes |

## Tests

```bash
npm test          # 105 tests : unitaires + intégration sur une vraie base PostgreSQL
npm run check     # lint + tests
npm run spike     # vérifie les services réels (APM, Hub, PostgreSQL), sans donnée personnelle
node scripts/smoke.js   # parcours réel contre un backend démarré, avec le compte de secours
```

Les tests d'intégration utilisent la base du `.env` mais **un schéma jetable par fichier** (`ivrydelib_test_<aléa>`),
supprimé à la fin ; le schéma réel n'est jamais touché. L'AD, l'APM et le Hub sont remplacés par de faux adaptateurs.

## Organisation

```
server.js                 démarrage, arrêt propre
src/config                lecture et validation de l'environnement
src/db                    pool PostgreSQL, exécuteur de migrations
src/ports, src/adapters   contrats (AuthPort, DirectoryPort) et implémentations (APM, Hub, faux)
src/http                  registre de routes (accès + validation + documentation), middlewares, Swagger
src/modules/<domaine>     routes / service : auth, me, organismes, settings, directory, audit, health
migrations/               0001…0007, numérotées, transactionnelles, somme de contrôle vérifiée
```

Règles : aucun secret ni URL en dur · requêtes paramétrées · toute écriture auditée · fichiers courts · un module par domaine.

## Sécurité en production

- Se connecter avec un **rôle PostgreSQL dédié** propriétaire du seul schéma `ivrydelib` (et non `postgres`) ; c'est aussi ce qui rend les politiques RLS effectives (`RLS_ENABLED=true`).
- Renseigner `VILLE_CA_FILE` plutôt que d'accepter les certificats auto-signés (`VILLE_ALLOW_SELF_SIGNED_CERTS` est limité aux clients APM et Hub).
- `CORS_ORIGINS` est obligatoire ; `JWT_SECRET` long et unique ; ne jamais versionner `.env`.

## Docker

`docker-compose up -d --build` à la racine construit le backend (port 3021). Non testé sur le poste de développement (Docker absent).

## Tester à la main (développement)

1. `.env` (à la racine du dépôt) : `JWT_SECRET`, et pour le poste de développement `DEV_LOGIN_PASSWORD` — ce mot de passe commun valide **n'importe quel identifiant sans interroger l'AD** (refusé en production, chaque usage est audité).
2. Backend : `node server.js` (port 3021) ; frontend : `npm --prefix ../frontend run dev` (port 5160, proxy `/api`).
3. Jeu de démonstration : `node scripts/seed-demo.js` (`--reset` pour le recréer) — agents fictifs `demo.*` sur l'organigramme réel du Hub, titulaires, 39 élus, les 4 commissions, 3 séances et des dossiers à tous les stades. Aucun mail n'est envoyé.
4. Police de la Ville (Interstate) : déposer les `.otf` dans `police/interstate-2/` à la racine (ou `FONTS_DIR`) ; jamais versionnée (licence). Sans elle, les PDF retombent sur Times.
5. `SCHEDULER_ENABLED=true` active les relances et l'envoi des mails ; `MAIL_REDIRECT_TO=adresse` redirige tous les mails (mode recette).
