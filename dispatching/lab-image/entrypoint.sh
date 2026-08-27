#!/bin/sh
# =============================================================================
# PID 1 du conteneur Docker-in-Docker d'un labo dispatching.
#
# 1. démarre le démon Docker du labo (via l'entrypoint de l'image dind) ;
# 2. charge les images pré-buildées (docker save, cf. ../build-images.sh) si
#    présentes — idempotent ;
# 3. lance `docker compose up` du labo avec le profil demandé (COMPOSE_PROFILES,
#    défaut : core).
#
# Chaque labo a son propre démon : les réseaux L1/L2/L3 et les IP statiques
# vivent dans ce conteneur, sans collision d'IPAM entre labos. Ce script est
# ré-exécuté à chaque `docker start` du conteneur (l'entrée recharge/relance le
# compose de façon idempotente).
# =============================================================================
set -e

COMPOSE_FILE="/lab/docker-compose.yml"
PROFILE="${COMPOSE_PROFILES:-core}"

# Délai d'attente du démon interne. Le mode rootless est nettement plus lent à
# démarrer qu'en root (mise en place du user namespace + première
# initialisation du volume de données) : une minute ne suffit pas.
DOCKERD_WAIT="${DOCKERD_WAIT_SECONDS:-300}"

# L'image rootless ne définit PAS DOCKER_HOST : son démon écoute dans le
# runtime dir de l'utilisateur, alors que le client cherche par défaut
# /var/run/docker.sock. Sans cette ligne, `docker info` échoue indéfiniment
# alors que le démon tourne parfaitement.
if [ -z "${DOCKER_HOST:-}" ] && [ "$(id -u)" -ne 0 ]; then
  DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
  export DOCKER_HOST
fi

# Port mirroring tc+gretap des routeurs : réservé au profil `full`. Il exige les
# modules noyau ip_gre/gretap côté HÔTE (un conteneur ne peut pas les charger,
# a fortiori en rootless). Le laisser actif hors `full` ferait échouer la
# configuration des routeurs sans rien apporter — le routage L1/L2<->L3
# lui-même (ip_forward + iptables) ne dépend pas de ces tunnels.
if [ "$PROFILE" = "full" ]; then
  HEDGEHOG_ENABLE="${HEDGEHOG_ENABLE:-true}"
else
  HEDGEHOG_ENABLE=false
fi
export HEDGEHOG_ENABLE

# Secret de lancement propre à CE labo, injecté par l'orchestrateur. Il permet
# aux superviseurs de vérifier LOCALEMENT le jeton signé par le portail, sans
# aucun appel sortant — le réseau du labo reste totalement cloisonné.
# Absent = les superviseurs démarrent sans lancement authentifié.
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
echo "[lab] docker compose up (profil: $PROFILE, mirroring gretap: $HEDGEHOG_ENABLE)"
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
