# Design system — Talixman Auth Platform

Extrait de la maquette de référence (`../../design.html` à la racine du dépôt, décodée dans `design-reference.html` + `logo-talixman.png` dans ce dossier). Sert de source de vérité visuelle pour l'intégration front (Phase 6/7).

## Identité

- Logo : `logo-talixman.png` (plaque blanche arrondie, logo sombre dessus).
- Baseline : *"Cyber Range Industriel"*.
- Accroche : *"Entraînez vos équipes face aux **cybermenaces réelles**"* — *"Environnements de simulation SCADA, ferroviaire et raffinerie pour l'entraînement à la cybersécurité des systèmes industriels."*

## Thème (dark par défaut, toggle light disponible)

Variables CSS (`--var`) portées par `.app[data-theme="dark|light"]` :

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` | `#150d11` | `#f6f1ee` |
| `--panel` | `#1e1216` | `#ffffff` |
| `--panel2` | `#28151a` | `#f2e9e5` |
| `--border` | `rgba(255,255,255,.09)` | `rgba(45,20,30,.12)` |
| `--text` | `#f5eee9` | `#2a1620` |
| `--text-dim` | `#ad939b` | `#7c6670` |
| `--orange` | `#EB640A` | `#d9691f` |
| `--red` | `#BF2D31` | `#a8262a` |
| `--plum` | `#572438` (les deux thèmes) | |

Dégradé de marque : `linear-gradient(150deg,#2c0f1e 0%,var(--plum) 45%,#7a3248 100%)`. CTA primaire en dégradé `orange → red`. Police système (`system-ui, -apple-system, Helvetica, Arial, sans-serif`), labels/badges en `ui-monospace` majuscules avec letter-spacing.

## Écrans (mappés aux rôles RBAC de `CLAUDE.md`)

1. **Login (étape 1/2)** — split-screen : panneau de marque (dégradé + logo) à gauche, formulaire (champs flottants "Identifiant" / "Mot de passe") à droite. Bouton `Se connecter` en dégradé.
2. **Vérification OTP (étape 2/2)** — même panneau de marque, 6 cases de code (`.otp-box`) + input caché superposé, bouton `Vérifier` + `Retour`.
3. **Dashboard (topbar commune)** — logo + tag secteur, liens de nav selon rôle (`PORTAIL`, `INVITÉS`, `GESTION`, `COMPTE`), toggle thème, badge utilisateur (avatar + rôle), bouton déconnexion.
4. **Portail** (tous rôles) — grille de `svc-card` (services du secteur), filtrable par catégorie via `chips` (`TOUS`, `WORKSTATION`, `ATTACKER`, `SUPERVISION`, `AUTOMATE`, `TERRAIN`). Chaque carte : icône colorée par catégorie, badge catégorie, nom, sous-titre, description, statut "Disponible", CTA "Lancer →" au survol. **GUEST ne voit que les services `guest:true`** (vue 3D + vue opérateur) — correspond à `VIEW_ONLY` dans le modèle de données.
5. **Invités** (ADMIN) — tableau des comptes invités de son secteur + formulaire de création rapide.
6. **Compte** (tous rôles) — changement de mot de passe.
7. **Gestion** (SUPERADMIN) — deux onglets :
   - *Secteurs & Services* : cartes secteurs (icône, nb services, nb admins) → expansion en liste de services avec switch actif/inactif + suppression + formulaire d'ajout (nom, description, catégorie, accès invités via switch = `access_level VIEW_ONLY`).
   - *Administrateurs* : tableau admins + secteur, formulaire de création (identifiant, mot de passe, secteur).
8. **Overlay service actif** — plein écran avec bouton retour, utilisé pour héberger l'`iframe`/lancement du `launch_url` du service (`activeService`).

## Catégories de service (mock) → à mapper sur `Service.access_level` et un futur champ `category`

`WORKSTATION` (💻), `ATTACKER` (💀), `SUPERVISION` (🖥️), `AUTOMATE` (🤖), `TERRAIN` (🏭, contient la vue 3D). Couleur d'accent par catégorie via `--cc` (ex. supervision `#3aa8a0`, attacker `#e05252`, automate `#e8792a`, terrain `#a45a8a`, workstation `#6b7fd7`).

## Note

La maquette est un mock **statique en mémoire** (pas d'appel API, code OTP factice `123456`, mots de passe en clair dans un objet JS). Elle sert uniquement de référence visuelle/structurelle — toute la logique (auth réelle, RBAC, persistence) est à réimplémenter selon `CLAUDE.md` et `workflow.md`.
