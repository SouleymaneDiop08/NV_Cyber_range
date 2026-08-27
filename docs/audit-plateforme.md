# Audit technique — Plateforme Talixman Range

| | |
|---|---|
| **Périmètre** | Portail (`talixman-auth`), orchestrateur (`cyber-range-orchestrator`), laboratoire Dispatching |
| **Date** | 18 août 2026 |
| **Version auditée** | Commit `eb3de19` — dépôt unifié |
| **Nature** | Audit interne : code, configuration, sécurité, exploitabilité |
| **Méthode** | Exécution des tests, compilation, analyse des dépendances, revue de configuration et lecture de code |

---

## 1. Synthèse

La plateforme est **fonctionnelle de bout en bout** sur son secteur pilote et
repose sur des choix d'architecture sains — notamment un cloisonnement réseau
strict et deux abstractions qui rendent le moteur d'exécution et l'exposition
réseau remplaçables sans refonte.

**Elle n'est en revanche pas prête pour une mise en service.** Un constat
critique et quatre constats élevés doivent être traités au préalable. Aucun
n'est structurel : ce sont des finitions d'exploitation, chiffrables en jours.

### Constats par criticité

| Criticité | Nombre | Nature |
|---|---|---|
| **Critique** | 1 | Perte de données irréversible possible |
| **Élevée** | 4 | Exploitation impossible ou compromission facilitée |
| **Moyenne** | 4 | Qualité et maintenabilité dégradées |
| **Faible** | 2 | Écarts de durcissement et d'observabilité |

### Verdict par domaine

| Domaine | Appréciation | Commentaire |
|---|---|---|
| Architecture | **Solide** | Séparation des responsabilités respectée, abstractions en place |
| Sécurité applicative | **Correcte** | Double facteur, chiffrement, cloisonnement — quelques finitions |
| Qualité du code | **Correcte** | 67 tests verts, aucune dette signalée, mais couverture inégale |
| Exploitabilité | **Insuffisante** | Pas de sauvegarde, pas de supervision |
| Prêt pour la production | **Non** | Cf. plan d'action §5 |

---

## 2. Méthode et limites

**Vérifications réellement exécutées :**

```
npm test                    portail et orchestrateur
npx tsc --noEmit            compilation stricte
npm audit --omit=dev        vulnérabilités en surface de production
```

complétées par une revue de la configuration (`.env`, `docker-compose.yml`),
du schéma de données et du code des chemins sensibles (authentification,
autorisation, cycle de vie des laboratoires).

**Limites assumées.** Aucun test d'intrusion n'a été mené. Le laboratoire n'a
pas été audité pour lui-même : il embarque des logiciels industriels tiers
(supervision, automates) volontairement laissés dans leur configuration
d'origine, y compris leurs faiblesses — c'est le principe d'un cyber range.
L'audit porte sur la **plateforme qui les héberge**.

---

## 3. Constats détaillés

### CRITIQUE

#### A1 — Aucune sauvegarde automatisée de la base de données

**Constat.** Aucune tâche planifiée de sauvegarde n'existe sur la machine
(`crontab -l` : 0 entrée). Les sauvegardes existantes sont manuelles et
ponctuelles ; le dossier qui les contenait a été sorti du projet.

**Impact.** PostgreSQL contient le seul état non reproductible de la
plateforme : comptes, rôles, rattachement aux secteurs, secrets de second
facteur chiffrés, journal d'audit. Une perte du volume est **définitive** et
impose de recréer tous les comptes et de refaire scanner le QR code à chaque
utilisateur.

**Aggravant.** La clé `TOTP_ENC_KEY` doit être sauvegardée **séparément** de la
base. Sans elle, une restauration produit une base dont tous les secrets de
second facteur sont indéchiffrables : plus personne ne peut se connecter, la
sauvegarde est inutilisable.

**Recommandation.** Sauvegarde quotidienne automatisée (`pg_dump`), rétention
d'au moins 7 jours, stockage hors de la machine, **et un test de restauration
effectif** — une sauvegarde jamais restaurée n'est pas une sauvegarde. Les clés
de chiffrement dans un coffre distinct.

**Effort estimé.** 0,5 jour.

---

### ÉLEVÉE

#### A2 — Mots de passe par défaut encore en place

**Constat.** Deux secrets conservent leur valeur d'exemple :

| Variable | Longueur | Valeur |
|---|---|---|
| `POSTGRES_PASSWORD` | 8 | `changeme` |
| `SEED_SUPERADMIN_PASSWORD` | 8 | valeur par défaut |

**Impact.** Le port PostgreSQL est publié sur l'hôte (`0.0.0.0:5432`). Un mot
de passe par défaut sur une base contenant tous les comptes est une porte
ouverte dès que la machine est jointe depuis le réseau.

**Point positif à souligner.** Les secrets réellement cryptographiques sont
correctement générés : `TOTP_ENC_KEY` et `LAB_SSO_MASTER_KEY` font 64
caractères hexadécimaux, le jeton de service 43 caractères. Et
`LAB_SSO_MASTER_KEY` est **identique** entre le portail et l'orchestrateur,
condition nécessaire au fonctionnement des jetons de lancement — vérifié.

**Recommandation.** Régénérer les deux mots de passe, et ne plus publier le
port PostgreSQL sur l'hôte en dehors du développement.

**Effort estimé.** 1 heure.

---

#### A3 — Le backend ne déclare pas être derrière un proxy

**Constat.** Aucune déclaration `trust proxy` dans `backend/src/main.ts`.

**Impact.** Aujourd'hui sans conséquence. **Mais dès la mise en place du reverse
proxy public** — prévue pour la production — le limiteur de débit et le
verrouillage anti-force-brute verront l'adresse IP du proxy pour **tous** les
utilisateurs. Cinq échecs de connexion d'une seule personne verrouilleraient
alors l'accès de tout le monde : un déni de service auto-infligé, déclenché par
un simple oubli de mot de passe.

**Recommandation.** Ajouter la déclaration avant le déploiement du proxy, et la
vérifier en recette en contrôlant que l'IP journalisée est bien celle du client.

**Effort estimé.** 1 ligne, mais impérative.

---

#### A4 — Vulnérabilité connue dans la bibliothèque de navigation

**Constat.** `npm audit` signale 2 vulnérabilités de sévérité haute côté
frontend : *React Router — RSC Mode CSRF Bypass Allows Action Execution Before
400 Response* (`react-router` et `react-router-dom`).

**Impact.** Contournement potentiel de la protection anti-CSRF. La plateforme
pose par ailleurs sa propre garde CSRF côté backend, ce qui limite la portée —
mais la défense en profondeur est précisément ce qui doit tenir quand une
couche cède.

**Recommandation.** `npm audit fix` — le correctif est disponible **sans
changement de version majeure**, donc sans risque de régression.

**Effort estimé.** 15 minutes, tests de non-régression compris.

---

#### A5 — Un fichier dépasse la limite de taille de GitHub

**Constat.** `model.dae` fait 147 Mo. GitHub refuse tout fichier au-delà de
100 Mo. Le fichier est **réellement utilisé** : chargé par la vue 3D
(`index.html:877`) et monté à l'exécution dans le conteneur.

**Impact.** Le premier `git push` sera rejeté. Le transfert vers GitHub ou Gitea
est bloqué en l'état.

**Recommandation.** Deux options, à trancher :
1. **Git LFS** — aucun changement fonctionnel, mais LFS doit être activé côté
   serveur et installé sur chaque poste.
2. **Basculer sur `model-optimized.glb`** (8,1 Mo, déjà présent) — supprime le
   besoin de LFS, mais constitue une modification fonctionnelle à recetter.

**Effort estimé.** 1 heure pour l'option 1, une demi-journée avec recette pour
l'option 2.

---

### MOYENNE

#### A6 — Les tests de bout en bout ne compilent plus

**Constat.** 7 erreurs de compilation TypeScript, concentrées sur deux fichiers :

```
test/me-services.e2e-spec.ts   3 erreurs — champ 'launchUrl' supprimé du modèle
test/sso-launch.e2e-spec.ts    4 erreurs — 'launchUrl' + module keycloak.service absent
```

Ce sont les séquelles de deux évolutions assumées : le passage aux laboratoires
(qui a remplacé `launchUrl` par un composant résolu dynamiquement) et le retrait
de Keycloak.

**Impact.** Sur 6 fichiers de tests de bout en bout, 2 sont hors service. Les
parcours qu'ils couvraient — catalogue de services et lancement authentifié —
ne sont plus vérifiés automatiquement. Aucun filet lors des prochaines
évolutions.

**Recommandation.** Réparer les fixtures et adapter les assertions au nouveau
mécanisme de lancement. Le test dépendant d'un serveur d'authentification externe
doit être repensé, celui-ci n'existant plus.

**Effort estimé.** 1 jour.

---

#### A7 — Couverture de tests très inégale

**Constat.**

| Composant | Fichiers source | Fichiers de test | Tests |
|---|---|---|---|
| Orchestrateur | 18 | 2 | 34 ✔ |
| Backend | 58 | 5 | 33 ✔ |
| **Frontend** | **27** | **0** | **—** |

**Impact.** 67 tests passent, et l'orchestrateur — la partie la plus délicate —
est correctement couvert, y compris ses pilotes d'exécution sans commande Docker
réelle. En revanche le frontend n'a **aucun test**, alors qu'il porte des règles
sensibles : affichage conditionnel selon le rôle, désactivation des accès quand
le laboratoire est arrêté, gestion des sessions expirées.

**Recommandation.** Couvrir en priorité les composants portant une règle
d'autorisation, plutôt que de viser un taux global.

**Effort estimé.** 2 à 3 jours pour une base utile.

---

#### A8 — L'outil de migration est en dépendance de production

**Constat.** `prisma` (l'outil en ligne de commande) figure dans les
`dependencies` et non dans les `devDependencies`. Il porte à lui seul les
**3 vulnérabilités hautes** relevées côté backend, dont une exhaustion de pile
dans `deepmerge-ts`.

**Impact.** Ces vulnérabilités sont dans la surface de production alors que
l'outil n'y est utile qu'au moment des migrations. Le client d'accès aux données,
`@prisma/client`, est lui légitimement en production et n'est pas concerné.

**Nuance.** `npm audit` propose un correctif qui **rétrograde** Prisma en 6.12.0,
soit une version antérieure à celle installée (6.19.3) — recommandation à ne pas
appliquer telle quelle.

**Recommandation.** Déplacer `prisma` vers `devDependencies` et vérifier que les
migrations restent applicables au démarrage du conteneur.

**Effort estimé.** 2 heures, vérification comprise.

---

#### A9 — Deux fichiers de configuration divergents pour le backend

**Constat.** Le backend lit deux `.env` — celui du projet et celui de `backend/`.
Neuf clés présentes dans le premier sont absentes du second, dont
`POSTGRES_PASSWORD`, `POSTGRES_DB` et `VITE_API_URL`.

**Impact.** Source d'erreurs difficiles à diagnostiquer : modifier une valeur
dans le mauvais fichier n'a aucun effet, et le conteneur continue de tourner avec
l'ancienne configuration sans le signaler. Ce piège s'est déjà matérialisé
plusieurs fois pendant le développement.

**Recommandation.** Une source unique de configuration, ou à défaut une
documentation explicite du rôle de chaque fichier et une vérification au
démarrage.

**Effort estimé.** 0,5 jour.

---

### FAIBLE

#### A10 — Durcissement inégal des conteneurs

**Constat.** Les conteneurs de l'orchestrateur portent `no-new-privileges` et
`read_only`. Ceux du portail — API, frontend, PostgreSQL, Redis — n'ont **aucune
option de durcissement**.

**Impact.** Écart de posture entre deux composants de même sensibilité. Faible
en développement, à corriger avant exposition.

**Recommandation.** Aligner le portail sur l'orchestrateur.

---

#### A11 — Aucune centralisation des journaux ni supervision

**Constat.** Les journaux restent dans les conteneurs. Aucune métrique, aucune
alerte. Le journal d'audit applicatif existe en base — 16 actions tracées — mais
n'est exposé par **aucune interface** : il n'est consultable qu'en SQL.

**Impact.** Un incident se diagnostique à la main. Une tentative d'intrusion ne
déclenche rien.

**Recommandation.** Exposer le journal d'audit dans l'interface superadmin, puis
centraliser les journaux techniques.

---

## 4. Points positifs

Un audit qui n'énumère que des défauts donne une image fausse. Les éléments
suivants sont au-dessus de ce qu'on observe habituellement à ce stade.

**Sécurité applicative.** Cinq gardes s'appliquent globalement à toutes les
routes, dans l'ordre : limitation de débit, anti-CSRF, session, rôle, secteur.
**Une route est donc protégée par défaut** — l'ouvrir demande un geste explicite.
C'est l'inverse du réflexe habituel, et cela évite la classe entière des oublis
de protection.

**Cloisonnement réseau effectif.** Le réseau des laboratoires est déclaré
`internal` : un composant compromis — machine d'attaque comprise — ne peut
joindre ni la base du portail, ni Internet. Vérifié.

**Absence d'oracle d'énumération.** La réinitialisation de mot de passe renvoie
une réponse identique quel que soit le cas : compte inexistant, désactivé, quota
atteint, panne d'envoi. Détail souvent négligé.

**Abstractions réellement en place.** Le moteur d'exécution et le mode
d'exposition réseau sont derrière des interfaces, avec plusieurs implémentations.
Le passage au HTTPS et aux sous-domaines ne demandera pas de refonte — affirmation
vérifiable dans le code, pas une intention.

**Aucun secret versionné.** Contrôle effectué sur l'intégralité de l'index git :
aucun `.env`, aucun dump, aucune archive.

**Qualité du code.** Aucun marqueur `TODO`/`FIXME`/`HACK` dans les
3 composants — inhabituel sur ~9 900 lignes. Les commentaires expliquent les
décisions plutôt que de paraphraser le code.

**Second facteur activé dans le laboratoire.** Les trois superviseurs ont
`secureEnabled=true` : l'API du laboratoire n'est plus ouverte.

---

## 5. Plan d'action

### Avant toute mise en service — bloquant

| # | Action | Effort |
|---|---|---|
| A1 | Sauvegarde automatisée + test de restauration + clés en coffre | 0,5 j |
| A2 | Régénérer les mots de passe par défaut, fermer le port PostgreSQL | 1 h |
| A4 | `npm audit fix` sur le frontend | 15 min |
| A3 | Déclarer le proxy de confiance (à faire **avec** le reverse proxy) | 1 ligne |

### Avant le transfert vers GitHub/Gitea

| # | Action | Effort |
|---|---|---|
| A5 | Trancher entre Git LFS et le modèle 3D optimisé | 1 h à 0,5 j |

### Dette à résorber

| # | Action | Effort |
|---|---|---|
| A6 | Réparer les deux fichiers de tests de bout en bout | 1 j |
| A9 | Unifier la configuration du backend | 0,5 j |
| A8 | Déplacer l'outil Prisma en dépendance de développement | 2 h |
| A7 | Premiers tests frontend sur les règles d'autorisation | 2-3 j |
| A10 | Aligner le durcissement des conteneurs du portail | 2 h |
| A11 | Exposer le journal d'audit dans l'interface superadmin | 1 j |

**Charge totale estimée : 7 à 9 jours**, dont **1 jour bloquant** pour une mise
en service.

---

## Annexe A — Inventaire technique

### Volumétrie

| Composant | Lignes | Fichiers source | Rôle |
|---|---|---|---|
| Backend | ~3 400 | 58 | Identité, droits, propriété des laboratoires |
| Frontend | ~4 050 | 27 | Interface web |
| Orchestrateur | ~2 430 | 18 | Cycle de vie et exposition des laboratoires |

### Pile technique

| Couche | Technologies |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, TailwindCSS 4, TanStack Query 5 |
| Backend | NestJS 11 (Node 20), Prisma 6, PostgreSQL 16, Redis 7, Argon2id, otplib |
| Orchestrateur | NestJS 11, `http-proxy-middleware`, état en fichier JSON |
| Laboratoires | Docker-in-Docker rootless (`docker:28.5-dind-rootless`) |

### Modèle de données — 8 entités

`Sector` · `Service` · `User` · `Lab` · `ActivationToken` ·
`PasswordResetToken` · `RecoveryCode` · `AuditLog`

### Surface d'API — 23 routes

Authentification (8), utilisateurs (5), laboratoires (5), services et secteurs
(4), catalogue utilisateur (2). Toutes les routes sensibles sont en `/me/…` :
la portée est déduite de la session, jamais d'un identifiant fourni par le
client.

### Paramètres de sécurité en vigueur

| Paramètre | Valeur |
|---|---|
| Hachage des mots de passe | Argon2id |
| Chiffrement des secrets de second facteur | AES-256-GCM |
| Durée de session | 12 heures |
| Jeton d'attente entre les deux étapes de connexion | 5 minutes |
| Verrouillage après échecs | 5 tentatives / 15 minutes |
| Limitation de débit globale | 100 requêtes / minute |
| Lien d'activation | 48 heures, usage unique |
| Lien de réinitialisation | 1 heure, usage unique, 3 demandes / 15 min |
| Jeton de lancement d'un composant | 60 secondes, usage unique |

### Preuves d'exécution

```
Portail        — 33 tests, 5 suites, 100 % au vert
Orchestrateur  — 34 tests, 2 suites, 100 % au vert
Compilation    — 7 erreurs, toutes dans 2 fichiers e2e (cf. A6)
Dépendances    — 3 vulnérabilités hautes backend (A8), 2 hautes frontend (A4)
                 orchestrateur : 0 vulnérabilité
Secrets        — aucun secret dans l'index git
                 LAB_SSO_MASTER_KEY cohérente portail ↔ orchestrateur
```

---

## Annexe B — Où intervenir

| Besoin | Fichiers |
|---|---|
| Ajouter une route API | `*.controller.ts`, un DTO dans `dto/`, la logique dans `*.service.ts` |
| Modifier une règle de droits | `common/guards/roles.guard.ts` ou le décorateur `@Roles()` |
| Ajouter un champ en base | `prisma/schema.prisma` puis `npx prisma migrate dev` |
| Ajouter un écran | `pages/`, la route dans `App.tsx`, l'appel dans `lib/api.ts` |
| Modifier une couleur | `frontend/src/index.css` — jamais dans un composant |
| Changer un quota de laboratoire | `cyber-range-orchestrator/.env` |
| Ajouter un composant au laboratoire | `dispatching/docker-compose.yml` **et** `lab-components.json` |

## Annexe C — Pièges d'exploitation constatés

- `api` et `frontend` sont derrière le profil Compose `app` : `docker compose up -d`
  ne les démarre pas, **sans message d'erreur**. Utiliser `--profile app`.
- `docker compose restart` ne relit pas les variables d'environnement :
  `up -d --force-recreate`.
- `Sector.templateName` n'est exposé par aucune interface et se pose en base.
  Une valeur erronée fait échouer la création de laboratoire avant Docker.
- `VITE_API_URL` doit pointer sur l'adresse joignable **depuis le navigateur**,
  jamais `localhost` si le poste client est distant.
