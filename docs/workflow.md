# Talixman Auth Platform — Workflow d'implémentation (Claude Code)

Plan d'implémentation **incrémental et vérifiable** pour construire la plateforme d'authentification centralisée à partir de la maquette React existante.

Chaque phase contient : **objectif**, **prompt à donner à Claude Code**, **livrables**, et **critères d'acceptation** (à valider avant de passer à la suivante).

> Règle d'or avec Claude Code : **une phase = une session**. On valide (tests + démo) avant d'avancer. On ne laisse pas s'accumuler du code non vérifié.

---

## Stack cible

| Couche            | Choix                                                                   | Alternative          |
| ----------------- | ----------------------------------------------------------------------- | -------------------- |
| Front             | React + Vite + TypeScript + TailwindCSS + TanStack Query + React Router | Next.js              |
| Back              | **NestJS** (TypeScript)                                                 | FastAPI (Python)     |
| DB                | PostgreSQL                                                              | —                    |
| ORM / migrations  | Prisma                                                                  | SQLAlchemy + Alembic |
| Cache / sessions  | Redis                                                                   | —                    |
| TOTP              | `otplib` + `qrcode`                                                     | `pyotp` + `qrcode`   |
| Hash mot de passe | Argon2id                                                                | —                    |
| Email             | SMTP transactionnel (Nodemailer / provider)                             | —                    |
| Conteneurs        | Docker Compose + Traefik (TLS)                                          | Nginx / Caddy        |

> Ce document suppose NestJS. Les équivalents Python sont indiqués quand c'est utile.

---

## Modèle de données (référence)

À faire comprendre à Claude Code dès le départ. Entités principales :

- **Sector** — `id`, `name` (dispatching_electrique | raffinerie | systeme_ferroviaire), `label`
- **Service** — `id`, `sector_id`, `name`, `description`, `launch_url`, `enabled`, `access_level` (FULL = jouer scénarios / VIEW_ONLY = vue 3D + vue opérateur)
- **User** — `id`, `email`, `password_hash`, `role` (SUPERADMIN | ADMIN | GUEST), `sector_id`, `created_by`, `status` (INVITED | ACTIVE | DISABLED), `totp_secret_enc` (chiffré), `totp_activated_at`
- **Invitation / ActivationToken** — `id`, `user_id`, `token_hash`, `expires_at`, `used_at`
- **RecoveryCode** — `id`, `user_id`, `code_hash`, `used_at`
- **AuditLog** — `id`, `user_id`, `action`, `ip`, `created_at`

Règles RBAC :

- **SUPERADMIN** (équipe Talixman) : crée SUPERADMIN + ADMIN,  rattache les ADMINS à un secteur, gère (CRUD + activer/désactiver) les services par secteur.
- **ADMIN** (client) : crée uniquement des GUEST, accède aux services de son secteur.
- **GUEST** : hérite du secteur de l'admin créateur, accès **VIEW_ONLY** uniquement (vue 3D + vue opérateur), ne peut pas lancer de scénario.

---

## Phase 0 — Scaffolding & CLAUDE.md

**Objectif** : structure mono-repo, `docker-compose` squelette, et un `CLAUDE.md` qui donne le contexte permanent à Claude Code.

**Prompt Claude Code**

> Crée un mono-repo `talixman-auth/` avec deux dossiers : `frontend/` (React+Vite+TS+Tailwind) et `backend/` (NestJS + TypeScript). Ajoute un `docker-compose.yml` avec les services postgres, redis (démarrés), et des placeholders pour api et frontend. Crée un `CLAUDE.md` à la racine résumant : l'architecture, le modèle de données ci-dessous, les rôles RBAC, le flux TOTP, et les conventions (TS strict, ESLint, tests Vitest/Jest). Ne code pas encore la logique métier.

**Livrables** : arborescence, `docker-compose.yml`, `CLAUDE.md`, `.env.example`.

**Critères d'acceptation** :

- `docker compose up postgres redis` démarre sans erreur.
- `CLAUDE.md` contient le modèle de données et les règles RBAC.

---

## Phase 1 — Schéma DB & migrations

**Objectif** : traduire le modèle de données en schéma Prisma + première migration.

**Prompt Claude Code**

> À partir du modèle de données du CLAUDE.md, écris le `schema.prisma` complet (Sector, Service, User, ActivationToken, RecoveryCode, AuditLog) avec les enums et relations. Génère la migration initiale et un script de seed qui crée les 3 secteurs et un premier compte SUPERADMIN (email + mot de passe depuis les variables d'env).

**Livrables** : `schema.prisma`, migration, `seed.ts`.

**Critères d'acceptation** :

- `prisma migrate dev` passe, tables créées.
- Le seed crée les 3 secteurs et le superadmin initial.

---

## Phase 2 — Cœur d'authentification (mot de passe + TOTP)

**Objectif** : le module d'auth avec activation de compte et login à deux facteurs.

Sous-étapes (à faire dans l'ordre, une par commit) :

1. **Hash mot de passe** — service Argon2id (hash + verify).
2. **Génération TOTP** — à la création d'un user, générer un secret via `otplib`, le **chiffrer** (AES-256-GCM, clé depuis `TOTP_ENC_KEY`) avant stockage.
3. **Activation** — endpoint qui, à partir d'un token d'activation valide : pose le mot de passe, renvoie l'`otpauth://` URI + le **QR code** (data URL), vérifie le premier code à 6 chiffres, passe le user en `ACTIVE`.
4. **Login** — étape 1 : email + mot de passe ; étape 2 : vérification du code TOTP. Émission d'une session (cookie httpOnly `Secure` + Redis) ou JWT access/refresh.
5. **Codes de récupération** — générer 8-10 backup codes à l'activation, stockés hachés.

**Prompt Claude Code (exemple pour la sous-étape 3)**

> Implémente le endpoint `POST /auth/activate` : il reçoit `activationToken`, `password`, et `totpCode`. Vérifie le token (non expiré, non utilisé), hache le mot de passe en Argon2id, déchiffre le secret TOTP, vérifie le code à 6 chiffres avec otplib (fenêtre de tolérance 1), et active le compte. Ajoute les tests Jest couvrant : token expiré, code TOTP invalide, activation réussie.

**Critères d'acceptation** :

- Un compte peut être activé (mot de passe posé + QR scanné + code validé).
- Le login exige **mot de passe puis code TOTP** ; un mauvais code est rejeté.
- Le secret TOTP n'est **jamais** stocké ni loggé en clair.
- Tests verts sur les cas nominaux + erreurs.

> **Vérification manuelle** : scannez réellement le QR avec Google Authenticator et confirmez que le code généré est accepté.

---

## Phase 3 — RBAC & autorisations

**Objectif** : Guards NestJS qui appliquent rôle + secteur sur chaque route.

**Prompt Claude Code**

> Crée un `RolesGuard` et un `SectorGuard` NestJS + décorateurs `@Roles()` et `@SameSector()`. Un SUPERADMIN accède à tout ; un ADMIN est limité à son secteur ; un GUEST est en lecture seule. Ajoute un `AuditInterceptor` qui logge les actions sensibles (création de compte, login, gestion de service) dans AuditLog. Tests inclus.

**Critères d'acceptation** :

- Un ADMIN ne peut pas agir hors de son secteur (403).
- Un GUEST ne peut atteindre aucune route de mutation (403).
- Les actions sensibles apparaissent dans AuditLog.

---

## Phase 4 — Superadmin : gestion des services par secteur

**Objectif** : CRUD des services (ajouter / modifier / supprimer / activer / désactiver), scopé par secteur, avec le niveau d'accès (FULL / VIEW_ONLY).

**Prompt Claude Code**

> Implémente le module Services : `POST/GET/PATCH/DELETE /sectors/:sectorId/services`, réservé au SUPERADMIN. Un service porte name, description, launch_url, enabled, access_level. Ajoute la validation (class-validator) et les tests.

**Critères d'acceptation** :

- Le superadmin crée/édite/supprime/active des services par secteur.
- Les endpoints refusent tout non-SUPERADMIN.

---

## Phase 5 — Admin : création d'invités + emails d'invitation

**Objectif** : l'admin crée des GUEST ; le serveur génère secret TOTP + token d'activation + envoie l'email d'invitation.

**Prompt Claude Code**

> Implémente `POST /users` réservé aux ADMIN pour créer un GUEST : le GUEST hérite du secteur de l'admin, statut INVITED. Le serveur génère le secret TOTP (chiffré), crée un ActivationToken haché à durée courte, et envoie un email d'invitation contenant le lien d'activation. Ajoute un service Email (Nodemailer) configurable par SMTP, et un mode "console" en dev. Tests inclus.

**Critères d'acceptation** :

- L'admin crée un GUEST dans son secteur uniquement.
- Un email (ou log console en dev) part avec un lien d'activation valide.
- Le lien mène au flux d'activation de la Phase 2.

---

## Phase 6 — Intégration front : câblage de la maquette à l'API

**Objectif** : brancher les écrans React existants (login, activation, dashboard) sur l'API.

**Prompt Claude Code**

> Intègre les composants React existants au back : page de login en deux étapes (mot de passe → code TOTP), page d'activation (formulaire mot de passe + affichage du QR + saisie du premier code), et gestion de session via cookie httpOnly. Utilise TanStack Query pour les appels et un intercepteur pour le refresh. Gère les états d'erreur (mauvais code, token expiré).

**Critères d'acceptation** :

- Parcours complet en navigateur : invitation → activation (QR) → login 2FA → dashboard.
- Les erreurs d'auth s'affichent proprement.

---

## Phase 7 — Dashboard secteur & accès service en un clic

**Objectif** : après login, afficher les **box de services** du secteur de l'utilisateur ; lancement en un clic ; GUEST → seulement les services VIEW_ONLY (vue 3D + vue opérateur).

**Prompt Claude Code**

> Crée l'endpoint `GET /me/services` qui renvoie les services du secteur de l'utilisateur connecté, filtrés par son access_level (un GUEST ne reçoit que VIEW_ONLY). Côté front, affiche une box par service avec bouton "Lancer" qui ouvre le launch_url. Un GUEST voit uniquement les accès en visualisation.

**Critères d'acceptation** :

- Un ADMIN voit tous les services actifs de son secteur (FULL + VIEW_ONLY).
- Un GUEST ne voit que les accès VIEW_ONLY.
- Le bouton de lancement ouvre le bon service.

---

## Phase 8 — Durcissement sécurité & conteneurisation

**Objectif** : rendre la plateforme déployable et robuste.

À implémenter :

- **Throttling OTP** — limiter les tentatives de code (ex. 5 essais / 15 min) + lockout, via Redis. Indispensable : un code à 6 chiffres se brute-force.
- **Rate limiting global** sur `/auth/*`.
- **Cookies** : `httpOnly`, `Secure`, `SameSite=Strict` ; protection **CSRF**.
- **Chiffrement au repos** du secret TOTP confirmé (clé hors du code, via env/secret manager).
- **Headers de sécurité** (helmet), CORS restreint au front.
- **Dockerfiles multi-stage** (front → build statique servi par Nginx ; back → image slim).
- **Traefik** (ou Caddy) en reverse-proxy avec TLS automatique.
- `docker-compose.prod.yml` complet : traefik, frontend, api, postgres, redis.

**Prompt Claude Code**

> Ajoute le throttling des tentatives OTP via Redis (lockout après N échecs), le rate limiting sur /auth, helmet, la protection CSRF et le CORS restreint. Écris les Dockerfiles multi-stage pour front et back, et un docker-compose.prod.yml avec Traefik (TLS Let's Encrypt), postgres et redis. Documente les variables d'env requises.

**Critères d'acceptation** :

- Trop de codes OTP erronés → compte temporairement verrouillé.
- `docker compose -f docker-compose.prod.yml up` démarre toute la pile derrière TLS.
- Aucun secret en dur dans le code ou l'image.

---

## Phase 9 — Tests bout-en-bout & CI

**Objectif** : filet de sécurité automatisé.

**Prompt Claude Code**

> Écris des tests e2e (Playwright) couvrant le parcours complet invitation → activation → login 2FA → dashboard, plus les cas d'autorisation (GUEST bloqué en mutation, ADMIN hors secteur bloqué). Ajoute un pipeline GitHub Actions : lint + tests back + tests front + build des images Docker.

**Critères d'acceptation** :

- Les tests e2e passent en local et en CI.
- La CI échoue si lint/tests/build échouent.

---

## Checklist sécurité (à repasser en fin de projet)

- [ ] Mots de passe hachés en Argon2id, jamais loggés.
- [ ] Secret TOTP chiffré au repos, clé hors du code.
- [ ] Codes de récupération générés, hachés, utilisables une seule fois.
- [ ] Throttling + lockout sur les tentatives OTP et de login.
- [ ] Tokens d'activation : hachés, à usage unique, courte durée.
- [ ] Cookies httpOnly/Secure/SameSite + protection CSRF.
- [ ] CORS restreint, headers de sécurité (helmet) en place.
- [ ] Audit log des actions sensibles.
- [ ] TLS partout (pas de HTTP en clair en prod).
- [ ] Aucun secret dans le dépôt Git (`.env` ignoré, secret manager en prod).

---

## Conseils d'usage avec Claude Code

- Gardez `CLAUDE.md` à jour à chaque phase : c'est la mémoire du projet.
- Demandez **les tests en même temps** que le code, phase par phase.
- Après chaque phase : `git commit` propre + démo manuelle avant d'avancer.
- Pour la 2FA, testez **réellement** avec Google Authenticator, pas seulement en tests unitaires.
- En cas de doute sur une lib, faites confirmer la version stable au moment du build (les versions évoluent : épinglez-les dans `package.json`).
