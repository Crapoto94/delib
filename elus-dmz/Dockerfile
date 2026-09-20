# Espace des élus (DMZ) : compilation du front des élus SEUL, puis nginx en liste blanche.
# Contexte de construction : la racine du dépôt   ->   docker build -f elus-dmz/Dockerfile -t vibedelib-elus .
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build:elus

FROM nginx:1.27-alpine
# le modèle est rendu au démarrage avec BACKEND_HOST / BACKEND_PORT (image officielle : /etc/nginx/templates)
COPY --from=build /app/dist-elus /usr/share/nginx/html
COPY elus-dmz/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV BACKEND_HOST=backend BACKEND_PORT=3021
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/api/status >/dev/null || exit 1
