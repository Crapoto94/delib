# Espace des élus (DMZ) : front autonome, aucune dépendance sur le reste du dépôt.
# Contexte de construction : ce dossier seul   ->   docker compose build (context: .)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# le modèle est rendu au démarrage avec BACKEND_HOST / BACKEND_PORT (image officielle : /etc/nginx/templates)
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV BACKEND_HOST=backend BACKEND_PORT=3121
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/api/status >/dev/null || exit 1
