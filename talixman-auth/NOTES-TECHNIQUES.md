# Talixman Auth Platform

Plateforme d'authentification centralisée pour un cyber range multi-secteurs (dispatching électrique, raffinerie, système ferroviaire). Le portal est le point d'entrée unique : sans authentification, aucun accès aux services du cyber range (exposés en interne via des ports type 1881, 8080, 8090…).

## Architecture

Mono-repo :

- `frontend/` — React + Vite + TypeScript + TailwindCSS (v4, via plugin `@tailwindcss/vite`) + TanStack Query + React Router.
- `backend/` — NestJS (TypeScript).
- `docker-compose.yml` — dev : Postgres, Redis, `api`/`frontend` en mode watch (profil `app`, montent le code local).
- `docker-compose.prod.yml` + `backend/Dockerfile` + `frontend/Dockerfile` (+ `frontend/nginx.conf`) — build multi-stage prod. **Pas de reverse-proxy TLS (Traefik) pour l'instant** — à ajouter dès qu'un nom de domaine réel est disponible ; en attendant, ne pas exposer `api`/`frontend` directement sur un réseau non fiable.
- `docs/design-system.md` + `docs/design-reference.html` + `docs/logo-talixman.png` — maquette **historique** de référence (décodée depuis `design.html` à la racine du dépôt) : palette de couleurs, typographie, structure des écrans d'origine. **L'UI réelle a depuis été refondue** (voir section Design / UI ci-dessous) ; la maquette reste utile pour la structure/les écrans mais plus pour les couleurs exactes ni les composants.
- `frontend/src/components/ui/` — librairie de composants UI partagée (Button, Field/TextField/SelectField/Checkbox, Card, Badge, Dialog/ConfirmDialog, Toast, Skeleton, EmptyState). Toujours réutiliser ces composants plutôt que du HTML brut stylé en inline.
- `../cyber-range-orchestrator/` (sibling, **hors de ce dépôt**) — middleware qui exécute les laboratoires. Le portail ne parle **jamais** à Docker : il appelle cette API REST. Voir section « Laboratoires » ci-dessous.
- `../dispatching/` (sibling, **hors de ce dépôt**, dépôt git propre) — le laboratoire du secteur Dispatching et **template officiel** du cyber range.
- `../fuxa_scada/` (sibling de `talixman-auth/`, **hors de ce dépôt**) — instance FUXA (SCADA/HMI, fork frangoteam/FUXA rebrandé "Talixman SCADA"), premier service du cyber range intégré en SSO via Keycloak. Son propre `docker-compose.yml`, à lancer **après** celui de `talixman-auth` (dépendance réseau externe vers `keycloak`). Voir section dédiée ci-dessous. ⚠️ Cette intégration SSO est **en pause** (cf. section Laboratoires).
- `keycloak` + `keycloak-postgres` (services dans `docker-compose.yml`) — Keycloak sert **uniquement de pont SSO** entre le portail et les services intégrés (FUXA pour l'instant) ; il ne remplace jamais l'authentification métier du portail (mot de passe + TOTP, ci-dessus, inchangée).

Stack complète : PostgreSQL (via Prisma), Redis (cache/sessions/throttling), TOTP via `otplib` + `qrcode`, hash mot de passe Argon2id, email transactionnel SMTP (Nodemailer, fournisseur **Resend** recommandé — voir `.env.example` —, mode "console" en dev), Keycloak (SSO vers les services intégrés), conteneurs Docker Compose. Reverse-proxy TLS (Traefik ou Caddy) à ajouter en prod dès qu'un nom de domaine est disponible.

## Rôles & RBAC

Trois rôles, chacun rattaché à un **secteur** (sauf le superadmin, qui les gère tous) :

- **SUPERADMIN** (équipe Talixman) : crée des comptes SUPERADMIN et ADMIN, rattache les ADMIN à un secteur, gère (CRUD complet, y compris modification a posteriori de l'URL/description/catégorie) les services accessibles par secteur. Liste et supprime tout ADMIN ou GUEST (`GET /users`, `DELETE /users/:id`) — **supprimer un ADMIN supprime automatiquement, en cascade, tous les GUEST qu'il a créés**. Ne peut pas se supprimer lui-même ni supprimer un autre SUPERADMIN via cette route.
- **ADMIN** (client) : crée uniquement des GUEST, limité à son propre secteur (403 sinon). Accède aux services de son secteur.
- **GUEST** (invité) : hérite du secteur de l'admin qui l'a créé. Accès **VIEW_ONLY** uniquement (vue 3D + vue opérateur) — ne peut jamais lancer de scénario, aucune route de mutation.
- **Tous rôles** : peuvent changer leur propre mot de passe une fois connectés (`PATCH /auth/password`, mot de passe actuel requis) — page "Compte" du dashboard.

Chaque service (`Service`) porte un `access_level` : `FULL` (jouer des scénarios, réservé ADMIN+) ou `VIEW_ONLY` (vue 3D + vue opérateur, accessible aussi aux GUEST). Dans la maquette, les services portent aussi une `category` (WORKSTATION, ATTACKER, SUPERVISION, AUTOMATE, TERRAIN) utilisée pour le filtrage visuel côté portail — à conserver comme champ optionnel sur `Service`.

## Modèle de données (référence)

- **Sector** — `id`, `name` (`dispatching_electrique` | `raffinerie` | `systeme_ferroviaire`), `label`
- **Service** — `id`, `sector_id`, `name`, `description`, `launch_url`, `enabled`, `access_level` (`FULL` | `VIEW_ONLY`), `category` (optionnel, cf. maquette), `sso_target` (optionnel, string libre — ex. `"FUXA"` ; déclenche le pont SSO Keycloak au lancement au lieu d'un lien direct, cf. section Intégration FUXA)
- **User** — `id`, `email`, `first_name`, `last_name` (nullables en base pour les comptes créés avant leur ajout, mais **obligatoires** côté `CreateUserDto` pour toute nouvelle création), `password_hash`, `role` (`SUPERADMIN` | `ADMIN` | `GUEST`), `sector_id`, `created_by`, `status` (`INVITED` | `ACTIVE` | `DISABLED`), `totp_secret_enc` (chiffré, jamais en clair), `totp_activated_at`
- **ActivationToken** — `id`, `user_id`, `token_hash`, `expires_at`, `used_at`
- **RecoveryCode** — `id`, `user_id`, `code_hash`, `used_at`
- **AuditLog** — `id`, `user_id`, `action`, `ip`, `created_at`

## Flux d'inscription & authentification (TOTP)

L'inscription est **toujours déclenchée par un admin/superadmin** — pas d'auto-inscription publique.

1. L'admin crée le compte (nom, email, rôle). Statut initial : `INVITED`.
2. Le serveur génère un secret TOTP, le **chiffre** (AES-256-GCM, clé `TOTP_ENC_KEY`, hors du code) et le stocke.
3. Un email d'invitation part avec un lien d'activation (token à usage unique, haché, courte durée).
4. À la première connexion : l'utilisateur choisit son mot de passe (Argon2id), voit un QR Code (`otpauth://` URI), le scanne avec Google Authenticator, saisit le premier code à 6 chiffres → statut passe à `ACTIVE`.
5. Des codes de récupération (8-10) sont générés à l'activation, stockés hachés, usage unique.
6. Chaque connexion ultérieure : **mot de passe (étape 1/2) puis code TOTP à 6 chiffres (étape 2/2)**, cf. écrans de la maquette. Aucun accès sans les deux facteurs.

Sécurité en place (Phase 8) : secret TOTP jamais loggé/stocké en clair (AES-256-GCM) ; throttling + lockout Redis sur le mot de passe, le code OTP de login **et** le code d'activation (5 échecs / 15 min, `LoginThrottleService`) ; tokens d'activation à usage unique (48h) ; cookies httpOnly/Secure(prod)/SameSite=Strict ; garde CSRF légère (header `X-Requested-With` requis sur les requêtes mutantes, en plus de `SameSite=Strict`) ; rate limiting global (`@nestjs/throttler`, 100 req/min) + resserré sur `/auth/*` (20 req/min) ; `helmet()` ; CORS restreint à `CORS_ORIGIN`.

## Design / UI

L'UI a été refondue (post-maquette) vers un niveau "SaaS pro" (inspiration Notion/Linear/Vercel/GitHub/Stripe). `docs/design-system.md`/`docs/design-reference.html` restent une référence de structure d'écrans mais **plus la source de vérité pour les couleurs/composants** — c'est `frontend/src/index.css` (tokens) + `frontend/src/components/ui/` (composants) qui font foi.

- Design tokens dans `index.css` : palette bordeaux/plum + accent orange→rouge en dégradé (identité de marque conservée), + couleurs sémantiques dédiées (`--success`, `--warning`, `--danger-bg`, `--info`) distinctes du rouge de marque, échelle d'ombres/rayons/durées de transition, `:focus-visible` cohérent globalement, `prefers-reduced-motion` respecté.
- Composants réutilisables dans `components/ui/` : `Button`/`IconButton`, `TextField`/`SelectField`/`Checkbox` (labels toujours associés via `htmlFor`/`id`), `Card`/`CardHeader`, `Badge`, `Dialog`/`ConfirmDialog` (remplace tout `window.confirm()`), `Toast`/`useToast` (notifications, monté dans `main.tsx` via `ToastProvider`), `Skeleton`/`SkeletonRows`/`SkeletonCardGrid`, `EmptyState`.
- Icônes `lucide-react` (jamais d'emoji comme icône fonctionnelle).
- Thème sombre par défaut avec bascule clair, persisté en `localStorage` (`lib/theme.ts`).
- Écran login en deux étapes (mot de passe, puis 6 cases de code OTP) sur un layout split-screen avec panneau de marque.
- Dashboard avec topbar responsive (nav selon rôle, menu mobile en tiroir sous 768px, skip-link clavier), grille de cartes de services filtrables par catégorie, vue "Invités" (ADMIN), "Gestion" à trois onglets Secteurs/Services + Administrateurs + Invités (SUPERADMIN), page "Compte" (accessible à tous les rôles).
- Tableaux larges toujours enveloppés dans un conteneur `overflow-x-auto` pour le mobile.

## Laboratoires (Docker-in-Docker)

Chaque ADMIN dispose d'**un** laboratoire, instancié depuis le template de son secteur. Le portail ne parle jamais à Docker : il appelle `cyber-range-orchestrator` en REST.

```
Portail (talixman-auth)  →  Cyber Range Orchestrator  →  conteneur DinD «lab-<hash>»
                                                             └→ dockerd + docker compose du labo
                                                                  └→ PLC / SCADA / viewer / routeurs (L1/L2/L3)
```

**Répartition des responsabilités.** Le portail possède l'identité, le RBAC, la correspondance secteur → template (`Sector.templateName`) et le nommage (`namespaceForOwner()` = `lab-` + 12 hex du sha256 de l'`ownerId`). L'orchestrateur n'a **aucune** notion de secteur ni d'utilisateur : il reçoit un `labId` et un nom de template.

- **Modèle `Lab`** — `id`, `owner_id` (unique : un labo par ADMIN), `namespace` (= `labId`), `status` (`CREATING` | `STOPPED` | `STARTING` | `RUNNING` | `STOPPING` | `PAUSED` | `ERROR`).
- **`Service.lab_component`** — remplace l'ancienne `launch_url` statique : l'URL réelle est calculée au lancement depuis le labo de l'utilisateur courant (`LabsService.getLaunchUrlForUser`), jamais stockée.
- **Routes** `/labs/me*` uniquement (`labs.controller.ts`) — jamais de `:namespace` côté client, tout dérive de la session : aucune surface IDOR. Un GUEST hérite du labo de l'ADMIN qui l'a créé (résolution par `createdById`, pas par secteur).
- **`OrchestratorClientService`** — contrairement à `KeycloakService` (best-effort), les erreurs **remontent** toujours : un échec d'orchestration ne doit jamais être avalé.
- **Accès aux composants** : uniquement via la gateway de l'orchestrateur, qui donne à **chaque composant sa propre origine** (un port dédié en v1). Aucun port de labo n'est publié sur l'hôte. Le frontend relaie `services[].url` et **ne doit jamais reconstruire d'URL** — c'est ce qui permettra de passer au routage par nom d'hôte (domaine + reverse-proxy TLS) sans toucher au portail.
  ⚠️ **Un préfixe de chemin est impossible** ici : FUXA, OpenPLC et le viewer 3D construisent toutes leurs URLs à la racine (`<base href="/">`, `Location: /login`, `/api/...`). Servis sous `/apps/<labo>/<composant>/`, ils redemandent leurs assets et API à la racine de la gateway et ne chargent jamais. Cf. `../cyber-range-orchestrator/src/ingress/lab-ingress.ts`.

**Runtime.** DinD est le runtime de la **v1** ; Kata (mini-VM par labo) reste la cible long terme et son driver est conservé, sélectionnable par `LAB_RUNTIME`. L'abstraction `LabRuntimeDriver` garantit qu'un changement de runtime ne touche ni le portail, ni le frontend. Détail du durcissement et de ses limites : `../cyber-range-orchestrator/README.md`.

⚠️ **L'intégration SSO Keycloak ↔ FUXA est en pause** : le code existant (section suivante) est conservé tel quel mais **n'est plus étendu**. Priorité actuelle : portail, middleware, DinD, gestion des labos.

### Pièges rencontrés

- **Kata est inutilisable sur la machine de dev** : `/dev/kvm` absent, seul `runc` enregistré comme runtime. C'est ce qui a motivé le passage à DinD.
- **`Sector.templateName` n'est exposé par aucune API ni UI** — il se pose directement en base. Une valeur pointant vers un dossier de template inexistant fait échouer la création de labo sur `Template inconnu` *avant* tout appel Docker. Valeur correcte pour le dispatching : `dispatching` (le dossier `../dispatching/`).
- **L'image `docker:*-dind-rootless` ne définit pas `DOCKER_HOST`** : son démon écoute sur `/run/user/1000/docker.sock` alors que le client cherche `/var/run/docker.sock`. Doit être une `ENV` d'image et pas un simple export dans l'entrypoint, car `docker exec` (utilisé pour lire l'état des composants) n'hérite pas de l'environnement de PID 1.
- **Le DNS du bridge Docker par défaut est indisponible AU BUILD** dans cet environnement (même piège que `fuxa_scada`, cf. Notes opérationnelles) : tous les blocs `build:` du labo portent `network: host`, sinon `apt-get`/`apk` échouent en `DNS: transient error`.
- **Le réseau des labos doit rester distinct de `talixman-auth_default`**, qui héberge Postgres, Redis et Keycloak — sans quoi un conteneur de labo (Kali inclus en profil `full`) peut joindre la base du portail.

## Intégration FUXA (SCADA) via SSO Keycloak

Premier service du cyber range intégré en SSO. Objectif : cliquer sur "FUXA" depuis le Portail → arriver déjà connecté dans FUXA, avec les permissions dérivées du rôle portail — sans jamais faire passer le login du portail (mot de passe + TOTP) par Keycloak. FUXA a son propre système d'auth JWT maison (modèle `groups` bitmask, cf. `fuxa_scada/server/api/jwt-helper.js` et `fuxa_scada/client/src/app/_models/user.ts`) — volontairement non réécrit, seulement pont vers.

**Mécanisme réel (validé en conditions réelles, pas juste en théorie)** : PAS de grant OAuth "Standard Token Exchange" (`urn:ietf:params:oauth:grant-type:token-exchange` avec `requested_subject`) — il déclenche une `NullPointerException` reproductible côté serveur dans **Keycloak 26.7.0** (`V1TokenExchangeProvider`/`UserPermissionsV2`, bug connu de cette version). À la place :
1. Le backend portail (`GET /me/services/:id/launch`) appelle `POST /admin/realms/talixman/users/{id}/impersonation` avec son service-account (`talixman-portal`, rôle client `impersonation` sur `realm-management` — **permission sensible**, secret jamais exposé au frontend) → obtient des cookies de session Keycloak pour l'utilisateur cible.
2. Avec ces cookies, requête silencieuse à `/realms/talixman/protocol/openid-connect/auth` pour le client `fuxa-scada` → Keycloak redirige avec un `code`, **sans jamais afficher de formulaire de login** (session déjà valide).
3. Échange du `code` contre un vrai `access_token` (`grant_type=authorization_code`).
4. Redirection du navigateur vers `{launchUrl}/api/sso/callback?kc_token=...` (nouveau module FUXA, additif).

**Correspondance des rôles** (`backend/src/keycloak/keycloak.service.ts` + `fuxa_scada/appdata/mysettings.json` → `sso.roleGroups`) :

| Portail | Rôle realm Keycloak | `groups` FUXA | Effet |
|---|---|---|---|
| SUPERADMIN | `talixman-superadmin` | `-1` | Admin FUXA total (édition, config, commandes) |
| ADMIN | `talixman-admin` | `2` (Operator) | Pas d'édition, pilotage/commandes autorisés |
| GUEST | *(aucun compte Keycloak)* | *(mode `guest` natif FUXA)* | Lecture seule stricte — **zéro appel Keycloak**, comportement déjà garanti côté serveur FUXA (`isSocketWriteAuthorized`) |

**Backend portail** :
- `backend/src/keycloak/` (`KeycloakModule`/`KeycloakService`, `@Global()`) — provisioning best-effort (jamais bloquant pour la logique métier du portail, même pattern que `emailSent`) : `syncUser()` crée/maj l'utilisateur Keycloak + son rôle realm, appelé automatiquement dans `UsersService.createInvitedUser` ; `deleteUser()` appelé dans `UsersService.remove` (cascade incluse). GUEST : no-op (pas de compte Keycloak).
- `npm run sync:keycloak` (`backend/src/scripts/sync-keycloak.ts`) — rattrapage pour synchroniser les comptes SUPERADMIN/ADMIN existants (créés avant l'intégration). À relancer si Keycloak est redéployé/vidé.
- `MeController.launchService` (`GET /me/services/:id/launch`) — pour un service `ssoTarget` et un rôle SUPERADMIN/ADMIN, fait le pont ; sinon (GUEST, ou pas de `ssoTarget`) redirige directement vers `launchUrl` comme avant. Le frontend (`PortailPage.tsx`) appelle toujours cette route, jamais `launchUrl` directement.
- ⚠️ **Le Superadmin n'a pas de page "Portail"** (pas de secteur, pas dans son menu) — il ne peut donc pas lancer de service (SSO ou non) depuis l'UI. Comportement voulu (Superadmin gère les services, Admin/Invité les utilisent), pas un bug. Tester le SSO avec un compte ADMIN.

**FUXA** (`fuxa_scada/`, additif uniquement, rien d'existant réécrit) :
- `server/api/sso/index.js` (nouveau module) — vérifie le token Keycloak via JWKS (réutilise `axios`+`jsonwebtoken`, déjà présents, **aucune nouvelle dépendance npm**), mappe le rôle realm → `groups`, **provisionne l'utilisateur local** (`runtime.users.setUsers()`, sans mot de passe — nécessaire : `verifyGroups()` de FUXA refuse l'accès REST à un utilisateur authentifié absent de sa base locale, même avec un JWT valide), signe un JWT FUXA natif (même forme que `buildAccessToken`), sert une page de callback minimale qui hydrate `sessionStorage` comme le ferait `/api/signin`.
- `server/api/index.js`, `server/main.js`, `server/settings.default.js` — ajouts minimaux (montage du module, fusion des settings `sso`), rien d'existant modifié.
- `appdata/mysettings.json` → `secureEnabled: true` (**était `false`** — l'API était grande ouverte, corrigé indépendamment du SSO) + bloc `sso: {enabled, issuer, audience, roleGroups}`. **`issuer` doit être EXACTEMENT `http://keycloak:8080/realms/talixman`** (l'URL que le backend portail utilise pour émettre les tokens) — pas l'URL par laquelle FUXA lui-même croit joindre Keycloak si elle diffère.
- ⚠️ **Identifiant par défaut `admin`/`123456`** (seedé nativement par FUXA) est maintenant un vrai identifiant actif puisque `secureEnabled=true` — à changer dès la mise en service réelle.

**Config Keycloak requise** (realm `talixman`, créé via Admin REST API, pas encore scripté/reproductible automatiquement — à refaire à la main si le realm est perdu) :
- Rôles : `talixman-superadmin`, `talixman-admin`, `talixman-guest` (non utilisé).
- Client `talixman-portal` (confidentiel, service-account, rôle `impersonation` + `manage-users`/`view-users`/`query-users`/`view-realm` sur `realm-management`).
- Client `fuxa-scada` (confidentiel, `standardFlowEnabled: true`, `redirectUris` incluant `{launchUrl}/*`) — **doit avoir un mapper de protocole "Audience" (`oidc-audience-mapper`, `included.client.audience: fuxa-scada`)** : sans ça, Keycloak émet `aud: "account"` par défaut et FUXA rejette tout token valide (`jwt audience invalid`), bug rencontré et corrigé pendant l'intégration.
- Keycloak déployé en `start-dev` avec `--features=token-exchange,admin-fine-grained-authz` (nécessaire à l'impersonation, même si le grant "Standard Token Exchange" lui-même n'est pas utilisé, cf. ci-dessus).

## Conventions

- TypeScript strict partout (front et back).
- ESLint (+ Prettier back, oxlint front) — pas de code qui échoue au lint.
- Tests : Jest côté backend (unit + e2e), Vitest/Playwright côté frontend selon la phase.
- Une phase du plan d'implémentation (`workflow.md`) = une session de travail ; on valide (tests + démo manuelle) avant de passer à la suivante. Pas de code métier non vérifié qui s'accumule.
- Aucun secret en dur dans le code ou l'image Docker — tout passe par `.env` / variables d'environnement (voir `.env.example`).

## Notes opérationnelles

- **Front doit envoyer `X-Requested-With: XMLHttpRequest`** sur toute requête mutante (déjà fait par défaut dans `frontend/src/lib/api.ts`) — sinon le `CsrfGuard` backend renvoie 403.
- **Migrations en prod** : l'image `backend` lance `prisma migrate deploy` automatiquement au démarrage du conteneur (voir `CMD` du `Dockerfile`).
- **`npm ci` dans `docker build`** peut occasionnellement échouer sur cette machine de dev avec `npm error Exit handler never called!` (bug npm connu, sortie en code 0 malgré un `node_modules` incomplet) — les deux Dockerfiles vérifient un binaire attendu après l'install et relancent jusqu'à 3 fois. Si un build échoue quand même, relancer `docker compose -f docker-compose.prod.yml build` (généralement transitoire).
- Le réseau bridge **par défaut** de Docker n'a ni DNS ni port-forwarding fiables dans certains environnements sandboxés — toujours utiliser `--network host` pour `docker run` ponctuels, ou passer par `docker compose` (qui crée son propre réseau bridge nommé, fonctionnel).
- **`docker compose restart api` ne relit PAS `.env`** (les variables `env_file`/`environment` sont figées à la création du conteneur, pas au restart) — après une modification de `.env`, utiliser `docker compose up -d --force-recreate api` (ou `up -d` tout court) pour que le changement soit réellement pris en compte. Piège rencontré avec `EMAIL_TRANSPORT`/`SMTP_*` : le conteneur tournait avec l'ancienne config malgré un `.env` à jour.
- Il existe **deux fichiers `.env`** pour le backend : celui à la racine (`env_file` de `docker-compose.yml`) et `backend/.env` (mounté dans le conteneur via le volume `./backend:/app`, lu directement par Prisma/dotenv). Les deux doivent rester synchronisés manuellement pour les variables partagées (`EMAIL_TRANSPORT`, `SMTP_*`, `TOTP_ENC_KEY`, etc.) — ne modifier que l'un des deux est une source de bugs difficiles à diagnostiquer.
- Après une migration Prisma (`prisma migrate dev`), recréer le conteneur `api` (`docker compose up -d --force-recreate api`) pour que le process Node charge le Prisma Client régénéré.
- Fournisseur email configuré : **Resend**, via SMTP générique (`smtp.resend.com`, pas de SDK dédié). Tant que le domaine `talixmangroup.com` n'est pas vérifié dans Resend, le mode sandbox (`SMTP_FROM="Talixman Range <onboarding@resend.dev>"`) ne délivre qu'à l'adresse du compte Resend lui-même — toute autre adresse reçoit un rejet 550. En attendant, `EMAIL_TRANSPORT=console` (comportement par défaut actuel) logue le lien d'activation dans `docker logs talixman-auth-api-1` au lieu de l'envoyer.
- Sauvegardes ponctuelles (code + `pg_dump`) déposées hors dépôt dans `../backups/` (frère de `talixman-auth/`), fichiers `.tar.gz`/`.sql` en permissions `600` (contiennent des secrets).
- **`KEYCLOAK_URL`** suit le même piège que `DATABASE_URL`/`REDIS_URL` : `http://localhost:8081` dans les `.env` (outils lancés depuis l'hôte), mais override explicite à `http://keycloak:8080` dans `docker-compose.yml` → `services.api.environment` (obligatoire, sinon le conteneur `api` tente de résoudre `localhost` sur lui-même et échoue).
- Le build Docker de `fuxa_scada/` (`docker compose build`) échoue sur `apt-get update` (DNS indisponible) avec le bridge par défaut au moment du build — même piège que documenté plus haut pour le bridge Docker, mais cette fois **au build**, pas seulement au runtime : ajouter `build: { context: ., network: host }` dans son `docker-compose.yml` (déjà fait).
- `fuxa_scada/docker-compose.yml` doit être lancé **après** celui de `talixman-auth` : il référence son réseau (`talixman-auth_default`) en `external: true` pour joindre `keycloak` — si ce réseau n'existe pas encore, `docker compose up` échoue.

## État du projet

Phases 0 à 8 du plan d'implémentation terminées et validées. Reste : **Phase 9** (tests e2e Playwright + CI GitHub Actions) et l'ajout d'un reverse-proxy TLS (Traefik/Caddy) une fois un nom de domaine disponible. Voir `workflow.md` à la racine du dépôt (au-dessus de `talixman-auth/`) pour le plan de phases complet et les critères d'acceptation de chacune.

Travaux additionnels réalisés après la Phase 8 (hors plan initial, backend : 22 tests e2e + 16 unitaires) :

- Changement de mot de passe en libre-service pour tous les rôles (page "Compte").
- Superadmin : liste des invités groupée par admin créateur + suppression (individuelle et multiple) ; création d'autres comptes SUPERADMIN ; suppression d'un ADMIN en cascade sur ses GUEST ; modification a posteriori d'un service (nom/description/URL/catégorie/accès), pas seulement activer/désactiver.
- Champs `first_name`/`last_name` sur `User`, obligatoires à la création, affichés dans la topbar.
- Intégration Resend pour l'envoi d'emails transactionnels (voir Notes opérationnelles) — actuellement désactivée (`EMAIL_TRANSPORT=console`) en attendant la vérification du domaine `talixmangroup.com`.
- Refonte complète de l'UI frontend (design tokens, librairie de composants, icônes lucide-react, accessibilité, responsive) — voir section Design / UI.
- Intégration SSO Keycloak ↔ FUXA (premier service du cyber range branché) — déployée et testée de bout en bout en conditions réelles (Admin et Superadmin), voir section Intégration FUXA. Reste : câbler l'UI Portail pour le Superadmin si on veut qu'il puisse aussi lancer des services (actuellement hors périmètre, cf. limitation documentée) ; scripter la création du realm/clients Keycloak (actuellement faite à la main via Admin REST API, non reproductible automatiquement).
