# Front elus : meme source que le deploiement DMZ, compilee dans la copie LAN /elus.
FROM node:22-alpine AS elus-build
WORKDIR /app
COPY elus-dmz/package.json elus-dmz/package-lock.json ./
RUN npm ci
COPY elus-dmz/ ./
RUN npm run build

# Front agents.
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=elus-build /app/dist /usr/share/nginx/html/elus
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
