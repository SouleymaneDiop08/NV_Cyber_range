#!/bin/sh
# =============================================================================
# PID 1 du conteneur Docker-in-Docker du labo « système ferroviaire ».
#
# 1. démarre le démon Docker interne du labo ;
# 2. charge les images pré-buildées (docker save, cf. ./build-images.sh) si
#    présentes — idempotent, jamais de build en ligne dans ce cas ;
# 3. lance `docker compose up` du labo.
#
# Chaque labo a son propre démon : les réseaux .20/.30/.40 et les IP statiques
# vivent dans ce conteneur, sans collision d'IPAM entre labos.
# =============================================================================
set -e

COMPOSE_FILE="/lab/docker-compose.yml"
PROFILE="${COMPOSE_PROFILES:-core}"
DOCKERD_WAIT="${DOCKERD_WAIT_SECONDS:-300}"

# L'image rootless ne définit pas DOCKER_HOST par défaut côté client : son démon
# écoute dans le runtime dir de l'utilisateur, pas sur /var/run/docker.sock.
if [ -z "${DOCKER_HOST:-}" ] && [ "$(id -u)" -ne 0 ]; then
  DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
  export DOCKER_HOST
fi

# Secret de lancement propre à CE labo, injecté par l'orchestrateur (vérif
# locale du jeton portail, sans appel sortant). Absent = pas de SSO.
export LAB_SSO_SECRET="${LAB_SSO_SECRET:-}"
export LAB_ID="${LAB_ID:-}"

# 1. Démon Docker du labo, en arrière-plan.
dockerd-entrypoint.sh dockerd &
DOCKERD_PID=$!

# Attend que le démon réponde.
tries=0
until docker info >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt "$DOCKERD_WAIT" ]; then
    echo "[lab] le démon Docker du labo n'a pas démarré en ${DOCKERD_WAIT}s (DOCKER_HOST=${DOCKER_HOST:-défaut})" >&2
    exit 1
  fi
  sleep 1
done
echo "[lab] démon Docker prêt après ${tries}s"

# 2. Chargement des images pré-buildées (si l'image de labo en embarque).
HAVE_TARS=0
if [ -d /lab/image-tars ]; then
  for f in /lab/image-tars/*.tar; do
    [ -e "$f" ] || continue
    HAVE_TARS=1
    echo "[lab] docker load $f"
    docker load -i "$f"
  done
fi

# 3. Démarrage du laboratoire.
echo "[lab] docker compose up (profil: $PROFILE)"
cd /lab
if [ "$HAVE_TARS" -eq 1 ]; then
  # Images déjà présentes : jamais de build dans le labo (hors-ligne).
  COMPOSE_PROFILES="$PROFILE" docker compose -f "$COMPOSE_FILE" up -d --no-build
else
  # Repli dev : build à la volée (nécessite les contextes + réseau).
  COMPOSE_PROFILES="$PROFILE" docker compose -f "$COMPOSE_FILE" up -d
fi
echo "[lab] laboratoire démarré."

# Reste PID 1 tant que le démon du labo tourne.
wait "$DOCKERD_PID"
