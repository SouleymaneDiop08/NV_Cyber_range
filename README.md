# Talixman Range

Plateforme d'authentification et d'orchestration de laboratoires de simulation
industrielle (cyber range). Le portail est le point d'entrée unique : sans
authentification, aucun accès aux environnements de simulation.

## Composition du dépôt

| Dossier | Rôle |
|---|---|
| `talixman-auth/` | **Le portail** — frontend React et API NestJS. Identité, rôles, secteurs, propriété des laboratoires. Ne parle jamais à Docker. |
| `cyber-range-orchestrator/` | **Le middleware** — cycle de vie des laboratoires et exposition réseau. Seul détenteur de l'accès à Docker. |
| `dispatching/` | **Le laboratoire du secteur Dispatching électrique** — modèle de référence pour les autres secteurs. |
| `docs/` | Documentation, présentations, références de design. |

Les trois composants sont indépendants et communiquent en REST. Le détail de
l'architecture est dans `docs/presentations/talixman-architecture-technique.docx`
et, pour la partie applicative, dans `talixman-auth/CLAUDE.md`.

## Démarrage rapide

```bash
# 1. Configuration — copier chaque exemple et renseigner les valeurs
cp talixman-auth/.env.example              talixman-auth/.env
cp talixman-auth/backend/.env.example      talixman-auth/backend/.env
cp talixman-auth/frontend/.env.example     talixman-auth/frontend/.env
cp cyber-range-orchestrator/.env.example   cyber-range-orchestrator/.env

# 2. Portail (crée aussi le réseau utilisé par l'orchestrateur)
cd talixman-auth && docker compose up -d && cd ..

# 3. Images du laboratoire (hors ligne, ~10 min la première fois)
cd dispatching && ./build-images.sh && cd ..

# 4. Orchestrateur
cd cyber-range-orchestrator && docker compose up -d --build && cd ..
```

## Secrets à générer

Aucune valeur par défaut n'est utilisable en production. À générer avant tout
déploiement réel :

```bash
openssl rand -hex 32   # TOTP_ENC_KEY          — chiffrement des secrets TOTP
openssl rand -hex 32   # LAB_SSO_MASTER_KEY    — jetons de lancement des composants
openssl rand -hex 32   # ORCHESTRATOR_SERVICE_TOKEN
```

`LAB_SSO_MASTER_KEY` doit être **identique** entre le portail et
l'orchestrateur : les deux dérivent le secret de chaque laboratoire à partir
d'elle.

## Ce qui n'est pas versionné, et pourquoi

| Exclu | Raison |
|---|---|
| `.env` | Secrets. Les `.env.example` documentent les variables attendues. |
| `backups/` | Dumps SQL et archives de code — contiennent des secrets. |
| `node_modules/`, `dist/` | Régénérables par `npm install` / `npm run build`. |
| `dispatching/image-tars/*.tar` | ~1,6 Go d'images Docker, régénérées par `build-images.sh`. |
| `model-converted-raw.glb` | Intermédiaire de conversion 3D de 145 Mo, non référencé par le code. |
| Données d'exécution des labos | Historiques et archives produits pendant les sessions. |

## Avant le premier push

**Un fichier dépasse la limite de GitHub.**
`dispatching/viewer3d-station-b/frontend/static/assets/extracted/electrical_substation/model.dae`
fait 148 Mo et est réellement chargé par la vue 3D. GitHub refuse tout fichier
au-delà de 100 Mo — le push serait rejeté.

Deux options :

1. **Git LFS** (configuré dans `.gitattributes`) :
   ```bash
   git lfs install && git lfs track "*.dae" && git add .gitattributes
   ```
   Nécessite LFS activé côté serveur et installé sur chaque poste.

2. **Basculer sur le modèle optimisé** : un `model-optimized.glb` de 8,1 Mo est
   déjà présent à côté. Pointer `viewer3d-station-b/frontend/static/index.html`
   dessus supprime le besoin de LFS. C'est une modification fonctionnelle, à
   tester (rendu, textures) avant validation.

## État du projet

Opérationnel de bout en bout sur le secteur Dispatching électrique.

Reste à faire avant une mise en service : reverse proxy public avec TLS et nom
de domaine, bascule de l'envoi d'emails du mode console vers le relais réel,
sauvegarde automatique de la base.
