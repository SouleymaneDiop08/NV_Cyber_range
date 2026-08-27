# --- Stage 1: build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- Stage 2: dépendances de production uniquement ---
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# --- Stage 3: image d'exécution, minimale ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# CLI docker uniquement : le rôle `control` pilote le démon Docker de l'hôte via
# /var/run/docker.sock (run / start / stop / pause / rm / exec / inspect), cf.
# DindComposeDriver. Le plugin `compose` n'est pas requis côté hôte — le
# `docker compose` du labo s'exécute DANS le conteneur de labo (l'orchestrateur
# ne fait que `docker exec <labId> docker compose ps` pour lire l'état).
# Le rôle `gateway` embarque le binaire sans jamais s'en servir : il n'a aucun
# socket Docker monté (cf. docker-compose.yml).
RUN apk add --no-cache docker-cli
# Pas d'utilisateur non-root ici : sur le rôle `control`, le socket Docker monté
# donne de toute façon un accès équivalent root au démon de l'hôte, un user
# applicatif dédié dans le conteneur n'apporterait aucune isolation réelle —
# c'est précisément pourquoi ce rôle ne publie aucun port.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
EXPOSE 4100
CMD ["node", "dist/main.js"]
