# --- Stage 1: build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` peut occasionnellement sortir en code 0 tout en laissant node_modules incomplet
# (bug npm connu : "Exit handler never called!"). On vérifie donc un binaire attendu et on
# relance en install propre si besoin, jusqu'à 3 essais.
RUN for i in 1 2 3; do \
      npm ci && test -x node_modules/.bin/vite && break; \
      echo "npm ci: installation incomplète (essai $i), nouvelle tentative..."; \
      rm -rf node_modules; \
    done; \
    test -x node_modules/.bin/vite
COPY . .
# Vite inline les variables VITE_* dans le bundle au build — elles doivent donc être
# fournies ici (build arg), pas seulement au démarrage du conteneur.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- Stage 2: exécution (fichiers statiques servis par Nginx) ---
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
