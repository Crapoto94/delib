# Espace des élus en DMZ

Front des élus (React, bundle **séparé** de l'application des agents) + nginx qui ne relaie que `/api/v1/elus/` et `/api/v1/elus-auth/`.

```
Élu ──HTTPS──▶ reverse proxy DMZ ──HTTP──▶ [elus-dmz : nginx + front] ──1 port TCP──▶ backend VibeDélib (LAN)
```

## Paramètres (variables d'environnement)
| Variable | Rôle | Défaut |
|---|---|---|
| `ELUS_BACKEND_HOST` | adresse du backend sur le LAN (obligatoire) | — |
| `ELUS_BACKEND_PORT` | port du backend (la seule ouverture du pare-feu DMZ → LAN) | 3021 |
| `ELUS_DMZ_PORT` | port publié du conteneur | 5161 |

Côté backend : `ELUS_URL` (ou le paramètre `elus.url_base`) = adresse publique de l'espace, utilisée dans les invitations ;
`CORS_ORIGINS` doit lister l'origine de l'APK (`https://localhost`) si l'application mobile appelle l'API directement.

## Construire et lancer
```
docker compose -f elus-dmz/docker-compose.yml up -d --build
```
Développement : `cd frontend && npm run dev:elus` (port 5161, API proxifiée vers le backend) ou `http://localhost:5160/elus.html`.

## Ce que la DMZ ne contient pas
Aucune base de données, aucun secret, aucune clé d'API, aucun code de l'application de saisie. Le jeton d'un élu est signé avec un secret et
une audience propres : il est refusé par l'API des agents.
