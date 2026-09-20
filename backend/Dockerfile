# VibeDélib — backend. Image minimale, exécutée par un utilisateur non privilégié.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY migrations ./migrations
COPY seeds ./seeds
# fichiers déposés (annexes, fonds de page, logo) : volume ; polices de la Ville : montées en lecture seule sur /police
RUN mkdir -p /app/storage && chown node:node /app/storage
ENV FONTS_DIR=/police
USER node
EXPOSE 3021
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3021)+'/api/status').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
