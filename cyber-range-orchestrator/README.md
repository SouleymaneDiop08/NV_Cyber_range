# Cyber Range Orchestrator (runtime Docker-in-Docker)

Middleware d'orchestration des laboratoires de **Talixman Range**. Il expose au
portail (`talixman-auth`) une API REST de cycle de vie des labos et une gateway
HTTP/WebSocket publique, et pilote pour chaque labo **un conteneur
Docker-in-Docker** qui exécute le `docker compose` du laboratoire à l'intérieur.

```
Utilisateur
   │
Portail Web (talixman-auth)
   │  REST (token de service)
Cyber Range Orchestrator  ← ce dépôt
   │  docker run/start/stop/pause/rm  (socket hôte)
Conteneur DinD  «lab-<hash>»   (1 par labo)
   │  dockerd + docker compose  (DANS le conteneur)
Reverse-proxy nginx du labo
   │  L1 / L2 / L3
PLC / SCADA / routeurs / …
```

## Pourquoi un démon Docker par labo

Chaque labo réutilise **exactement les mêmes IP internes** (`192.168.10.0/24`,
`192.168.20.0/24`, `192.168.30.0/24`, en dur dans FUXA/OpenPLC/les routeurs).
Pour faire tourner N labos simultanément sans collision d'IPAM, chaque labo doit
avoir sa propre pile réseau — c'est précisément ce que donne un démon Docker
dédié : ses bridges L1/L2/L3 vivent dans le netns du conteneur de labo.

Le compose du laboratoire n'est **pas** converti vers Kubernetes et sa topologie
n'est pas modifiée : il tourne tel quel.

> **Kata** reste la cible long terme (isolation par frontière VM matérielle) et
> son driver est conservé, mais il exige KVM et le runtime Kata enregistré côté
> hôte. La v1 s'appuie sur DinD durci, cf. ci-dessous.

## Architecture logicielle

| Élément | Rôle |
|---|---|
| `src/labs/labs.controller.ts` | API de contrôle interne `/labs/*` (token `ServiceTokenGuard`). Appelée uniquement par le portail. |
| `src/labs/labs.service.ts` | Logique métier agnostique du runtime : état persistant (`labId → template/date/lastSeenAt`), catalogue de composants, construction d'URL. **Aucune commande Docker.** |
| `src/labs/runtime/lab-runtime.driver.ts` | Interface `LabRuntimeDriver` (create/start/stop/pause/resume/delete/exists/inspect). |
| `src/labs/runtime/dind-compose.driver.ts` | **Implémentation v1** : un conteneur DinD par labo, état via `docker exec <labId> docker compose ps`. |
| `src/labs/runtime/kata-compose.driver.ts` | Implémentation Kata (cible long terme, exige KVM). |
| `src/labs/labs-reaper.service.ts` | Arrêt puis destruction automatiques des labos inactifs. |
| `src/ingress/lab-ingress.ts` | Interface `LabIngress` : stratégie d'exposition publique (une origine par composant). |
| `src/ingress/port-ingress.ts` | Implémentation v1 : allocation d'un port dédié par composant. |
| `src/gateway/port-proxy.ts` | Ouvre un point d'entrée par port alloué → `http://<labId>:<port>`, HTTP + WebSocket. |
| `src/orchestrator-mode.ts` | Découpage `control` / `gateway` (cf. Durcissement). |

Le runtime concret est injecté via le token `LAB_RUNTIME_DRIVER`
(`labs.module.ts`), choisi par la variable `LAB_RUNTIME` : ajouter ou remplacer
un runtime ne touche ni `LabsService`, ni le portail, ni le frontend.

### API de contrôle (interne, token requis)

| Méthode | Route | Effet |
|---|---|---|
| `PUT` | `/labs/:labId` (body `{template}`) | Créer si absent (idempotent) |
| `POST` | `/labs/:labId/start` \| `/stop` \| `/pause` \| `/resume` | Cycle de vie |
| `DELETE` | `/labs/:labId` | Supprimer |
| `GET` | `/labs/:labId` | État agrégé + composants |
| `GET` | `/templates/:template/services` | Catalogue de composants |

### Exposition publique des composants (sans token)

**Une origine par composant.** Chaque composant d'un labo est servi sur son
propre point d'entrée, ouvert par la gateway et proxifié vers
`http://<labId>:<port interne>`.

C'est une contrainte, pas un choix esthétique : les applications du laboratoire
(FUXA, OpenPLC, viewer 3D) construisent toutes leurs URLs **à la racine** —
`<base href="/">`, `Location: /login`, appels `/api/...`, WebSockets. Les servir
sous un préfixe de chemin (`/apps/<labo>/<composant>/`) fait échouer le
chargement : le navigateur redemande `/assets/...` et `/api/...` à la racine de
la gateway, hors du préfixe. Les corriger imposerait de modifier chaque
application, ce qu'on s'interdit.

La stratégie concrète est injectée via le token `LAB_INGRESS`
(`ingress/lab-ingress.ts`) :

| Stratégie | Origine | Statut |
|---|---|---|
| `PortIngress` | `http://<hôte>:<port dédié>/` | v1, en place |
| `HostnameIngress` | `https://<composant>.<labo>.<domaine>/` | cible, avec le reverse-proxy TLS |

**Le portail ne connaît jamais ces ports** : il lit `services[].url` renvoyé par
l'API d'état et le relaie tel quel. Changer de stratégie ne touchera donc ni le
portail, ni le frontend, ni les services du laboratoire.

Les points d'entrée sont synchronisés avec l'état des labos toutes les
`GATEWAY_SYNC_INTERVAL_MS` : le rôle `control` alloue et écrit, le rôle
`gateway` lit et ouvre/ferme ses serveurs. **Rien à enregistrer à la main.**

## Durcissement

| Mesure | Détail |
|---|---|
| **Séparation des rôles** | Deux conteneurs, même image : `control` détient le socket Docker et ne publie aucun port ; `gateway` est la seule surface publique et n'a **aucun** socket Docker (ni même le token de service). Supprime le cumul « root sur l'hôte + surface publique » dans un seul processus. |
| **Réseau des labos isolé** | Réseau dédié `talixman_labs`, déclaré `internal` : aucun service du portail (Postgres/Redis/Keycloak) n'y est attaché, et un labo compromis n'a aucun accès sortant Internet. |
| **Aucun port de labo sur l'hôte** | Le `reverse_proxy` du labo publie ses ports dans le netns du conteneur de labo. Les composants ne sont joignables que par la gateway. |
| **Aucun socket Docker dans le labo** | Le démon du labo est le sien ; celui de l'hôte n'y est jamais monté. |
| **Image de labo rootless** | `docker:28.5-dind-rootless` : le démon interne tourne sous un utilisateur non privilégié dans un user namespace. Une évasion depuis le labo retombe sur un UID non privilégié de l'hôte, pas sur root. |
| **Quotas** | `--memory`, `--cpus`, `--pids-limit` par labo, journalisation bornée. |
| **Pas de fuite de volumes** | Volume de données nommé et labellisé par labo, supprimé avec lui (`docker rm -f -v` **et** `docker volume rm`). |
| **Nettoyage des labos inactifs** | `stop` après `LAB_IDLE_STOP_MINUTES`, `delete` après `LAB_IDLE_DESTROY_HOURS`. Le compteur est la dernière consultation par le portail : un labo affiché n'est jamais fauché. |
| **Orchestrateur non élevé** | `no-new-privileges` + `read_only` sur les deux conteneurs du middleware (pertinent ici, contrairement au conteneur de labo). |

### Limites assumées

- **`cap_drop` et `no-new-privileges` sont sans effet sur le conteneur de labo** :
  son démon interne exige les privilèges de montage. Le confinement fin
  s'applique aux conteneurs *internes*, à qui le démon du labo n'accorde que
  `NET_ADMIN`/`NET_RAW` au-dessus du jeu par défaut.
- **seccomp/AppArmor `unconfined` sur le conteneur de labo** : le démon interne
  a besoin de `mount`, `unshare`, `pivot_root`… bloqués par les profils par
  défaut.
- **`apparmor_parser` est absent de l'image dind** : les conteneurs internes ne
  reçoivent donc pas le profil `docker-default`. Leur profil seccomp par défaut,
  lui, s'applique bien.
- **Rootless sans cgroups** : le démon interne signale
  `Running in rootless-mode without cgroups`. Les quotas par conteneur *interne*
  sont donc inopérants ; ceux du labo entier (posés par l'orchestrateur sur le
  conteneur DinD) s'appliquent normalement.
- **Isolation entre labos** : chaque labo a sa propre pile réseau, mais les
  conteneurs de labo peuvent se joindre entre eux sur `talixman_labs`. Un
  cloisonnement complet demanderait un réseau par labo, incompatible en l'état
  avec la résolution DNS `<labId>` par la gateway.
- **Port mirroring `gretap`** (profil `full`) : exige les modules noyau
  `ip_gre`/`gretap` côté hôte et sort du cadre rootless. Désactivé hors profil
  `full` — sans effet sur le routage L1/L2↔L3, qui reste actif.

## Templates de labo

Un template = un dossier (ex. `dispatching/`) contenant :

- `docker-compose.yml` — le labo (inchangé ; profils `test` / `core` / `full`).
- `lab-template.json` — `{ labImage, composeProfile, composeFile, runtime }`.
- `lab-components.json` — `[{ key, label, port, service }]` (catalogue + mapping
  nom → port pour la gateway).
- `lab-image/` — `Dockerfile` + `entrypoint.sh` de l'image de labo.
- `build-images.sh` — build hors-ligne des images + de l'image de labo.

Ajouter un secteur/template ne nécessite **aucune** modification du code de
l'orchestrateur.

## Construire et lancer

```bash
# 1. Réseau du portail (une fois) — côté talixman-auth
cd ../talixman-auth && docker compose up -d

# 2. Images du labo + image de labo (hors-ligne, sur l'hôte Docker)
cd ../dispatching && ./build-images.sh   # -> talixman-lab-dispatching:latest

# 3. Orchestrateur (crée le réseau talixman_labs)
cd ../cyber-range-orchestrator
cp .env.example .env   # ajuster TEMPLATES_HOST_DIR, GATEWAY_PUBLIC_URL
docker compose up -d --build
```

Le portail crée ensuite les labos via l'API de contrôle (routes `/labs/me*` du
backend `talixman-auth`). Le secteur doit porter le nom du template dans
`Sector.templateName` (ex. `dispatching`).

## Tests

```bash
npm test
```

Couvre le `DindComposeDriver` (arguments Docker exacts, nettoyage des volumes,
idempotence, parsing des deux formats de `compose ps`) et `LabsService` (verrou
anti-double-création, agrégation d'états, `lastSeenAt`, résolution des cibles de
proxy) avec un driver factice — aucune commande Docker réelle.

## Configuration (`.env`)

Voir `.env.example`. Points clés : `LAB_RUNTIME`, `LABS_NETWORK`,
`LAB_DATA_DIR`, `LAB_PRIVILEGED`, quotas `LAB_*`, seuils `LAB_IDLE_*`,
`TEMPLATES_HOST_DIR`/`TEMPLATES_DIR`, `ORCHESTRATOR_SERVICE_TOKEN`, et pour
l'exposition : `GATEWAY_PUBLIC_HOST` + `LAB_INGRESS_PORT_MIN`/`MAX` (la plage
doit être celle publiée par le service `gateway` dans `docker-compose.yml`).

## Hors périmètre actuel

L'intégration SSO Keycloak ↔ FUXA est **en pause** : le code portail existant
est conservé mais non étendu. Seul le secteur **Dispatching** est traité, et
seul le profil `core` (stations A/B + viewer 3D + SCADA central + routeurs) est
validé.
