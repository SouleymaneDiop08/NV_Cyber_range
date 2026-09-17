#!/usr/bin/env bash
# =============================================================================
# Build hors-ligne, une fois, sur une machine Docker (idéalement l'hôte du
# range). Produit :
#   - les images des services du labo ferroviaire ;
#   - leurs exports tar dans image-tars/ (rechargés dans le labo au démarrage) ;
#   - l'image de labo talixman-lab-ferroviaire:latest (embarque le compose +
#     image-tars), lancée par cyber-range-orchestrator en Docker-in-Docker.
#
# À relancer quand un service du labo change.
#
# Variables :
#   DIND_BASE       image de base du labo (défaut : docker:28.5-dind-rootless).
#                   Repli privilégié : DIND_BASE=docker:28.5-dind LAB_UID=0 LAB_GID=0
#   LAB_UID/LAB_GID utilisateur du démon interne (défaut : 1000/1000, rootless).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

DIND_BASE="${DIND_BASE:-docker:28.5-dind-rootless}"
LAB_UID="${LAB_UID:-1000}"
LAB_GID="${LAB_GID:-1000}"
if [ "$LAB_UID" = "0" ]; then
  LAB_DOCKER_HOST="${LAB_DOCKER_HOST:-}"
else
  LAB_DOCKER_HOST="${LAB_DOCKER_HOST:-unix:///run/user/${LAB_UID}/docker.sock}"
fi

# SKIP_BUILD=1 : ne reconstruit pas les images de services (utile quand elles
# sont déjà présentes, ou quand une image lourde comme Kali a été buildée à la
# main hors de cet hôte). On passe alors directement au save + image de labo.
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "==> SKIP_BUILD=1 : build des services ignoré (images supposées présentes)"
else
  echo "==> Build des images de services ferroviaires (séquentiel)"
  # Un service à la fois : le build parallèle par défaut fait cohabiter la
  # compilation g++ d'OpenPLC (matiec/opendnp3) et l'install apt de Kali, ce
  # qui sature la RAM sur un hôte modeste. Le séquentiel plafonne le pic.
  for svc in $(docker compose config --services); do
    echo "    -> build $svc"
    docker compose build "$svc"
  done
fi

echo "==> Récupération des images externes non buildées (ex. Suricata)"
# `config --images` liste tous les tags image: du compose. Les services non
# buildés (jasonish/suricata) doivent être présents localement avant le save.
images=$(docker compose config --images | sort -u)
for img in $images; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "    docker pull $img"
    docker pull "$img"
  fi
done

echo "==> Export des images en tars (image-tars/)"
mkdir -p image-tars
# Retire les tars du build précédent (sinon des images obsolètes seraient
# rechargées par l'entrypoint).
rm -f image-tars/*.tar
for img in $images; do
  safe=$(printf '%s' "$img" | tr '/:' '__')
  echo "    docker save $img -> image-tars/$safe.tar"
  docker save "$img" -o "image-tars/$safe.tar"
done

echo "==> Build de l'image de labo (base: $DIND_BASE, uid: $LAB_UID)"
docker build \
  -t talixman-lab-ferroviaire:latest \
  -f lab-image/Dockerfile \
  --build-arg "DIND_BASE=$DIND_BASE" \
  --build-arg "LAB_UID=$LAB_UID" \
  --build-arg "LAB_GID=$LAB_GID" \
  --build-arg "LAB_DOCKER_HOST=$LAB_DOCKER_HOST" \
  .

echo ""
echo "OK. Image de labo prête : talixman-lab-ferroviaire:latest"
echo "    (référencée par systeme_ferroviaire/lab-template.json -> labImage)"
