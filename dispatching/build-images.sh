#!/usr/bin/env bash
# =============================================================================
# Build hors-ligne, une fois, sur une machine Docker (idéalement celle qui
# héberge le range). Produit :
#   - les images des services du labo (tags talixman-dispatching-*) ;
#   - leurs exports tar dans image-tars/ (chargés dans le labo au démarrage) ;
#   - l'image de labo talixman-lab-dispatching:latest (embarque le compose +
#     image-tars), lancée par cyber-range-orchestrator en Docker-in-Docker.
#
# À relancer quand un service du labo change.
#
# Variables :
#   BUILD_PROFILE   profil dont on build les services (défaut : core).
#                   `full` ajoute EWS, Kali et le capteur OT (long, lourd).
#   LAB_PROFILE     profil inscrit par défaut dans l'image (défaut : $BUILD_PROFILE).
#   DIND_BASE       image de base du labo (défaut : docker:28.5-dind-rootless).
#                   Repli privilégié : DIND_BASE=docker:28.5-dind LAB_UID=0 LAB_GID=0
#   LAB_UID/LAB_GID utilisateur du démon interne (défaut : 1000/1000, rootless).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

BUILD_PROFILE="${BUILD_PROFILE:-core}"
LAB_PROFILE="${LAB_PROFILE:-$BUILD_PROFILE}"
DIND_BASE="${DIND_BASE:-docker:28.5-dind-rootless}"
LAB_UID="${LAB_UID:-1000}"
LAB_GID="${LAB_GID:-1000}"
# Socket du démon interne : runtime dir de l'utilisateur en rootless, défaut
# Docker en root (valeur vide = le client utilise /var/run/docker.sock).
if [ "$LAB_UID" = "0" ]; then
  LAB_DOCKER_HOST="${LAB_DOCKER_HOST:-}"
else
  LAB_DOCKER_HOST="${LAB_DOCKER_HOST:-unix:///run/user/${LAB_UID}/docker.sock}"
fi

echo "==> Build des images de services (profil: $BUILD_PROFILE)"
docker compose --profile "$BUILD_PROFILE" build

echo "==> Export des images en tars (image-tars/)"
mkdir -p image-tars
# Les tars du build précédent sont retirés : sans ça, un changement de profil
# laisserait des images obsolètes que l'entrypoint rechargerait quand même.
rm -f image-tars/*.tar
# `config --images` liste les tags `image:` des services du profil courant.
images=$(docker compose --profile "$BUILD_PROFILE" config --images | sort -u)
for img in $images; do
  safe=$(printf '%s' "$img" | tr '/:' '__')
  echo "    docker save $img -> image-tars/$safe.tar"
  docker save "$img" -o "image-tars/$safe.tar"
done

echo "==> Build de l'image de labo (base: $DIND_BASE, uid: $LAB_UID)"
docker build \
  -t talixman-lab-dispatching:latest \
  -f lab-image/Dockerfile \
  --build-arg "DIND_BASE=$DIND_BASE" \
  --build-arg "LAB_UID=$LAB_UID" \
  --build-arg "LAB_GID=$LAB_GID" \
  --build-arg "LAB_PROFILE=$LAB_PROFILE" \
  --build-arg "LAB_DOCKER_HOST=$LAB_DOCKER_HOST" \
  .

echo ""
echo "OK. Image de labo prête : talixman-lab-dispatching:latest"
echo "    profil embarqué par défaut : $LAB_PROFILE"
echo "    (référencée par dispatching/lab-template.json -> labImage)"
