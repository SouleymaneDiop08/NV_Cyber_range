# =============================================================================
# Image de labo « dispatching » (runtime Docker-in-Docker).
#
# Contenu : le démon Docker du labo + son docker-compose + ses contextes de
# build + ses images pré-buildées. Lancée par cyber-range-orchestrator
# (DindComposeDriver) — chaque labo a SON démon, donc sa propre pile réseau :
# les réseaux L1/L2/L3 et les IP statiques vivent ici, et N labos peuvent
# réutiliser les mêmes adresses sans collision d'IPAM.
#
# Base par défaut : variante ROOTLESS. Le démon interne tourne alors sous un
# utilisateur non privilégié dans un user namespace — une évasion depuis le
# labo retombe sur un UID non privilégié de l'hôte, pas sur root. Repli
# documenté vers la variante privilégiée sans modifier ce fichier :
#     docker build --build-arg DIND_BASE=docker:28.5-dind --build-arg LAB_UID=0 \
#                  --build-arg LAB_GID=0 ...
#
# ⚠️ Le contexte de build de cette image DOIT être le dossier dispatching/ :
#     docker build -t talixman-lab-dispatching:latest -f lab-image/Dockerfile .
# (fait automatiquement par ../build-images.sh).
# =============================================================================
ARG DIND_BASE=docker:28.5-dind-rootless
FROM ${DIND_BASE}

# Utilisateur sous lequel tourne le démon interne : 1000 (`rootless`) pour la
# variante rootless, 0 pour la variante privilégiée (cf. repli ci-dessus).
ARG LAB_UID=1000
ARG LAB_GID=1000

# Socket du démon interne. En rootless il vit dans le runtime dir de
# l'utilisateur, et l'image de base ne définit PAS DOCKER_HOST — le client
# chercherait /var/run/docker.sock et ne trouverait rien.
#
# Doit être une ENV d'image (et pas seulement un export dans l'entrypoint) :
# l'orchestrateur lit l'état des composants via `docker exec <labId> docker
# compose ps`, et un `docker exec` n'hérite pas de l'environnement du
# processus PID 1. Sans cette ligne, l'inspection renverrait toujours zéro
# composant et le labo resterait éternellement en STARTING.
# Repli privilégié : passer --build-arg LAB_DOCKER_HOST= (vide = défaut).
ARG LAB_DOCKER_HOST=unix:///run/user/1000/docker.sock
ENV DOCKER_HOST=${LAB_DOCKER_HOST}

# Root le temps de déposer les fichiers ; USER est restauré en fin de fichier.
USER root

WORKDIR /lab

# Le laboratoire : compose + contextes de build + appdata initiales.
# --chown est indispensable en rootless : le démon interne et `docker compose`
# tournent sous LAB_UID et doivent lire /lab, et les bind mounts d'appdata
# doivent rester inscriptibles par les conteneurs du labo (dont le root est
# mappé sur LAB_UID par le user namespace).
COPY --chown=${LAB_UID}:${LAB_GID} docker-compose.yml /lab/docker-compose.yml
COPY --chown=${LAB_UID}:${LAB_GID} station_a /lab/station_a
COPY --chown=${LAB_UID}:${LAB_GID} station_b /lab/station_b
COPY --chown=${LAB_UID}:${LAB_GID} viewer3d-station-b /lab/viewer3d-station-b
COPY --chown=${LAB_UID}:${LAB_GID} scada_central /lab/scada_central
COPY --chown=${LAB_UID}:${LAB_GID} ews /lab/ews
COPY --chown=${LAB_UID}:${LAB_GID} kali-attacker /lab/kali-attacker
COPY --chown=${LAB_UID}:${LAB_GID} router1 /lab/router1
COPY --chown=${LAB_UID}:${LAB_GID} router2 /lab/router2
COPY --chown=${LAB_UID}:${LAB_GID} sensor_l3 /lab/sensor_l3
COPY --chown=${LAB_UID}:${LAB_GID} reverse-proxy /lab/reverse-proxy

# Images pré-buildées (docker save). Présent grâce à image-tars/.gitkeep même
# si build-images.sh n'a pas encore tourné (COPY d'un dossier requiert qu'il
# existe) — dans ce cas l'entrypoint retombe sur un build à la volée.
COPY --chown=${LAB_UID}:${LAB_GID} image-tars /lab/image-tars

COPY lab-image/entrypoint.sh /usr/local/bin/lab-entrypoint.sh
RUN chmod +x /usr/local/bin/lab-entrypoint.sh

USER ${LAB_UID}:${LAB_GID}

# Profil du labo. `core` = stations A/B + viewer 3D + SCADA central + les deux
# routeurs (le central est sur L3 et les PLC sur L1/L2 : sans routeurs, aucune
# route). Valeur de repli seulement — l'orchestrateur passe systématiquement
# -e COMPOSE_PROFILES depuis lab-template.json.
ARG LAB_PROFILE=core
ENV COMPOSE_PROFILES=${LAB_PROFILE}
ENTRYPOINT ["/usr/local/bin/lab-entrypoint.sh"]
