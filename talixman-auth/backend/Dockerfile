# --- Stage 1: build (deps de dev incluses, nécessaires à `nest build`) ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci` peut occasionnellement sortir en code 0 tout en laissant node_modules incomplet
# (bug npm connu : "Exit handler never called!"). On vérifie donc un binaire attendu et on
# relance en install propre si besoin, jusqu'à 3 essais.
RUN for i in 1 2 3; do \
      npm ci && test -x node_modules/.bin/nest && break; \
      echo "npm ci: installation incomplète (essai $i), nouvelle tentative..."; \
      rm -rf node_modules; \
    done; \
    test -x node_modules/.bin/nest
COPY . .
RUN npm run build

# --- Stage 2: dépendances de production uniquement ---
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN for i in 1 2 3; do \
      npm ci --omit=dev && test -f node_modules/@prisma/client/package.json && break; \
      echo "npm ci --omit=dev: installation incomplète (essai $i), nouvelle tentative..."; \
      rm -rf node_modules; \
    done; \
    test -f node_modules/@prisma/client/package.json

# --- Stage 3: image d'exécution, minimale et non-root ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
USER app
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
