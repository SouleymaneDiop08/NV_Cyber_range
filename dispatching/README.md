# OT_RANGE_V2

Version de deploiement allegee de la cyber-range OT.

## Vue rapide

Cette variante deploie :
- `L1`, `L2`, `L3`
- `PLC-A`, `PLC-B`
- `SCADA-A`, `SCADA-B`, `SCADA Central`
- `R1` et `R2` avec Suricata local et port mirroring logiciel `tc + gretap`
- un capteur Debian unique `ot_sensor` en `L3`
- `EWS`
- `Kali Attacker`
- `Portal` local de gestion d'utilisateurs
- le viewer 3D minimal de la station B

Non inclus dans cette variante :
- Malcolm principal
- Malcolm hedgehog profile
- Wazuh

## Deploy

### Standalone (dev)

Commande unique :

```bash
COMPOSE_PROFILES=core docker compose up -d --build   # profil de la v1
COMPOSE_PROFILES=test docker compose up -d --build   # Station A + B seulement
COMPOSE_PROFILES=full docker compose up -d --build   # labo complet
```

Trois profils :

| Profil | Contenu |
|---|---|
| `test` | Station A + B + viewer 3D + reverse_proxy — jeu d'essai minimal. |
| `core` | `test` + SCADA central + les deux routeurs, **port mirroring gretap désactivé**. Profil de la v1 : le SCADA central est sur L3 et les PLC sur L1/L2, il lui faut donc les routeurs. |
| `full` | Labo complet : + EWS, Kali, capteur OT, mirroring gretap actif. Exige les modules noyau `ip_gre`/`gretap` sur l'hôte. |

Chaque service porte un `image:` explicite en plus de son `build:`. Tous les
blocs `build:` portent `network: host` — sans quoi `apt-get`/`apk` échouent en
`DNS: transient error` sur le bridge Docker par défaut de certains
environnements.

### Orchestré en Docker-in-Docker (cyber-range-orchestrator)

Ce labo est aussi le **template** du middleware Talixman Range : il tourne dans
un conteneur DinD dédié (un par labo, avec son propre démon Docker), via une
image de labo (`lab-image/`) qui embarque `dockerd` + ce compose + les images
pré-buildées.

```bash
./build-images.sh   # build des services + export tars + image de labo
```

Variables utiles : `BUILD_PROFILE` (défaut `core`), `DIND_BASE` (défaut
`docker:28.5-dind-rootless`), `LAB_UID`/`LAB_GID`. Repli non rootless :

```bash
DIND_BASE=docker:28.5-dind LAB_UID=0 LAB_GID=0 ./build-images.sh
```

Puis c'est le middleware (`../cyber-range-orchestrator`) qui crée/démarre/
suspend/supprime le labo. Voir `lab-template.json` (image + profil) et le
README de l'orchestrateur.

## Services

Les ports ci-dessous sont publiés par `reverse_proxy` **à l'intérieur du labo**
(sur l'interface du conteneur DinD), jamais sur l'hôte : en déploiement
orchestré, les composants ne sont joignables que par la gateway du middleware.

| Service | Profil | Zone | IP | Port (dans le labo) |
|---|---|---|---|---|
| `plc_station_a` | test | L1 | `192.168.10.10` | `8080` |
| `scada_station_a` | test | L1 | `192.168.10.20` | `1881` |
| `plc_station_b` | test | L2 | `192.168.20.10` | `8081` |
| `scada_station_b` | test | L2 | `192.168.20.20` | `1882` |
| `viewer3d_station_b` | test | L2 | `192.168.20.90` | `8090` |
| `scada_scentral` | core | L3 | `192.168.30.10` | `1884` |
| `router_r1_r3` | core | L1/L3 | `192.168.10.254`, `192.168.30.254` | `1444` |
| `router_r2_r3` | core | L2/L3 | `192.168.20.254`, `192.168.30.253` | `1443` |
| `ews` | full | L3 | `192.168.30.20` | `6080` |
| `kali_attacker` | full | L3 | `192.168.30.30` | `6081`, `5000` |
| `ot_sensor` | full | L3 | `192.168.30.50` | aucun |

## Notes

- `ot_sensor` termine deja les deux miroirs et expose `mirror_l1`, `mirror_l2` et `br-mirror`
- `br-mirror` est prevu pour un futur Malcolm `hedgehog` unique
- les dependances `utils/` d'OpenPLC ont ete embarquees pour preparer un build propre sur la VM cible
- le dossier `portal/` n'est **pas** monté par ce `docker-compose.yml` (aucun service `portal`) — l'authentification est assurée par le portail Talixman, pas par un portail local

### ⚠️ Supervision par le SCADA central : pas encore fonctionnelle

Le profil `core` démarre bien `scada_scentral` et les deux routeurs, et le
routage est actif dans les routeurs (`ip_forward=1`, `FORWARD ACCEPT`). Mais la
supervision des PLC par le central ne fonctionne pas encore, pour deux raisons
**antérieures** au passage en Docker-in-Docker :

1. **Aucune route côté client.** `scada_scentral` est seul sur L3 et n'a qu'une
   route par défaut vers la passerelle du bridge L3. Rien ne lui indique de
   passer par `192.168.30.254` (R1) pour L1 ni par `192.168.30.253` (R2) pour
   L2 : une connexion TCP vers `192.168.10.10:502` part en timeout. Son image
   ne contient d'ailleurs pas `iproute2`, donc la route ne peut pas être posée
   au démarrage en l'état.
2. **Ses équipements Modbus sont désactivés** dans le projet FUXA enregistré
   (`appdata/project.fuxap.db`) : `PLC_A` (`192.168.10.10:502`) et
   `PLC_stationB` (`192.168.20.10:502`) sont tous deux `"enabled": false`.

Corriger demande donc une décision de contenu du labo (ajouter `iproute2` + un
entrypoint posant les routes, et réactiver les équipements dans le projet), pas
un ajustement d'orchestration.

## Verification rapide

```bash
docker compose exec router_r1_r3 tc filter show dev eth0 ingress
docker compose exec router_r2_r3 tc filter show dev eth0 ingress
docker compose exec ot_sensor ip link show mirror_l1
docker compose exec ot_sensor ip link show mirror_l2
docker compose exec ot_sensor ip link show br-mirror
```
