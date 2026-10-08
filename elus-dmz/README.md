# Espace des élus en DMZ

Front des élus autonome (React, projet **séparé** du reste du dépôt — aucune dépendance sur `frontend/`,
build context Docker = ce dossier seul) + nginx qui ne relaie que `/api/v1/elus/` et `/api/v1/elus-auth/`.

```
Élu ──HTTPS──▶ reverse proxy DMZ ──HTTP──▶ [elus-dmz : nginx + front] ──1 port TCP──▶ backend VibeDélib (LAN)
```

## Paramètres (variables d'environnement)
Copier `.env.example` en `.env` (non versionné) sur l'hôte Docker DMZ :

| Variable | Rôle | Défaut |
|---|---|---|
| `ELUS_BACKEND_HOST` | adresse du backend sur le LAN (obligatoire) | — |
| `ELUS_BACKEND_PORT` | port publié du backend sur le LAN (la seule ouverture du pare-feu DMZ → LAN) | 3121 |
| `ELUS_DMZ_PORT` | port publié du conteneur | 5161 |

Côté backend : `ELUS_URL` (ou le paramètre `elus.url_base`) = adresse publique de l'espace (sans suffixe de page, ex. `https://elus.ivry94.fr`), utilisée dans les invitations ;
`CORS_ORIGINS` doit lister l'origine de l'APK (`https://localhost`) si l'application mobile appelle l'API directement.

## API publique des actes
La DMZ relaie en plus **un seul** préfixe d'API, en lecture seule (GET/HEAD) : `/api/v1/externe/` — l'API des applications externes (site de la Ville, portail…).
Les clés sont créées dans **Paramétrage > Clés API** de VibeDélib ; chaque clé fixe son **périmètre** : types d'actes, durée (2 ans au plus) et contenus
téléchargeables (acte seul, exposé des motifs, annexes). La DMZ ne stocke aucune clé : l'en-tête `Authorization: Bearer vd_…` (ou `X-API-Key`) est relayé et vérifié par le backend.

| Adresse | Rôle |
|---|---|
| `/api-docs/` | documentation Swagger (spécification relayée depuis `/api/v1/externe/openapi.json`) |
| `/api/v1/externe/actes` | liste et recherche (`q` titre plein texte, `motCle`, `seanceId`, `rapporteurId`, `dateDebut`/`dateFin`, `type`, `matiere`…) |
| `/api/v1/externe/seances`, `/rapporteurs`, `/types` | listes de choix pour les filtres |
| `/api/v1/externe/actes/{id}`, `/pdf`, `/expose`, `/annexes/{annexeId}` | fiche et téléchargements |

Les adresses IP autorisées d'une clé sont celles vues par le backend (`X-Forwarded-For` posé par ce nginx) : renseigner les IP des clients finaux, pas celle de la DMZ.

## Construire et lancer
```
docker compose up -d --build
```
Développement : `npm install && npm run dev` (port 5161, API proxifiée vers `http://localhost:3121`).

## Déploiement
`pulldmz.ps1`/`pulldmz.bat` à la racine du dépôt copient uniquement les fichiers suivis par git de ce
dossier vers le serveur DMZ (jamais `node_modules/` ni `dist/` locaux), puis reconstruisent et relancent
le conteneur sur place. Configuration dans `pulldmz.ini` (non versionné, voir `pulldmz.ini.example`).

## Ce que la DMZ ne contient pas
Aucune base de données, aucun secret, aucune clé d'API, aucun code de l'application de saisie. Le jeton d'un élu est signé avec un secret et
une audience propres : il est refusé par l'API des agents.
