# =============================================================================
# Image de labo « système ferroviaire » (runtime Docker-in-Docker).
#
# Contenu : le démon Docker du labo + son docker-compose + ses contextes de
# build + ses images pré-buildées (image-tars/). Lancée par
# cyber-range-orchestrator (DindComposeDriver) — chaque labo a SON démon, donc
# sa propre pile réseau : les réseaux .20/.30/.40 et les IP statiques vivent
# ici, et N labos peuvent réutiliser les mêmes adresses sans collision d'IPAM.
#
# Base par défaut : variante ROOTLESS (démon interne sous un utilisateur non
# privilégié, dans un user namespace). Repli privilégié sans modifier ce
# fichier :
#     docker build --build-arg DIND_BASE=docker:28.5-dind --build-arg LAB_UID=0 \
#                  --build-arg LAB_GID=0 --build-arg LAB_DOCKER_HOST= ...
#
# ⚠️ Le contexte de build DOIT être le dossier systeme_ferroviaire/ :
#     docker build -t talixman-lab-ferroviaire:latest -f lab-image/Dockerfile .
# (fait automatiquement par ../build-images.sh, ici ./build-images.sh).
# =============================================================================
ARG DIND_BASE=docker:28.5-dind-rootless
FROM ${DIND_BASE}

ARG LAB_UID=1000
ARG LAB_GID=1000

# Socket du démon interne — doit être une ENV d'image (l'orchestrateur lit
# l'état via `docker exec <labId> docker compose ps`, qui n'hérite pas de
# l'environnement de PID 1). Repli privilégié : --build-arg LAB_DOCKER_HOST=.
ARG LAB_DOCKER_HOST=unix:///run/user/1000/docker.sock
ENV DOCKER_HOST=${LAB_DOCKER_HOST}

USER root
WORKDIR /lab

# Le laboratoire : compose + contextes de build + configs/données initiales.
# --chown indispensable en rootless (le démon et compose tournent sous LAB_UID,
# les bind mounts doivent rester inscriptibles par les conteneurs du labo).
COPY --chown=${LAB_UID}:${LAB_GID} docker-compose.yml /lab/docker-compose.yml
COPY --chown=${LAB_UID}:${LAB_GID} station_b            /lab/station_b
COPY --chown=${LAB_UID}:${LAB_GID} viewer3d-station-b   /lab/viewer3d-station-b
COPY --chown=${LAB_UID}:${LAB_GID} ter-map              /lab/ter-map
COPY --chown=${LAB_UID}:${LAB_GID} services-gare        /lab/services-gare
COPY --chown=${LAB_UID}:${LAB_GID} digital-twin-api     /lab/digital-twin-api
COPY --chown=${LAB_UID}:${LAB_GID} views                /lab/views
COPY --chown=${LAB_UID}:${LAB_GID} kali-attacker        /lab/kali-attacker
COPY --chown=${LAB_UID}:${LAB_GID} router               /lab/router
COPY --chown=${LAB_UID}:${LAB_GID} ids                  /lab/ids
COPY --chown=${LAB_UID}:${LAB_GID} scenarios            /lab/scenarios

# Images pré-buildées (docker save). Présent grâce à image-tars/.gitkeep même
# si build-images.sh n'a pas encore tourné — l'entrypoint retombe alors sur un
# build à la volée.
COPY --chown=${LAB_UID}:${LAB_GID} image-tars           /lab/image-tars

COPY lab-image/entrypoint.sh /usr/local/bin/lab-entrypoint.sh
RUN chmod +x /usr/local/bin/lab-entrypoint.sh

USER ${LAB_UID}:${LAB_GID}

# Profil du labo (valeur de repli — l'orchestrateur passe -e COMPOSE_PROFILES
# depuis lab-template.json). Aucun service ferroviaire n'est profilé : ils
# démarrent tous quel que soit le profil.
ARG LAB_PROFILE=core
ENV COMPOSE_PROFILES=${LAB_PROFILE}
ENTRYPOINT ["/usr/local/bin/lab-entrypoint.sh"]
